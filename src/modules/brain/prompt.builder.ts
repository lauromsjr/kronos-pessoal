import { Intent, KronosLearning, LoadedContext } from '../../shared/types';

export function buildSystemPrompt(intent: Intent, ctx: LoadedContext): string {
  const sections: string[] = [];

  // Blocos de contexto estático (.md)
  for (const content of ctx.staticFiles) {
    const trimmed = content.trim();
    if (trimmed) sections.push(trimmed);
  }

  // Regras aprendidas dinamicamente do banco
  if (ctx.learnings.length > 0) {
    const rules = ctx.learnings
      .map((l: KronosLearning) => `- [${l.category}] ${l.new_rule}`)
      .join('\n');
    sections.push(`## REGRAS APRENDIDAS\n${rules}`);
  }

  // Contexto da requisição atual
  sections.push(
    `## CONTEXTO DA REQUISIÇÃO\nNegócio detectado: ${intent.business}\nCategoria: ${intent.category}\nSession ID: ${intent.sessionId}`
  );

  return sections.join('\n\n---\n\n');
}
