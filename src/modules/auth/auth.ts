import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';

const COOKIE_NAME = 'kronos_session';
const HASH_ITERATIONS = 310000;
const HASH_KEY_LENGTH = 32;
const HASH_DIGEST = 'sha256';

type SessionPayload = {
  username: string;
  exp: number;
};

function base64url(input: Buffer | string) {
  return Buffer.from(input).toString('base64url');
}

function getUsername() {
  return process.env.KRONOS_AUTH_USERNAME || 'lauro';
}

function getSessionDays() {
  const days = Number(process.env.KRONOS_SESSION_DAYS || 30);
  return Number.isFinite(days) && days > 0 ? days : 30;
}

function getSessionSecret() {
  return process.env.KRONOS_SESSION_SECRET || '';
}

function getPasswordHash() {
  return process.env.KRONOS_AUTH_PASSWORD_HASH || '';
}

export function isAuthConfigured() {
  return Boolean(getPasswordHash() && getSessionSecret());
}

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('base64url')) {
  const hash = crypto.pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEY_LENGTH, HASH_DIGEST).toString('base64url');
  return `pbkdf2:${HASH_ITERATIONS}:${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [scheme, iterationsValue, salt, expected] = storedHash.split(':');
  if (scheme !== 'pbkdf2' || !iterationsValue || !salt || !expected) return false;

  const iterations = Number(iterationsValue);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;

  const actual = crypto.pbkdf2Sync(password, salt, iterations, Buffer.from(expected, 'base64url').length, HASH_DIGEST);
  const expectedBuffer = Buffer.from(expected, 'base64url');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function sign(payload: string) {
  return crypto.createHmac('sha256', getSessionSecret()).update(payload).digest('base64url');
}

function signaturesMatch(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, 'base64url');
  const expectedBuffer = Buffer.from(expected, 'base64url');
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseCookies(cookieHeader?: string) {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((part) => {
    const index = part.indexOf('=');
    if (index === -1) return;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  });

  return cookies;
}

export function createSessionCookie(username = getUsername()) {
  const maxAgeSeconds = getSessionDays() * 24 * 60 * 60;
  const payload: SessionPayload = {
    username,
    exp: Math.floor(Date.now() / 1000) + maxAgeSeconds,
  };
  const encodedPayload = base64url(JSON.stringify(payload));
  return {
    value: `${encodedPayload}.${sign(encodedPayload)}`,
    maxAgeMs: maxAgeSeconds * 1000,
  };
}

export function setSessionCookie(res: Response, value: string, maxAgeMs: number) {
  res.cookie(COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: maxAgeMs,
    path: '/',
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

export function getSessionUser(req: Request) {
  if (!isAuthConfigured()) return null;

  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature || !signaturesMatch(sign(payload), signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.username || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    if (parsed.username !== getUsername()) return null;
    return { username: parsed.username };
  } catch {
    return null;
  }
}

export function validateLogin(username: string, password: string) {
  if (!isAuthConfigured()) return false;
  if (username !== getUsername()) return false;
  return verifyPassword(password, getPasswordHash());
}

export function requireApiAuth(req: Request, res: Response, next: NextFunction) {
  if (getSessionUser(req)) return next();

  const expectedApiKey = process.env.KRONOS_API_KEY;
  if (expectedApiKey && req.header('X-Api-Key') === expectedApiKey) return next();

  if (!expectedApiKey && !isAuthConfigured()) return next();

  return res.status(401).json({ error: 'Unauthorized' });
}
