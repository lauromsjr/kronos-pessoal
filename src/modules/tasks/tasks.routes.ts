import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../database/sqlite';

const router = Router();

const companies = ['IbogaLiv', 'Olympus', 'PlugAI', 'Pessoal'] as const;
const impacts = ['Alto', 'Médio', 'Baixo'] as const;
const listTypes = ['Tarefa', 'Backlog', 'Ideia'] as const;
const statuses = ['A fazer', 'Em andamento', 'Concluída', 'Pausada'] as const;

const taskInput = z.object({
  title: z.string().trim().min(1),
  company: z.enum(companies).nullable().optional(),
  impact: z.enum(impacts).nullable().optional(),
  list_type: z.enum(listTypes).nullable().optional(),
  status: z.enum(statuses).nullable().optional(),
  notes: z.string().nullable().optional(),
});

const taskUpdate = taskInput.partial().extend({
  title: z.string().trim().min(1).optional(),
});

const statusInput = z.object({
  status: z.enum(statuses),
});

function normalizeTask(input: z.infer<typeof taskInput>) {
  return {
    title: input.title,
    company: input.company || 'PlugAI',
    impact: input.impact || 'Médio',
    list_type: input.list_type || 'Tarefa',
    status: input.status || 'A fazer',
    notes: input.notes || '',
  };
}

async function applyStatusChange(taskId: number, nextStatus: string) {
  const db = await getDb();
  const current = await db.get('SELECT * FROM tasks WHERE id = ?', taskId);
  if (!current) return null;

  const updates: string[] = ['status = ?'];
  const values: unknown[] = [nextStatus];

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
      taskId,
      current.status,
      nextStatus
    );
  }

  return db.get('SELECT * FROM tasks WHERE id = ?', taskId);
}

router.get('/tasks', async (req, res, next) => {
  try {
    const db = await getDb();
    const filterMap = {
      list: 'list_type',
      company: 'company',
      impact: 'impact',
      status: 'status',
    } as const;
    const where: string[] = [];
    const values: string[] = [];

    for (const [queryKey, column] of Object.entries(filterMap)) {
      const value = req.query[queryKey];
      if (typeof value === 'string' && value.trim()) {
        where.push(`${column} = ?`);
        values.push(value);
      }
    }

    const rows = await db.all(
      `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY
         CASE status WHEN 'Em andamento' THEN 0 WHEN 'A fazer' THEN 1 WHEN 'Pausada' THEN 2 ELSE 3 END,
         created_at DESC`,
      values
    );

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
});

router.get('/tasks/export', async (_req, res, next) => {
  try {
    const db = await getDb();
    const tasks = await db.all('SELECT * FROM tasks ORDER BY created_at DESC');
    const history = await db.all('SELECT * FROM task_status_history ORDER BY changed_at DESC');
    res.json({
      exported_at: new Date().toISOString(),
      source: 'kronos-tasks-v1',
      tasks,
      history,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/tasks/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const id = Number(req.params.id);
    const task = await db.get('SELECT * FROM tasks WHERE id = ?', id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const history = await db.all(
      'SELECT * FROM task_status_history WHERE task_id = ? ORDER BY changed_at DESC',
      id
    );
    res.json({ data: { ...task, history } });
  } catch (err) {
    next(err);
  }
});

router.post('/tasks', async (req, res, next) => {
  try {
    const parsed = taskInput.parse(req.body);
    const task = normalizeTask(parsed);
    const db = await getDb();

    const result = await db.run(
      `INSERT INTO tasks (title, company, impact, list_type, status, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      task.title,
      task.company,
      task.impact,
      task.list_type,
      task.status,
      task.notes
    );

    await db.run(
      'INSERT INTO task_status_history (task_id, from_status, to_status) VALUES (?, NULL, ?)',
      result.lastID,
      task.status
    );

    const created = await db.get('SELECT * FROM tasks WHERE id = ?', result.lastID);
    res.status(201).json({ data: created });
  } catch (err) {
    next(err);
  }
});

router.put('/tasks/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = taskUpdate.parse(req.body);
    const db = await getDb();
    const current = await db.get('SELECT * FROM tasks WHERE id = ?', id);
    if (!current) return res.status(404).json({ error: 'Task not found' });

    const fields = ['title', 'company', 'impact', 'list_type', 'notes'] as const;
    const updates: string[] = [];
    const values: unknown[] = [];

    for (const field of fields) {
      if (field in parsed) {
        updates.push(`${field} = ?`);
        values.push(parsed[field] ?? '');
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
  } catch (err) {
    next(err);
  }
});

router.patch('/tasks/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const parsed = statusInput.parse(req.body);
    const updated = await applyStatusChange(id, parsed.status);
    if (!updated) return res.status(404).json({ error: 'Task not found' });
    res.json({ data: updated });
  } catch (err) {
    next(err);
  }
});

router.delete('/tasks/:id', async (req, res, next) => {
  try {
    const db = await getDb();
    const result = await db.run('DELETE FROM tasks WHERE id = ?', Number(req.params.id));
    if (!result.changes) return res.status(404).json({ error: 'Task not found' });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export const tasksRouter = router;
