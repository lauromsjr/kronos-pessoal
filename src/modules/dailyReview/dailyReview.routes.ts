import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../database/sqlite';
import { requireApiAuth } from '../auth/auth';
import { listCalendarEvents } from '../calendar/googleCalendar';

const router = Router();

const startInput = z.object({
  selected_priority_task_ids: z.array(z.number().int().positive()).max(3).default([]),
});

const closeInput = z.object({
  summary: z.string().trim().max(5000).optional().default(''),
  blockers: z.string().trim().max(5000).optional().default(''),
  tomorrow_focus: z.string().trim().max(5000).optional().default(''),
});

const suggestInput = z.object({
  task_ids: z.array(z.number().int().positive()).max(60).optional(),
});
const sendWhatsAppInput = z.object({
  review_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function ensureDailyReviewTable() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS daily_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_date TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'not_started',
      selected_priority_task_ids TEXT NULL,
      started_at DATETIME NULL,
      ended_at DATETIME NULL,
      summary TEXT NULL,
      blockers TEXT NULL,
      tomorrow_focus TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_daily_reviews_date ON daily_reviews(review_date);
  `);
}

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function normalizeDailyReview(row: any, reviewDate = todayInSaoPaulo()) {
  if (!row) {
    return {
      review_date: reviewDate,
      status: 'not_started',
      selected_priority_task_ids: [],
      started_at: null,
      ended_at: null,
      summary: '',
      blockers: '',
      tomorrow_focus: '',
    };
  }

  let selectedPriorityTaskIds: number[] = [];
  try {
    const parsed = JSON.parse(row.selected_priority_task_ids || '[]');
    selectedPriorityTaskIds = Array.isArray(parsed)
      ? parsed.filter((id) => Number.isInteger(id))
      : [];
  } catch {
    selectedPriorityTaskIds = [];
  }

  const status = ['not_started', 'started', 'closed'].includes(row.status)
    ? row.status
    : 'not_started';

  return {
    id: row.id,
    review_date: row.review_date,
    status,
    selected_priority_task_ids: selectedPriorityTaskIds,
    started_at: row.started_at || null,
    ended_at: row.ended_at || null,
    summary: row.summary || '',
    blockers: row.blockers || '',
    tomorrow_focus: row.tomorrow_focus || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00-03:00`);
  next.setUTCDate(next.getUTCDate() + days);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(next);
}

