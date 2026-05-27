import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../database/sqlite';
import { requireApiAuth } from '../auth/auth';
import { upsertTaskCalendarEvent } from '../calendar/googleCalendar';

const router = Router();
const recurrenceTypes = ['none', 'daily', 'weekly', 'monthly'] as const;

const companies  = ['IbogaLiv', 'Olympus', 'PlugAI', 'Pessoal'] as const;
const impacts    = ['Alto', 'MÃ©dio', 'Baixo'] as const;
const listTypes  = ['Tarefa', 'Backlog', 'Ideia'] as const;
const statuses   = ['A fazer', 'Em andamento', 'ConcluÃ­da', 'Pausada'] as const;

const nullableCompany = z.preprocess(
  (value) => value === '' ? null : value,
  z.enum(companies).nullable().optional()
);

const nullableDueDate = z.preprocess(
  (value) => value === '' ? null : value,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
);

const nullableCalendarStartTime = z.preprocess(
  (value) => value === '' ? null : value,
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional()
);

const nullableCalendarDuration = z.preprocess(
  (value) => value === '' ? null : value,
  z.number().int().min(15).max(480).nullable().optional()
);

const taskInput = z.object({
  title:     z.string().trim().min(1),
  company:   nullableCompany,
  impact:    z.enum(impacts).nullable().optional(),
  list_type: z.enum(listTypes).nullable().optional(),
  status:    z.enum(statuses).nullable().optional(),
  due_date:  nullableDueDate,
  sync_to_calendar: z.boolean().optional(),
  calendar_start_time: nullableCalendarStartTime,
  calendar_duration_min: nullableCalendarDuration,
  recurrence_type: z.enum(recurrenceTypes).optional(),
  recurrence_interval: z.number().int().min(1).max(30).optional(),
  recurrence_next_date: nullableDueDate,
  notes:     z.string().nullable().optional(),
});

const taskUpdate = taskInput.partial().extend({
  title: z.string().trim().min(1).optional(),
});

const statusInput = z.object({ status: z.enum(statuses) });
const bulkDeleteInput = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(200),
});

const subtaskInput = z.object({
  title: z.string().trim().min(1),
  done:  z.boolean().optional().default(false),
  due_date: nullableDueDate,
});

// â”€â”€ Init subtasks table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function ensureSubtasksTable() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS subtasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL,
      title      TEXT NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0,
      due_date   TEXT NULL,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id, position);
  `);

  const columns = await db.all<{ name: string }[]>('PRAGMA table_info(subtasks)');
  if (!columns.some((column) => column.name === 'due_date')) {
    await db.exec('ALTER TABLE subtasks ADD COLUMN due_date TEXT NULL;');
  }
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function normalizeTask(input: z.infer<typeof taskInput>) {
  const recurrenceType = input.recurrence_type || 'none';
  const recurrenceInterval = recurrenceType === 'none' ? 1 : input.recurrence_interval || 1;
  const recurrenceNextDate = recurrenceType === 'none'
    ? null
    : input.recurrence_next_date ?? calculateNextRecurrenceDate({
        due_date: input.due_date ?? null,
        recurrence_type: recurrenceType,
        recurrence_interval: recurrenceInterval,
      });

  return {
    title:     input.title,
    company:   input.company ?? null,
    impact:    input.impact    || 'MÃ©dio',
    list_type: input.list_type || 'Tarefa',
    status:    input.status    || 'A fazer',
    due_date:  input.due_date ?? null,
    sync_to_calendar: input.sync_to_calendar ? 1 : 0,
    calendar_start_time: input.calendar_start_time ?? null,
    calendar_duration_min: input.calendar_duration_min ?? null,
    recurrence_type: recurrenceType,
    recurrence_interval: recurrenceInterval,
    recurrence_next_date: recurrenceNextDate,
    notes:     input.notes     || '',
  };
}

export async function createTaskWithHistory(
  db: Awaited<ReturnType<typeof getDb>>,
  task: ReturnType<typeof normalizeTask>
) {
  const result = await db.run(
    `INSERT INTO tasks (
      title, company, impact, list_type, status, due_date,
      sync_to_calendar, calendar_start_time, calendar_duration_min,
      recurrence_type, recurrence_interval, recurrence_next_date, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    task.title, task.company, task.impact, task.list_type, task.status, task.due_date,
    task.sync_to_calendar, task.calendar_start_time, task.calendar_duration_min,
    task.recurrence_type, task.recurrence_interval, task.recurrence_next_date, task.notes
  );

  await db.run(
    'INSERT INTO task_status_history (task_id, from_status, to_status) VALUES (?, NULL, ?)',
    result.lastID, task.status
  );

  return db.get('SELECT * FROM tasks WHERE id = ?', result.lastID);
}

