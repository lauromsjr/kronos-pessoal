import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../database/sqlite';
import { requireApiAuth } from '../auth/auth';
import { createSubtasksForTask, createTaskWithHistory } from '../tasks/tasks.routes';

const router = Router();

const companies = ['IbogaLiv', 'Olympus', 'PlugAI', 'Pessoal'] as const;
const impacts = ['Alto', 'Médio', 'Baixo'] as const;
const listTypes = ['Tarefa', 'Backlog', 'Ideia'] as const;
const statuses = ['A fazer', 'Em andamento', 'Concluída', 'Pausada'] as const;

const nullableDueDate = z.preprocess(
  (value) => value === '' ? null : value,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
);

const previewRequestInput = z.object({
  prompt: z.string().trim().min(1).max(60000),
  default_company: z.enum(companies).nullable().optional(),
  default_list_type: z.enum(listTypes).nullable().optional(),
});

const previewSubtask = z.object({
  title: z.string().trim().min(1).max(200),
  due_date: z.string().nullable().optional(),
  notes: z.string().max(3000).nullable().optional(),
});

const previewTask = z.object({
  title: z.string().trim().min(1).max(200),
  company: z.enum(companies).nullable().optional(),
  impact: z.string().nullable().optional(),
  list_type: z.enum(listTypes).nullable().optional(),
  status: z.enum(statuses).nullable().optional(),
  due_date: z.string().nullable().optional(),
  notes: z.string().max(10000).nullable().optional(),
  source_code: z.string().max(40).nullable().optional(),
  subtasks: z.array(previewSubtask).max(50).optional().default([]),
});

const previewResponse = z.object({
  tasks: z.array(previewTask).max(100),
  warnings: z.array(z.string().max(500)).max(200).optional().default([]),
});

const commitInput = z.object({
  tasks: z.array(previewTask).min(1).max(100),
});

router.use('/ai', requireApiAuth);

function normalizeDueDate(value: string | null | undefined, notesBag?: string[]) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;

  if (/futuro|ap[oó]s|depois|quando/i.test(raw)) {
    notesBag?.push(`Prazo textual original: ${raw}`);
    return null;
  }

  return null;
}

function normalizeImpact(value: string | null | undefined): (typeof impacts)[number] {
  if (!value) return 'Médio';
  const text = String(value).toLowerCase();
  if (text.includes('alta') || text.includes('alto')) return 'Alto';
  if (text.includes('média') || text.includes('media') || text.includes('médio') || text.includes('medio')) return 'Médio';
  if (text.includes('baixa') || text.includes('baixo')) return 'Baixo';
  return 'Médio';
}

function taskDedupKey(task: z.infer<typeof previewTask>) {
  if (task.source_code) return task.source_code.toLowerCase();
  return task.title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function mergePreviewTasks(tasks: z.infer<typeof previewTask>[]) {
  const map = new Map<string, z.infer<typeof previewTask>>();

  for (const task of tasks) {
    const key = taskDedupKey(task);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...task, subtasks: [...(task.subtasks || [])] });
      continue;
    }

    if (!existing.notes && task.notes) existing.notes = task.notes;
    if (!existing.due_date && task.due_date) existing.due_date = task.due_date;
    existing.subtasks = [...(existing.subtasks || []), ...(task.subtasks || [])];

    const dedupSubMap = new Map<string, z.infer<typeof previewSubtask>>();
    for (const sub of existing.subtasks) {
      dedupSubMap.set(`${sub.title.trim().toLowerCase()}|${sub.due_date || ''}`, sub);
    }
    existing.subtasks = [...dedupSubMap.values()].slice(0, 50);
  }

  return [...map.values()].slice(0, 100);
}

function parseAiJson(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1] : trimmed);
}

async function callOpenAi(payload: { prompt: string; default_company?: string | null; default_list_type?: string | null }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('IA não configurada.');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: 'Você é um parser de tarefas para o sistema Kronos. Sua função é transformar comandos e planejamentos em JSON estruturado de tarefas e subtarefas. Não execute ações fora do JSON. Não invente dados ausentes. Quando houver dúvida, use notes e warnings. Responda somente JSON válido no formato {"tasks":[{"title":"string","company":"IbogaLiv|Olympus|PlugAI|Pessoal|null","impact":"Alto|Médio|Baixo|null","list_type":"Tarefa|Backlog|Ideia|null","status":"A fazer|Em andamento|Concluída|Pausada|null","due_date":"YYYY-MM-DD|DD/MM/YYYY|null","notes":"string|null","source_code":"T5|T6|...|null","subtasks":[{"title":"string","due_date":"YYYY-MM-DD|DD/MM/YYYY|null","notes":"string|null"}]}],"warnings":["string"]}. Cada linha iniciando com ↳ deve virar subtarefa da tarefa principal anterior.'
        },
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error('Não foi possível analisar com IA.');
  }

  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error('Resposta vazia da IA.');
  return parseAiJson(content);
}