async function getSubtaskCounts(db: Awaited<ReturnType<typeof getDb>>, taskIds: number[]) {
  if (!taskIds.length) return {};
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT task_id,
            COUNT(*) as total,
            SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) as done
     FROM subtasks WHERE task_id IN (${placeholders}) GROUP BY task_id`,
    taskIds
  );
  const map: Record<number, { total: number; done: number }> = {};
  rows.forEach((row: any) => { map[row.task_id] = { total: row.total, done: row.done || 0 }; });
  return map;
}

async function getPriorityCandidateTasks(taskIds?: number[]) {
  const db = await getDb();
  const today = todayInSaoPaulo();
  const tomorrow = addDays(today, 1);
  const values: unknown[] = [today, today, tomorrow];
  const optionalIdFilter = taskIds?.length
    ? ` AND id IN (${taskIds.map(() => '?').join(',')})`
    : '';

  if (taskIds?.length) values.push(...taskIds);

  const rows = await db.all(
    `SELECT id, title, company, impact, status, due_date, list_type
     FROM tasks
     WHERE status != 'Concluída'
       AND (
         (due_date IS NOT NULL AND due_date < ?)
         OR due_date = ?
         OR due_date = ?
         OR status = 'Em andamento'
         OR impact = 'Alto'
       )
       ${optionalIdFilter}
     ORDER BY
       CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
       due_date ASC,
       CASE status WHEN 'Em andamento' THEN 0 WHEN 'A fazer' THEN 1 WHEN 'Pausada' THEN 2 ELSE 3 END,
       CASE impact WHEN 'Alto' THEN 0 WHEN 'Médio' THEN 1 ELSE 2 END,
       created_at ASC
     LIMIT 40`,
    values
  );

  const counts = await getSubtaskCounts(db, rows.map((task: any) => task.id));
  return rows.map((task: any) => ({
    id: task.id,
    title: task.title,
    company: task.company || null,
    impact: task.impact || null,
    status: task.status,
    due_date: task.due_date || null,
    list_type: task.list_type,
    subtasks_total: counts[task.id]?.total || 0,
    subtasks_done: counts[task.id]?.done || 0,
  }));
}

function parseAiJson(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

async function callOpenAiForPrioritySuggestions(context: unknown) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('IA não configurada.');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content: 'Você é um assistente de execução diária. Escolha até 3 tarefas como prioridade do dia com base em urgência, impacto, prazo e andamento. Responda apenas JSON válido no formato {"suggestions":[{"task_id":number,"reason":"string"}]}. Não invente task_id.',
        },
        {
          role: 'user',
          content: JSON.stringify(context),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error('Não foi possível gerar sugestões com IA.');
  }

  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('Resposta vazia da IA.');
  return parseAiJson(content);
}

async function getReviewByDate(reviewDate: string) {
  const db = await getDb();
  return db.get('SELECT * FROM daily_reviews WHERE review_date = ?', reviewDate);
}

function getEvolutionConfig() {
  const baseUrl = process.env.EVOLUTION_API_BASE_URL || process.env.EVOLUTION_API_URL || '';
  const instance = process.env.EVOLUTION_API_INSTANCE || process.env.EVOLUTION_INSTANCE || '';
  const apiKey = process.env.EVOLUTION_API_KEY || '';
  const authHeader = (process.env.EVOLUTION_API_AUTH_HEADER || 'apikey').trim();
  const sendPath = process.env.EVOLUTION_API_SEND_TEXT_PATH || '/message/sendText/{instance}';
  const number = process.env.WHATSAPP_DAILY_SUMMARY_TO || '';

  return { baseUrl, instance, apiKey, authHeader, sendPath, number };
}

function isWhatsAppConfigured() {
  const config = getEvolutionConfig();
  const validHeader = config.authHeader === 'apikey' || config.authHeader === 'Authorization';
  return Boolean(config.baseUrl && config.instance && config.apiKey && config.number && validHeader);
}

function buildEvolutionSendTextPayload(message: string) {
  return {
    number: process.env.WHATSAPP_DAILY_SUMMARY_TO || '',
    text: message,
  };
}

async function getPriorityTasksByIds(ids: number[]) {
  if (!ids.length) return [];
  const db = await getDb();
  const placeholders = ids.map(() => '?').join(',');
  const rows = await db.all(
    `SELECT id, title
     FROM tasks
     WHERE id IN (${placeholders})`,
    ids
  ) as Array<{ id: number; title: string }>;
  const map = new Map(rows.map((row) => [row.id, row.title]));
  return ids.map((id) => ({ id, title: map.get(id) || `Tarefa #${id}` }));
}

async function getCompletedTasksForDate(reviewDate: string) {
  const db = await getDb();
  const rows = await db.all(
    `SELECT id, title
     FROM tasks
     WHERE completed_at IS NOT NULL
       AND date(completed_at, '-3 hours') = ?
     ORDER BY completed_at ASC`,
    reviewDate
  ) as Array<{ id: number; title: string }>;
  return rows;
}

function buildDailySummaryWhatsAppMessage(data: {
  reviewDate: string;
  priorities: Array<{ id: number; title: string }>;
  completed: Array<{ id: number; title: string }>;
  summary: string;
  blockers: string;
  tomorrowFocus: string;
}) {
  const dateBr = new Date(`${data.reviewDate}T12:00:00`).toLocaleDateString('pt-BR');
  const priorities = data.priorities.length
    ? data.priorities.map((item, index) => `${index + 1}. ${item.title}`).join('\n')
    : 'Nenhuma registrada.';
  const completed = data.completed.length
    ? data.completed.map((item) => `- ${item.title}`).join('\n')
    : 'Nenhuma registrada.';

  return [
    `Resumo do dia — ${dateBr}`,
    '',
    'Prioridades:',
    priorities,
    '',
    'Concluídas:',
    completed,
    '',
    'Resumo:',
    data.summary.trim() || 'Não informado.',
    '',
    'Bloqueios:',
    data.blockers.trim() || 'Não informado.',
    '',
    'Foco de amanhã:',
    data.tomorrowFocus.trim() || 'Não informado.',
  ].join('\n');
}

