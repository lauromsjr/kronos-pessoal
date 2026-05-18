import { Router, Request, Response } from 'express';
import { IncomingMessage } from '../../shared/types';
import { badRequest, internalError, ok, unauthorized } from '../../shared/utils/response';
import { detectIntent } from '../router/intent.router';
import { loadContext } from '../brain/context.loader';
import { buildSystemPrompt } from '../brain/prompt.builder';
import { askClaude } from '../brain/claude.client';
import { decideOutputChannel, handleOutput } from '../output/output.handler';
import { env } from '../../config/env';

export const webhookRouter = Router();

webhookRouter.post('/message', async (req: Request, res: Response) => {
  const start = Date.now();

  try {
    const body = req.body as Partial<IncomingMessage>;

    // Validação de campos obrigatórios
    if (!body.phone || !body.message) {
      return badRequest(res, 'phone e message são obrigatórios');
    }

    // Whitelist — compara últimos 11 dígitos (DDD + número) para tolerar variações de código de país
    const normalizePhone = (p: string) =>
      p.replace(/@s\.whatsapp\.net|@c\.us/g, '').replace(/[\s\-]/g, '').slice(-11);

    if (env.LAURO_PHONE && normalizePhone(body.phone) !== normalizePhone(env.LAURO_PHONE)) {
      return unauthorized(res);
    }

    const msg: IncomingMessage = {
      phone:     body.phone,
      message:   body.message,
      type:      body.type ?? 'text',
      sessionId: body.sessionId,
    };

    // 1. Detectar negócio + intenção
    const intent = detectIntent(msg);
    console.log(`[webhook] intent: ${intent.business}/${intent.category}`);

    // 2. Carregar contexto (.md relevantes + learnings do banco)
    const ctx = await loadContext(intent);
    console.log(`[webhook] contextos carregados: ${ctx.staticFiles.length} arquivos, ${ctx.learnings.length} learnings`);

    // 3. Montar system prompt
    const systemPrompt = buildSystemPrompt(intent, ctx);

    // 4. Consultar Claude API
    const claudeResult = await askClaude({
      systemPrompt,
      userMessage: msg.message,
    });

    const durationMs = Date.now() - start;
    console.log(`[webhook] tokens: ${claudeResult.inputTokens}in/${claudeResult.outputTokens}out | ${durationMs}ms`);

    // 5. Enviar resposta ao canal de saída (WhatsApp ou Drive)
    const channel = decideOutputChannel(intent.category, claudeResult.text.length);
    await handleOutput(msg.phone, { text: claudeResult.text, channel });

    // 6. Retornar resposta HTTP
    return ok(res, {
      reply:       claudeResult.text,
      intent:      `${intent.business}/${intent.category}`,
      tokensUsed:  claudeResult.inputTokens + claudeResult.outputTokens,
      durationMs,
    });
  } catch (err) {
    console.error('[webhook] erro:', err);
    return internalError(res, err);
  }
});
