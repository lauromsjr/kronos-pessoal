import { Router } from 'express';
import { z } from 'zod';
import { requireApiAuth } from '../auth/auth';
import {
  getCalendarStatus,
  getOAuthStartUrl,
  disconnectGoogleCalendar,
  handleOAuthCallback,
  listCalendarEvents,
  verifyOAuthState,
} from './googleCalendar';

const router = Router();

router.get('/calendar/status', requireApiAuth, (_req, res) => {
  res.json(getCalendarStatus());
});

router.get('/calendar/oauth/start', requireApiAuth, (_req, res, next) => {
  try {
    res.json({ url: getOAuthStartUrl() });
  } catch (err) {
    next(err);
  }
});

router.post('/calendar/disconnect', requireApiAuth, async (_req, res, next) => {
  try {
    res.json(await disconnectGoogleCalendar());
  } catch (err) {
    next(err);
  }
});

router.get('/calendar/oauth/callback', async (req, res, next) => {
  try {
    const code = z.string().min(1).parse(req.query.code);
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;

    if (!verifyOAuthState(state)) {
      return res.status(400).json({ error: 'Invalid OAuth state' });
    }

    await handleOAuthCallback(code);
    return res.redirect('/');
  } catch (err) {
    return next(err);
  }
});

router.get('/calendar/events', requireApiAuth, async (req, res, next) => {
  try {
    const range = z.enum(['today', 'tomorrow', 'week']).default('today').parse(req.query.range);
    const result = await listCalendarEvents(range);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export const calendarRouter = router;