function finalizePreview(
  raw: z.infer<typeof previewResponse>,
  defaults: { default_company?: string | null; default_list_type?: string | null }
) {
  const warnings = [...(raw.warnings || [])];

  const normalizedTasks = raw.tasks.map((task) => {
    const notes: string[] = [];
    if (task.notes) notes.push(task.notes);
    if (task.source_code) notes.push(`Referência original: ${task.source_code}`);

    const dueDate = normalizeDueDate(task.due_date ?? null, notes);
    const subtasks = (task.subtasks || []).slice(0, 50).map((subtask) => {
      const subNotes: string[] = [];
      const subDueDate = normalizeDueDate(subtask.due_date ?? null, subNotes);
      if (subNotes.length) notes.push(...subNotes.map((line) => `Subtarefa "${subtask.title}": ${line}`));
      return {
        title: subtask.title.trim(),
        due_date: subDueDate,
      };
    });

    return {
      title: task.title.trim(),
      company: (task.company || defaults.default_company || null) as (typeof companies)[number] | null,
      impact: normalizeImpact(task.impact || null),
      list_type: (task.list_type || defaults.default_list_type || 'Tarefa') as (typeof listTypes)[number],
      status: 'A fazer' as const,
      due_date: dueDate,
      notes: notes.join('\n').trim() || null,
      source_code: task.source_code || null,
      subtasks,
    };
  });

  const dedupedTasks = mergePreviewTasks(normalizedTasks);
  if (normalizedTasks.length !== dedupedTasks.length) {
    warnings.push('Tarefas duplicadas foram consolidadas automaticamente no preview.');
  }

  return {
    tasks: dedupedTasks,
    warnings,
  };
}

router.post('/ai/tasks/preview', async (req, res, next) => {
  try {
    const parsed = previewRequestInput.parse(req.body || {});
    const raw = await callOpenAi(parsed);
    const validated = previewResponse.parse(raw);
    const normalized = finalizePreview(validated, parsed);
    if (normalized.tasks.length > 100) {
      return res.status(400).json({ error: 'Limite excedido: máximo de 100 tarefas por importação.' });
    }
    return res.json({ data: normalized });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao gerar preview com IA.';
    if (message === 'IA não configurada.') return res.status(400).json({ error: message });
    if (message.includes('JSON')) return res.status(400).json({ error: 'A IA retornou um formato inválido. Tente novamente com instruções mais objetivas.' });
    return next(new Error(message || 'Erro ao gerar preview com IA.'));
  }
});

router.post('/ai/tasks/commit', async (req, res, next) => {
  try {
    const parsed = commitInput.parse(req.body || {});
    const db = await getDb();

    let createdCount = 0;
    let createdSubtasksCount = 0;
    const createdTasks: any[] = [];

    await db.exec('BEGIN TRANSACTION');
    try {
      for (const rawTask of parsed.tasks) {
        const taskPayload = {
          title: rawTask.title,
          company: rawTask.company ?? null,
          impact: normalizeImpact(rawTask.impact),
          list_type: rawTask.list_type || 'Tarefa',
          status: rawTask.status || 'A fazer',
          due_date: normalizeDueDate(rawTask.due_date ?? null) ?? null,
          sync_to_calendar: 0,
          calendar_start_time: null,
          calendar_duration_min: null,
          recurrence_type: 'none',
          recurrence_interval: 1,
          recurrence_next_date: null,
          notes: rawTask.notes || '',
        };

        const createdTask = await createTaskWithHistory(db, taskPayload as any);
        createdTasks.push(createdTask);
        createdCount += 1;

        const subtasks = (rawTask.subtasks || []).slice(0, 50).map((subtask) => ({
          title: subtask.title,
          done: false,
          due_date: normalizeDueDate(subtask.due_date ?? null) ?? null,
        }));

        const createdSubtasks = await createSubtasksForTask(db, createdTask.id, subtasks);
        createdSubtasksCount += createdSubtasks.length;
      }

      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }

    return res.status(201).json({
      data: {
        created_tasks: createdTasks,
        created_count: createdCount,
        created_subtasks_count: createdSubtasksCount,
      },
    });
  } catch (err) {
    return next(err);
  }
});

export const aiTasksRouter = router;
