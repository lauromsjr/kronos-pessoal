import { Response } from 'express';

export function ok(res: Response, data: unknown) {
  return res.status(200).json({ ok: true, data });
}

export function created(res: Response, data: unknown) {
  return res.status(201).json({ ok: true, data });
}

export function badRequest(res: Response, message: string) {
  return res.status(400).json({ ok: false, error: message });
}

export function unauthorized(res: Response) {
  return res.status(401).json({ ok: false, error: 'Unauthorized' });
}

export function internalError(res: Response, error: unknown) {
  const message = error instanceof Error ? error.message : 'Internal server error';
  return res.status(500).json({ ok: false, error: message });
}

export const NOT_IMPLEMENTED_MESSAGE = (description: string, needed: string) =>
  `⚠️ Kronos ainda não tem essa funcionalidade.\n` +
  `📋 Demanda: ${description}\n` +
  `🔧 Necessário: ${needed}\n` +
  `➡️ Registrei no backlog. Me leva ao Claude Code para a gente desenvolver.`;
