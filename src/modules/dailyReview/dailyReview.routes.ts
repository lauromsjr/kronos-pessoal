import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../../database/sqlite';
import { requireApiAuth } from '../auth/auth';

const router = Router();

const startInput = z.object({
  selected_priority_task_ids: z.array(z.number().int().positive()).max(3).default([]),
});

const closeInput = z.object({
  summary: z.string().trim().max(5000).optional().default(''),
  blockers: z.string().trim().max(5000).optional().default(''),
  tomorrow_focus: z.string().trim().max(5000).optional().default(''),
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

async function getReviewByDate(reviewDate: string) {
  const db = await getDb();
  return db.get('SELECT * FROM daily_reviews WHERE review_date = ?', reviewDate);
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

export const dailyReviewRouter = router;
