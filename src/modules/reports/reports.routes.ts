import { Router } from 'express';
import { getDb } from '../../database/sqlite';
import { requireApiAuth } from '../auth/auth';

const router = Router();
const SAO_PAULO_SQLITE_OFFSET = '-3 hours';

function dateKeySaoPaulo(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getWeeklyRange() {
  const end = dateKeySaoPaulo(new Date());
  const startDate = new Date(`${end}T12:00:00Z`);
  startDate.setUTCDate(startDate.getUTCDate() - 6);
  return {
    start: dateKeySaoPaulo(startDate),
    end,
  };
}

function normalizePriorityIds(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((id) => Number.isInteger(id))
      : [];
  } catch {
    return [];
  }
}

function normalizeReview(row: any) {
  const status = ['not_started', 'started', 'closed'].includes(row.status)
    ? row.status
    : 'not_started';

  return {
    review_date: row.review_date,
    status,
    selected_priority_task_ids: normalizePriorityIds(row.selected_priority_task_ids),
    summary: row.summary || '',
    blockers: row.blockers || '',
    tomorrow_focus: row.tomorrow_focus || '',
    started_at: row.started_at || null,
    ended_at: row.ended_at || null,
  };
}

router.use('/reports', requireApiAuth);

router.get('/reports/weekly', async (_req, res, next) => {
  try {
    const range = getWeeklyRange();
    const db = await getDb();

    const [createdTasks, completedTasks, reviewRows] = await Promise.all([
      db.all(
        `SELECT id, title, company, impact, created_at
         FROM tasks
         WHERE date(created_at, ?) BETWEEN ? AND ?
         ORDER BY created_at DESC`,
        SAO_PAULO_SQLITE_OFFSET,
        range.start,
        range.end
      ),
      db.all(
        `SELECT id, title, company, impact, completed_at
         FROM tasks
         WHERE completed_at IS NOT NULL
           AND date(completed_at, ?) BETWEEN ? AND ?
         ORDER BY completed_at DESC`,
        SAO_PAULO_SQLITE_OFFSET,
        range.start,
        range.end
      ),
      db.all(
        `SELECT review_date, status, selected_priority_task_ids, summary, blockers,
                tomorrow_focus, started_at, ended_at
         FROM daily_reviews
         WHERE review_date BETWEEN ? AND ?
         ORDER BY review_date DESC`,
        range.start,
        range.end
      ),
    ]);

    const dailyReviews = reviewRows.map(normalizeReview);
    const blockers = dailyReviews
      .filter((review) => review.blockers.trim())
      .map((review) => ({ review_date: review.review_date, text: review.blockers }));
    const tomorrowFocus = dailyReviews
      .filter((review) => review.tomorrow_focus.trim())
      .map((review) => ({ review_date: review.review_date, text: review.tomorrow_focus }));

    res.json({
      range,
      summary: {
        tasks_created: createdTasks.length,
        tasks_completed: completedTasks.length,
        daily_reviews_started: dailyReviews.filter((review) => Boolean(review.started_at)).length,
        daily_reviews_closed: dailyReviews.filter((review) => review.status === 'closed' || Boolean(review.ended_at)).length,
        priority_count: dailyReviews.reduce((total, review) => total + review.selected_priority_task_ids.length, 0),
        blocker_count: blockers.length,
      },
      completed_tasks: completedTasks,
      created_tasks: createdTasks,
      daily_reviews: dailyReviews,
      blockers,
      tomorrow_focus: tomorrowFocus,
    });
  } catch (err) {
    next(err);
  }
});

export const reportsRouter = router;
