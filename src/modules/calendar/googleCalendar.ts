import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Credentials, OAuth2Client } from 'google-auth-library';
import { calendar_v3, google } from 'googleapis';

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const DEFAULT_TOKEN_PATH = '/app/data/google_calendar_token.json';
const COMPANIES = ['Olympus', 'IbogaLiv', 'PlugAI', 'Pessoal'] as const;

type CalendarRange = 'today' | 'tomorrow' | 'week';
type Company = typeof COMPANIES[number];

export type CalendarEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  all_day: boolean;
  location?: string;
  source: 'google_calendar';
  company?: Company | null;
};

function getCalendarId() {
  return process.env.GOOGLE_CALENDAR_ID || 'primary';
}

function getTokenPath() {
  return process.env.GOOGLE_OAUTH_TOKEN_PATH || DEFAULT_TOKEN_PATH;
}

function getRedirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3002/api/calendar/oauth/callback';
}

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Google Calendar OAuth not configured');
  }

  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri());
}

async function readStoredTokens() {
  try {
    const raw = await fs.promises.readFile(getTokenPath(), 'utf8');
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

async function saveTokens(tokens: Credentials) {
  const tokenPath = getTokenPath();
  await fs.promises.mkdir(path.dirname(tokenPath), { recursive: true });

  const existing = await readStoredTokens();
  const merged = { ...existing, ...tokens };
  await fs.promises.writeFile(tokenPath, JSON.stringify(merged, null, 2), { mode: 0o600 });
}

async function getAuthorizedClient() {
  const tokens = await readStoredTokens();
  if (!tokens) return null;

  const client = getOAuthClient();
  client.setCredentials(tokens);
  client.on('tokens', (updatedTokens) => {
    saveTokens(updatedTokens).catch((err) => console.error('[calendar] failed to persist refreshed token', err));
  });

  return client;
}

function getStateSecret() {
  return process.env.KRONOS_SESSION_SECRET
    || process.env.KRONOS_API_KEY
    || process.env.GOOGLE_CLIENT_SECRET
    || 'kronos-calendar-development';
}

function signStatePayload(payload: string) {
  return crypto.createHmac('sha256', getStateSecret()).update(payload).digest('base64url');
}

export function createOAuthState() {
  const payload = Buffer.from(JSON.stringify({
    ts: Date.now(),
    nonce: crypto.randomBytes(16).toString('base64url'),
  })).toString('base64url');

  return `${payload}.${signStatePayload(payload)}`;
}

export function verifyOAuthState(state?: string) {
  if (!state) return false;
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return false;

  const expected = signStatePayload(payload);
  const actualBuffer = Buffer.from(signature, 'base64url');
  const expectedBuffer = Buffer.from(expected, 'base64url');
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { ts?: number };
    return Boolean(parsed.ts && Date.now() - parsed.ts < 15 * 60 * 1000);
  } catch {
    return false;
  }
}

export function getCalendarStatus() {
  return {
    connected: fs.existsSync(getTokenPath()),
    calendar_id: getCalendarId(),
  };
}

export function getOAuthStartUrl() {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [CALENDAR_SCOPE],
    state: createOAuthState(),
  });
}

export async function handleOAuthCallback(code: string) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);
  await saveTokens(tokens);
}

function dateInSaoPaulo(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(date: string, days: number) {
  const next = new Date(`${date}T00:00:00-03:00`);
  next.setUTCDate(next.getUTCDate() + days);
  return dateInSaoPaulo(next);
}

function getRangeBounds(range: CalendarRange) {
  const today = dateInSaoPaulo();
  const startDate = range === 'tomorrow' ? addDays(today, 1) : today;
  const days = range === 'week' ? 7 : 1;
  const endDate = addDays(startDate, days);

  return {
    timeMin: `${startDate}T00:00:00-03:00`,
    timeMax: `${endDate}T00:00:00-03:00`,
  };
}

function detectCompany(title: string) {
  const match = title.match(/^\[(Olympus|IbogaLiv|PlugAI|Pessoal)\]/);
  return match ? match[1] as Company : null;
}

function normalizeEvent(event: calendar_v3.Schema$Event): CalendarEvent | null {
  const startValue = event.start?.dateTime || event.start?.date;
  const endValue = event.end?.dateTime || event.end?.date;
  if (!event.id || !startValue || !endValue) return null;

  const title = event.summary || 'Sem titulo';
  return {
    id: event.id,
    title,
    start: startValue,
    end: endValue,
    all_day: Boolean(event.start?.date),
    location: event.location || undefined,
    source: 'google_calendar',
    company: detectCompany(title),
  };
}

export async function listCalendarEvents(range: CalendarRange) {
  const auth = await getAuthorizedClient();
  if (!auth) return { connected: false, data: [] as CalendarEvent[] };

  const calendar = google.calendar({ version: 'v3', auth: auth as OAuth2Client });
  const { timeMin, timeMax } = getRangeBounds(range);
  const response = await calendar.events.list({
    calendarId: getCalendarId(),
    timeMin,
    timeMax,
    timeZone: 'America/Sao_Paulo',
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  });

  return {
    connected: true,
    data: (response.data.items || []).map(normalizeEvent).filter((item): item is CalendarEvent => Boolean(item)),
  };
}