export async function createSubtasksForTask(
  db: Awaited<ReturnType<typeof getDb>>,
  taskId: number,
  subtasks: Array<{ title: string; due_date?: string | null; done?: boolean }>
) {
  let maxPos = await db.get<{ pos: number }>('SELECT MAX(position) as pos FROM subtasks WHERE task_id = ?', taskId);
  let position = (maxPos?.pos ?? -1) + 1;
  const created: any[] = [];

  for (const subtask of subtasks) {
    const result = await db.run(
      'INSERT INTO subtasks (task_id, title, done, due_date, position) VALUES (?, ?, ?, ?, ?)',
      taskId,
      subtask.title,
      subtask.done ? 1 : 0,
      subtask.due_date ?? null,
      position
    );
    position += 1;
    const row = await db.get('SELECT * FROM subtasks WHERE id = ?', result.lastID);
    created.push(row);
  }

  return created;
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) return '';
  return `"${String(value).replaceAll('"', '""').replace(/\r?\n/g, '\n')}"`;
}

router.use(['/tasks', '/subtasks'], requireApiAuth);

async function applyStatusChange(taskId: number, nextStatus: string) {
  const db = await getDb();
  const current = await db.get('SELECT * FROM tasks WHERE id = ?', taskId);
  if (!current) return null;

  const updates: string[] = ['status = ?'];
  const values: unknown[]  = [nextStatus];

  if (nextStatus === 'Em andamento' && !current.started_at) {
    updates.push('started_at = CURRENT_TIMESTAMP');
  }

  if (nextStatus === statuses[2]) {
    updates.push('completed_at = CURRENT_TIMESTAMP');
    if (current.started_at) {
      updates.push("duration_min = CAST((julianday(CURRENT_TIMESTAMP) - julianday(started_at)) * 24 * 60 AS INTEGER)");
    }
  }

  await db.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, [...values, taskId]);

  if (current.status !== nextStatus) {
    await db.run(
      'INSERT INTO task_status_history (task_id, from_status, to_status) VALUES (?, ?, ?)',
      taskId, current.status, nextStatus
    );

    if (nextStatus === statuses[2]) {
      const completedTask = await db.get('SELECT * FROM tasks WHERE id = ?', taskId);
      await createNextRecurringOccurrence(db, completedTask);
    }
  }

  return db.get('SELECT * FROM tasks WHERE id = ?', taskId);
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
  rows.forEach((r: any) => { map[r.task_id] = { total: r.total, done: r.done }; });
  return map;
}

async function attachSubtaskCounts(db: Awaited<ReturnType<typeof getDb>>, rows: any[]) {
  const ids = rows.map((r: any) => r.id);
  const counts = await getSubtaskCounts(db, ids);
  return rows.map((r: any) => ({
    ...r,
    subtasks_total: counts[r.id]?.total || 0,
    subtasks_done:  counts[r.id]?.done  || 0,
  }));
}

async function syncTaskCalendarEvent(db: Awaited<ReturnType<typeof getDb>>, task: any) {
  try {
    const googleEventId = await upsertTaskCalendarEvent(task);
    if (googleEventId && googleEventId !== task.google_event_id) {
      await db.run('UPDATE tasks SET google_event_id = ? WHERE id = ?', googleEventId, task.id);
      return {
        task: await db.get('SELECT * FROM tasks WHERE id = ?', task.id),
        calendarSyncFailed: false,
      };
    }
    return { task, calendarSyncFailed: false };
  } catch (err) {
    console.error('[calendar] task sync failed', err);
    return { task, calendarSyncFailed: true };
  }
}

function todayInSaoPaulo() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
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

