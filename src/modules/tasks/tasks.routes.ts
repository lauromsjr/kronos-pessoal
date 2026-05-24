import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../database/sqlite';
import { requireApiAuth } from '../auth/auth';

const router = Router();

const companies  = ['IbogaLiv', 'Olympus', 'PlugAI', 'Pessoal'] as const;
const impacts    = ['Alto', 'Médio', 'Baixo'] as const;
const listTypes  = ['Tarefa', 'Backlog', 'Ideia'] as const;
const statuses   = ['A fazer', 'Em andamento', 'Concluída', 'Pausada'] as const;

const nullableCompany = z.preprocess(
  (value) => value === '' ? null : value,
  z.enum(companies).nullable().optional()
);

const nullableDueDate = z.preprocess(
  (value) => value === '' ? null : value,
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()
);

const taskInput = z.object({
  title:     z.string().trim().min(1),
  company:   nullableCompany,
  impact:    z.enum(impacts).nullable().optional(),
  list_type: z.enum(listTypes).nullable().optional(),
  status:    z.enum(statuses).nullable().optional(),
  due_date:  nullableDueDate,
  notes:     z.string().nullable().optional(),
});

const taskUpdate = taskInput.partial().extend({
  title: z.string().trim().min(1).optional(),
});

const statusInput = z.object({ status: z.enum(statuses) });

const subtaskInput = z.object({
  title: z.string().trim().min(1),
  done:  z.boolean().optional().default(false),
});

// ── Init subtasks table ──────────────────────────────────────────────────────

export async function ensureSubtasksTable() {
  const db = await getDb();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS subtasks (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id    INTEGER NOT NULL,
      title      TEXT NOT NULL,
      done       INTEGER NOT NULL DEFAULT 0,
      position   INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id, position);
  `);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTask(input: z.infer<typeof taskInput>) {
  return {
    title:     input.title,
    company:   input.company ?? null,
    impact:    input.impact    || 'Médio',
    list_type: input.list_type || 'Tarefa',
    status:    input.status    || 'A fazer',
    due_date:  input.due_date ?? null,
    notes:     input.notes     || '',
  };
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

  if (nextStatus === 'Concluída') {
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

async function getTodayBucket(
  db: Awaited<ReturnType<typeof getDb>>,
  where: string,
  values: unknown[],
  orderBy: string
) {
  const rows = await db.all(
    `SELECT * FROM tasks
     WHERE status != 'Concluída' AND ${where}
     ORDER BY ${orderBy}`,
    values
  );

  return attachSubtaskCounts(db, rows);
}

// ── GET /tasks ───────────────────────────────────────────────────────────────

router.get('/tasks', async (req, res, next) => {
  try {
    const db = await getDb();
    const filterMap = { list: 'list_type', company: 'company', impact: 'impact', status: 'status' } as const;
    const where: string[] = [];
    const values: unknown[] = [];
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const isCompletedList = req.query.list === 'Concluida';

    // Aba "Concluídas" — retorna todas concluídas independente de list_type
    if (isCompletedList) {
      where.push("status = 'Concluída'");
      for (const [queryKey, column] of Object.entries(filterMap)) {
        if (queryKey === 'list' || queryKey === 'status') continue;
        const value = req.query[queryKey];
        if (typeof value === 'string' && value.trim()) {
          where.push(`${column} = ?`);
          values.push(value);
        }
      }
    } else {
      // Nas outras abas, excluir concluídas
      where.push("status != 'Concluída'");
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
           CASE impact WHEN 'Alto' THEN 0 WHEN 'Médio' THEN 1 ELSE 2 END,
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
      CASE impact WHEN 'Alto' THEN 0 WHEN 'Médio' THEN 1 ELSE 2 END,
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

// ── GET /tasks/export ────────────────────────────────────────────────────────

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
      'Concluída': 0,
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

// ── GET /tasks/:id ───────────────────────────────────────────────────────────

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

// ── POST /tasks ──────────────────────────────────────────────────────────────

router.post('/tasks', async (req, res, next) => {
  try {
    const parsed = taskInput.parse(req.body);
    const task = normalizeTask(parsed);
    const db = await getDb();

    const result = await db.run(
      `INSERT INTO tasks (title, company, impact, list_type, status, due_date, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      task.title, task.company, task.impact, task.list_type, task.status, task.due_date, task.notes
    );

    await db.run(
      'INSERT INTO task_status_history (task_id, from_status, to_status) VALUES (?, NULL, ?)',
      result.lastID, task.status
    );

    const created = await db.get('SELECT * FROM tasks WHERE id = ?', result.lastID);
    res.status(201).json({ data: created });
  } catch (err) { next(err); }
});

// ── PUT /tasks/:id ───────────────────────────────────────────────────────────

router.put('/tasks/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = taskUpdate.parse(req.body);
    const db = await getDb();
    const current = await db.get('SELECT * FROM tasks WHERE id = ?', id);
    if (!current) return res.status(404).json({ error: 'Task not found' });

    const fields = ['title', 'company', 'impact', 'list_type', 'due_date', 'notes'] as const;
    const updates: string[] = [];
    const values: unknown[]  = [];

    for (const field of fields) {
      if (field in parsed) {
        updates.push(`${field} = ?`);
        values.push(field === 'company' || field === 'due_date' ? parsed[field] ?? null : parsed[field] ?? '');
      }
    }

    if (updates.length) {
      await db.run(`UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`, [...values, id]);
    }

    if (parsed.status && parsed.status !== current.status) {
      const updatedWithStatus = await applyStatusChange(id, parsed.status);
      return res.json({ data: updatedWithStatus });
    }

    const updated = await db.get('SELECT * FROM tasks WHERE id = ?', id);
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// ── PATCH /tasks/:id/status ──────────────────────────────────────────────────

router.patch('/tasks/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = statusInput.parse(req.body);
    const updated = await applyStatusChange(id, parsed.status);
    if (!updated) return res.status(404).json({ error: 'Task not found' });
    res.json({ data: updated });
  } catch (err) { next(err); }
});

// ── DELETE /tasks/:id ────────────────────────────────────────────────────────

router.delete('/tasks/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const result = await db.run('DELETE FROM tasks WHERE id = ?', Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: 'Task not found' });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ── SUBTASKS CRUD ────────────────────────────────────────────────────────────

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
      'INSERT INTO subtasks (task_id, title, done, position) VALUES (?, ?, ?, ?)',
      taskId, parsed.title, parsed.done ? 1 : 0, position
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
    });
    const parsed = schema.parse(req.body);
    const updates: string[] = [];
    const values: unknown[]  = [];
    if ('title' in parsed) { updates.push('title = ?'); values.push(parsed.title); }
    if ('done'  in parsed) { updates.push('done = ?');  values.push(parsed.done ? 1 : 0); }
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