async function sendDailySummaryToEvolution(message: string) {
  const config = getEvolutionConfig();
  const url = `${config.baseUrl.replace(/\/+$/, '')}${config.sendPath.replace('{instance}', config.instance)}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (config.authHeader === 'Authorization') {
    headers.Authorization = `Bearer ${config.apiKey}`;
  } else {
    headers.apikey = config.apiKey;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(buildEvolutionSendTextPayload(message)),
  });

  if (!response.ok) {
    throw new Error('Evolution API request failed');
  }
}

router.use('/daily-review', requireApiAuth);

router.get('/daily-review/today', async (_req, res, next) => {
  try {
    const reviewDate = todayInSaoPaulo();
    const row = await getReviewByDate(reviewDate);
    res.json(normalizeDailyReview(row, reviewDate));
  } catch (err) {
    next(err);
  }
});

router.post('/daily-review/suggest-priorities', async (req, res, next) => {
  try {
    const parsed = suggestInput.parse(req.body || {});
    const tasks = await getPriorityCandidateTasks(parsed.task_ids);
    if (!tasks.length) return res.json({ suggestions: [] });

    const agenda = await listCalendarEvents('today').catch(() => ({ connected: false, data: [] }));
    const context = {
      date: todayInSaoPaulo(),
      rules: [
        'Retorne no máximo 3 tarefas.',
        'Priorize atrasadas, alto impacto, prazo de hoje, em andamento e desbloqueios importantes.',
        'Use apenas task_id existente em tasks.',
        'Justificativa curta, direta e prática.',
      ],
      tasks,
      calendar_today: (agenda.data || []).slice(0, 12).map((event) => ({
        title: event.title,
        start: event.start,
        end: event.end,
        all_day: event.all_day,
        company: event.company || null,
      })),
    };
    const raw = await callOpenAiForPrioritySuggestions(context);
    const validIds = new Set(tasks.map((task) => task.id));
    const seen = new Set<number>();

    const suggestions = Array.isArray(raw?.suggestions)
      ? raw.suggestions
          .filter((item: any) => Number.isInteger(item?.task_id) && validIds.has(item.task_id) && !seen.has(item.task_id))
          .slice(0, 3)
          .map((item: any) => {
            seen.add(item.task_id);
            return {
              task_id: item.task_id,
              reason: String(item.reason || 'Prioridade sugerida para hoje.').slice(0, 180),
            };
          })
      : [];

    res.json({ suggestions });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível gerar sugestões com IA.';
    if (message === 'IA não configurada.') {
      return res.status(400).json({ error: message });
    }
    return next(new Error('Não foi possível gerar sugestões com IA.'));
  }
});

router.get('/daily-review/history', async (req, res, next) => {
  try {
    const requestedLimit = Number(req.query.limit || 14);
    const requestedOffset = Number(req.query.offset || 0);
    const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 14, 1), 60);
    const offset = Math.max(Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0, 0);
    const db = await getDb();

    const rows = await db.all(
      `SELECT * FROM daily_reviews
       ORDER BY review_date DESC
       LIMIT ? OFFSET ?`,
      limit + 1,
      offset
    );

    res.json({
      data: rows.slice(0, limit).map((row) => normalizeDailyReview(row)),
      pagination: {
        limit,
        offset,
        has_more: rows.length > limit,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/daily-review/:date', async (req, res, next) => {
  try {
    const reviewDate = dateParam.parse(req.params.date);
    const row = await getReviewByDate(reviewDate);
    if (!row) {
      return res.status(404).json({ error: 'Daily review not found' });
    }
    return res.json(normalizeDailyReview(row, reviewDate));
  } catch (err) {
    next(err);
  }
});

router.post('/daily-review/start', async (req, res, next) => {
  try {
    const parsed = startInput.parse(req.body);
    const ids = [...new Set(parsed.selected_priority_task_ids)].slice(0, 3);
    const reviewDate = todayInSaoPaulo();
    const db = await getDb();
    const existing = await getReviewByDate(reviewDate);

    if (existing) {
      await db.run(
        `UPDATE daily_reviews
         SET status = 'started',
             selected_priority_task_ids = ?,
             started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE review_date = ?`,
        JSON.stringify(ids),
        reviewDate
      );
    } else {
      await db.run(
        `INSERT INTO daily_reviews (review_date, status, selected_priority_task_ids, started_at, updated_at)
         VALUES (?, 'started', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        reviewDate,
        JSON.stringify(ids)
      );
    }

    const row = await getReviewByDate(reviewDate);
    res.json(normalizeDailyReview(row, reviewDate));
  } catch (err) {
    next(err);
  }
});