function addMonths(date: string, months: number) {
  const next = new Date(`${date}T12:00:00-03:00`);
  next.setMonth(next.getMonth() + months);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(next);
}

function calculateNextRecurrenceDate(task: {
  due_date?: string | null;
  recurrence_type?: string | null;
  recurrence_interval?: number | null;
}) {
  const type = task.recurrence_type || 'none';
  const interval = Math.min(30, Math.max(1, Number(task.recurrence_interval || 1)));
  const baseDate = task.due_date || todayInSaoPaulo();

  if (type === 'daily') return addDays(baseDate, interval);
  if (type === 'weekly') return addDays(baseDate, interval * 7);
  if (type === 'monthly') return addMonths(baseDate, interval);
  return null;
}

async function createNextRecurringOccurrence(db: Awaited<ReturnType<typeof getDb>>, task: any) {
  if (!task || task.recurrence_type === 'none') return null;

  const nextDate = task.recurrence_next_date || calculateNextRecurrenceDate(task);
  if (!nextDate) return null;

  const recurringParentId = task.recurring_parent_id || task.id;
  const existing = await db.get(
    `SELECT id FROM tasks
     WHERE recurring_parent_id = ?
       AND title = ?
       AND due_date = ?
       AND recurrence_type = ?
       AND status != ?
     LIMIT 1`,
    recurringParentId,
    task.title,
    nextDate,
    task.recurrence_type,
    statuses[2]
  );
  if (existing) return existing;

  const followingDate = calculateNextRecurrenceDate({
    ...task,
    due_date: nextDate,
  });

  const result = await db.run(
    `INSERT INTO tasks (
      title, company, impact, list_type, status, due_date,
      sync_to_calendar, calendar_start_time, calendar_duration_min,
      recurrence_type, recurrence_interval, recurrence_next_date, recurring_parent_id,
      notes
    ) VALUES (?, ?, ?, ?, 'A fazer', ?, 0, NULL, NULL, ?, ?, ?, ?, ?)`,
    task.title,
    task.company ?? null,
    task.impact,
    task.list_type,
    nextDate,
    task.recurrence_type,
    task.recurrence_interval || 1,
    followingDate,
    recurringParentId,
    task.notes || ''
  );

  await db.run(
    'INSERT INTO task_status_history (task_id, from_status, to_status) VALUES (?, NULL, ?)',
    result.lastID,
    'A fazer'
  );

  return db.get('SELECT * FROM tasks WHERE id = ?', result.lastID);
}

async function getTodayBucket(
  db: Awaited<ReturnType<typeof getDb>>,
  where: string,
  values: unknown[],
  orderBy: string
) {
  const rows = await db.all(
    `SELECT * FROM tasks
     WHERE status != 'ConcluÃ­da' AND ${where}
     ORDER BY ${orderBy}`,
    values
  );

  return attachSubtaskCounts(db, rows);
}

