import { Router } from 'express';
import { z } from 'zod';
import {
  clearSessionCookie,
  createSessionCookie,
  getSessionUser,
  isAuthConfigured,
  setSessionCookie,
  validateLogin,
} from './auth';

const router = Router();

const loginInput = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

router.post('/auth/login', (req, res) => {
  const parsed = loginInput.parse(req.body);

  if (!validateLogin(parsed.username, parsed.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const session = createSessionCookie(parsed.username);
  setSessionCookie(res, session.value, session.maxAgeMs);

  return res.json({ ok: true, user: { username: parsed.username } });
});

router.get('/auth/me', (req, res) => {
  if (!isAuthConfigured() && !process.env.KRONOS_API_KEY) {
    return res.json({ authenticated: true, user: { username: 'development' } });
  }

  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ authenticated: false });

  return res.json({ authenticated: true, user });
});

router.post('/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  return res.json({ ok: true });
});

export const authRouter = router;