router.post('/daily-review/close', async (req, res, next) => {
  try {
    const parsed = closeInput.parse(req.body);
    const reviewDate = todayInSaoPaulo();
    const db = await getDb();
    const existing = await getReviewByDate(reviewDate);

    if (existing) {
      await db.run(
        `UPDATE daily_reviews
         SET status = 'closed',
             ended_at = CURRENT_TIMESTAMP,
             summary = ?,
             blockers = ?,
             tomorrow_focus = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE review_date = ?`,
        parsed.summary,
        parsed.blockers,
        parsed.tomorrow_focus,
        reviewDate
      );
    } else {
      await db.run(
        `INSERT INTO daily_reviews (
           review_date, status, ended_at, summary, blockers, tomorrow_focus, updated_at
         ) VALUES (?, 'closed', CURRENT_TIMESTAMP, ?, ?, ?, CURRENT_TIMESTAMP)`,
        reviewDate,
        parsed.summary,
        parsed.blockers,
        parsed.tomorrow_focus
      );
    }

    const row = await getReviewByDate(reviewDate);
    res.json(normalizeDailyReview(row, reviewDate));
  } catch (err) {
    next(err);
  }
});

router.post('/daily-review/send-whatsapp-summary', async (req, res, next) => {
  try {
    if (!isWhatsAppConfigured()) {
      return res.status(400).json({ error: 'WhatsApp não configurado.' });
    }

    const parsed = sendWhatsAppInput.parse(req.body || {});
    const reviewDate = parsed.review_date || todayInSaoPaulo();
    const review = await getReviewByDate(reviewDate);
    if (!review) {
      return res.status(404).json({ error: 'Resumo diário não encontrado.' });
    }

    const normalized = normalizeDailyReview(review, reviewDate);
    const [priorities, completed] = await Promise.all([
      getPriorityTasksByIds(normalized.selected_priority_task_ids),
      getCompletedTasksForDate(reviewDate),
    ]);

    const message = buildDailySummaryWhatsAppMessage({
      reviewDate,
      priorities,
      completed,
      summary: normalized.summary,
      blockers: normalized.blockers,
      tomorrowFocus: normalized.tomorrow_focus,
    });

    await sendDailySummaryToEvolution(message);

    return res.json({
      ok: true,
      review_date: reviewDate,
      message: 'Resumo enviado por WhatsApp.',
      auth_header: (process.env.EVOLUTION_API_AUTH_HEADER || 'apikey').trim(),
      payload_format: 'number + text',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Não foi possível enviar o resumo.';
    if (message === 'WhatsApp não configurado.' || message === 'Resumo diário não encontrado.') {
      return res.status(400).json({ error: message });
    }
    return res.status(400).json({ error: 'Não foi possível enviar o resumo.' });
  }
});

export const dailyReviewRouter = router;