// â”€â”€ GET /tasks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/tasks', async (req, res, next) => {
  try {
    const db = await getDb();
    const filterMap = { list: 'list_type', company: 'company', impact: 'impact', status: 'status' } as const;
    const where: string[] = [];
    const values: unknown[] = [];
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const isCompletedList = req.query.list === 'Concluida';

    // Aba "ConcluÃ­das" â€” retorna todas concluÃ­das independente de list_type
    if (isCompletedList) {
      where.push("status = 'ConcluÃ­da'");
      for (const [queryKey, column] of Object.entries(filterMap)) {
        if (queryKey === 'list' || queryKey === 'status') continue;
        const value = req.query[queryKey];
        if (typeof value === 'string' && value.trim()) {
          where.push(`${column} = ?`);
          values.push(value);
        }
      }
    } else {
      // Nas outras abas, excluir concluÃ­das
      where.push("status != 'ConcluÃ­da'");
      for (const [queryKey, column] of Object.entries(filterMap)) {
        const value = req.query[queryKey];
        if (typeof value === 'string' && value.trim()) {
          where.push(`${column} = ?`);
          values.push(value);
        }
      }
    }

    if (search) {
      where.push('title LIKE ?');
      values.push(`%${search}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const page = Math.max(1, Number(req.query.page || 1));
    const rawLimit = Number(req.query.limit || 20);
    const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
    const offset = (page - 1) * limit;

    let rows: any[];
    let total = 0;

    if (isCompletedList) {
      const totalRow = await db.get<{ total: number }>(`SELECT COUNT(*) as total FROM tasks ${whereSql}`, values);
      total = totalRow?.total || 0;
      rows = await db.all(
        `SELECT * FROM tasks ${whereSql}
         ORDER BY completed_at DESC, created_at DESC
         LIMIT ? OFFSET ?`,
        [...values, limit, offset]
      );
    } else {
      rows = await db.all(
        `SELECT * FROM tasks ${whereSql}
         ORDER BY
           CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
           due_date ASC,
           CASE status WHEN 'Em andamento' THEN 0 WHEN 'A fazer' THEN 1 WHEN 'Pausada' THEN 2 ELSE 3 END,
           CASE impact WHEN 'Alto' THEN 0 WHEN 'MÃ©dio' THEN 1 ELSE 2 END,
           created_at ASC`,
        values
      );
    }

    // Attach subtask counts
    const data = await attachSubtaskCounts(db, rows);

    if (isCompletedList) {
      return res.json({
        data,
        pagination: {
          page,
          limit,
          total,
          has_more: offset + data.length < total,
        },
      });
    }

    res.json({ data });
  } catch (err) { next(err); }
});

router.get('/tasks/today', async (_req, res, next) => {
  try {
    const db = await getDb();
    const today = todayInSaoPaulo();
    const tomorrow = addDays(today, 1);
    const impactStatusOrder = `
      CASE impact WHEN 'Alto' THEN 0 WHEN 'MÃ©dio' THEN 1 ELSE 2 END,
      CASE status WHEN 'Em andamento' THEN 0 WHEN 'A fazer' THEN 1 WHEN 'Pausada' THEN 2 ELSE 3 END,
      created_at ASC
    `;
    const dueFirstOrder = `
      CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
      due_date ASC,
      created_at ASC
    `;

    const [overdue, todayTasks, tomorrowTasks, inProgress, highPriority] = await Promise.all([
      getTodayBucket(db, 'due_date IS NOT NULL AND due_date < ?', [today], 'due_date ASC, created_at ASC'),
      getTodayBucket(db, 'due_date = ?', [today], impactStatusOrder),
      getTodayBucket(db, 'due_date = ?', [tomorrow], impactStatusOrder),
      getTodayBucket(db, "status = 'Em andamento'", [], dueFirstOrder),
      getTodayBucket(db, "impact = 'Alto'", [], dueFirstOrder),
    ]);

    res.json({
      overdue,
      today: todayTasks,
      tomorrow: tomorrowTasks,
      in_progress: inProgress,
      high_priority: highPriority,
      summary: {
        overdue: overdue.length,
        today: todayTasks.length,
        tomorrow: tomorrowTasks.length,
        in_progress: inProgress.length,
        high_priority: highPriority.length,
      },
    });
  } catch (err) { next(err); }
});

// â”€â”€ GET /tasks/export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/tasks/stats', async (_req, res, next) => {
  try {
    const db = await getDb();
    const byStatusRows = await db.all<{ status: string; total: number }[]>(
      'SELECT status, COUNT(*) as total FROM tasks GROUP BY status'
    );
    const byCompanyRows = await db.all<{ company_name: string; total: number }[]>(
      `SELECT COALESCE(NULLIF(company, ''), 'Sem empresa') as company_name, COUNT(*) as total
       FROM tasks GROUP BY company_name`
    );

    const by_status: Record<string, number> = {
      'A fazer': 0,
      'Em andamento': 0,
      'ConcluÃ­da': 0,
      'Pausada': 0,
    };
    const by_company: Record<string, number> = {
      IbogaLiv: 0,
      Olympus: 0,
      PlugAI: 0,
      Pessoal: 0,
      'Sem empresa': 0,
    };

    byStatusRows.forEach((row) => {
      if (row.status in by_status) by_status[row.status] = row.total;
    });
    byCompanyRows.forEach((row) => {
      if (row.company_name in by_company) by_company[row.company_name] = row.total;
    });

    res.json({ by_status, by_company });
  } catch (err) { next(err); }
});

router.get('/tasks/export', async (req, res, next) => {
  try {
    const db = await getDb();
    const tasks   = await db.all('SELECT * FROM tasks ORDER BY created_at DESC');
    const history = await db.all('SELECT * FROM task_status_history ORDER BY changed_at DESC');
    const subtasks = await db.all('SELECT * FROM subtasks ORDER BY task_id, position');

    if (req.query.format === 'csv') {
      const columns = [
        'id',
        'title',
        'company',
        'impact',
        'list_type',
        'status',
        'due_date',
        'created_at',
        'started_at',
        'completed_at',
        'duration_min',
        'notes',
      ];
      const csv = [
        columns.join(','),
        ...tasks.map((task: Record<string, unknown>) => columns.map((column) => csvEscape(task[column])).join(',')),
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="kronos_tasks.csv"');
      return res.send(csv);
    }

    res.json({ exported_at: new Date().toISOString(), source: 'kronos-tasks-v1', tasks, history, subtasks });
  } catch (err) { next(err); }
});

// â”€â”€ GET /tasks/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/tasks/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const id = Number(req.params.id);
    const task = await db.get('SELECT * FROM tasks WHERE id = ?', id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const history  = await db.all('SELECT * FROM task_status_history WHERE task_id = ? ORDER BY changed_at DESC', id);
    const subtasks = await db.all('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position', id);
    res.json({ data: { ...task, history, subtasks } });
  } catch (err) { next(err); }
});

// â”€â”€ POST /tasks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post('/tasks', async (req, res, next) => {
  try {
    const parsed = taskInput.parse(req.body);
    const task = normalizeTask(parsed);
    const db = await getDb();

    const created = await createTaskWithHistory(db, task);
    const synced = await syncTaskCalendarEvent(db, created);
    res.status(201).json({ data: synced.task, calendar_sync_failed: synced.calendarSyncFailed });
  } catch (err) { next(err); }
});

// â”€â”€ PUT /tasks/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.put('/tasks/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = taskUpdate.parse(req.body);
    const db = await getDb();
    const current = await db.get('SELECT * FROM tasks WHERE id = ?', id);
    if (!current) return res.status(404).json({ error: 'Task not found' });

    if (
      'recurrence_type' in parsed ||
      'recurrence_interval' in parsed ||
      'recurrence_next_date' in parsed ||
      'due_date' in parsed
    ) {
      const recurrenceType = parsed.recurrence_type ?? current.recurrence_type ?? 'none';
      if (recurrenceType === 'none') {
        parsed.recurrence_interval = 1;
        parsed.recurrence_next_date = null;
      } else {
        parsed.recurrence_interval = parsed.recurrence_interval ?? current.recurrence_interval ?? 1;
        parsed.recurrence_next_date = parsed.recurrence_next_date ?? calculateNextRecurrenceDate({
          due_date: parsed.due_date ?? current.due_date ?? null,
          recurrence_type: recurrenceType,
          recurrence_interval: parsed.recurrence_interval,
        });
      }
    }

    const fields = [
      'title',
      'company',
      'impact',
      'list_type',
      'due_date',
      'sync_to_calendar',
      'calendar_start_time',
      'calendar_duration_min',
      'recurrence_type',
      'recurrence_interval',
      'recurrence_next_date',
      'notes',
    ] as const;
    const updates: string[] = [];
    const values: unknown[]  = [];

    for (const field of fields) {
      if (field in parsed) {
        updates.push(`${field} = ?`);
        if (field === 'sync_to_calendar') {
          values.push(parsed[field] ? 1 : 0);
        } else if (field === 'company' || field === 'due_date' || field === 'calendar_start_time' || field === 'calendar_duration_min' || field === 'recurrence_next_date') {
          values.push(parsed[field] ?? null);
        } else {
          values.push(parsed[field] ?? '');
        }
      }
    }

    if (updates.length) {
      await db.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, [...values, id]);
    }

    if (parsed.status && parsed.status !== current.status) {
      const updatedWithStatus = await applyStatusChange(id, parsed.status);
      const synced = await syncTaskCalendarEvent(db, updatedWithStatus);
      return res.json({ data: synced.task, calendar_sync_failed: synced.calendarSyncFailed });
    }

    const updated = await db.get('SELECT * FROM tasks WHERE id = ?', id);
    const synced = await syncTaskCalendarEvent(db, updated);
    res.json({ data: synced.task, calendar_sync_failed: synced.calendarSyncFailed });
  } catch (err) { next(err); }
});

// â”€â”€ PATCH /tasks/:id/status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.patch('/tasks/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = statusInput.parse(req.body);
    const updated = await applyStatusChange(id, parsed.status);
    if (!updated) return res.status(404).json({ error: 'Task not found' });
    const db = await getDb();
    const synced = await syncTaskCalendarEvent(db, updated);
    res.json({ data: synced.task, calendar_sync_failed: synced.calendarSyncFailed });
  } catch (err) { next(err); }
});

// â”€â”€ DELETE /tasks/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.delete('/tasks/bulk', async (req, res, next) => {
  try {
    const parsed = bulkDeleteInput.parse(req.body || {});
    const ids = [...new Set(parsed.ids)];
    const db = await getDb();
    const placeholders = ids.map(() => '?').join(',');
    const rows = await db.all<{ id: number }[]>(`SELECT id FROM tasks WHERE id IN (${placeholders})`, ids);
    const existingIds = rows.map((row) => row.id);

    await db.exec('BEGIN TRANSACTION');
    try {
      if (existingIds.length) {
        const existingPlaceholders = existingIds.map(() => '?').join(',');
        await db.run(`DELETE FROM subtasks WHERE task_id IN (${existingPlaceholders})`, existingIds);
        await db.run(`DELETE FROM task_status_history WHERE task_id IN (${existingPlaceholders})`, existingIds);
        await db.run(`DELETE FROM tasks WHERE id IN (${existingPlaceholders})`, existingIds);
      }
      await db.exec('COMMIT');
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    }

    res.json({
      data: {
        deleted_count: existingIds.length,
        ids: existingIds,
      },
    });
  } catch (err) { next(err); }
});
router.delete('/tasks/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const result = await db.run('DELETE FROM tasks WHERE id = ?', Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: 'Task not found' });
    res.status(204).send();
  } catch (err) { next(err); }
});

// â”€â”€ SUBTASKS CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.get('/tasks/:id/subtasks', async (req, res, next) => {
  try {
    const db = await getDb();
    const rows = await db.all('SELECT * FROM subtasks WHERE task_id = ? ORDER BY position', Number(req.params.id));
    res.json({ data: rows });
  } catch (err) { next(err); }
});

router.post('/tasks/:id/subtasks', async (req, res, next) => {
  try {
    const db = await getDb();
    const taskId = Number(req.params.id);
    const parsed = subtaskInput.parse(req.body);
    const maxPos = await db.get('SELECT MAX(position) as pos FROM subtasks WHERE task_id = ?', taskId);
    const position = (maxPos?.pos ?? -1) + 1;
    const result = await db.run(
      'INSERT INTO subtasks (task_id, title, done, due_date, position) VALUES (?, ?, ?, ?, ?)',
      taskId, parsed.title, parsed.done ? 1 : 0, parsed.due_date ?? null, position
    );
    const created = await db.get('SELECT * FROM subtasks WHERE id = ?', result.lastID);
    res.status(201).json({ data: created });
  } catch (err) { next(err); }
});

router.patch('/subtasks/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const id = Number(req.params.id);
    const schema = z.object({
      title: z.string().trim().min(1).optional(),
      done:  z.boolean().optional(),
      due_date: nullableDueDate,
    });
    const parsed = schema.parse(req.body);
    const updates: string[] = [];
    const values: unknown[]  = [];
    if ('title' in parsed) { updates.push('title = ?'); values.push(parsed.title); }
    if ('done'  in parsed) { updates.push('done = ?');  values.push(parsed.done ? 1 : 0); }
    if ('due_date' in parsed) { updates.push('due_date = ?'); values.push(parsed.due_date ?? null); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    await db.run(`UPDATE subtasks SET ${updates.join(', ')} WHERE id = ?`, [...values, id]);
    const updated = await db.get('SELECT * FROM subtasks WHERE id = ?', id);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

router.delete('/subtasks/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    await db.run('DELETE FROM subtasks WHERE id = ?', Number(req.params.id));
    res.status(204).send();
  } catch (err) { next(err); }
});

export const tasksRouter = router;

