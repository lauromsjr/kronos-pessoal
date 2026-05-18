import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';

const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export interface ClaudeRequest {
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
}

export interface ClaudeResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function askClaude(req: ClaudeRequest): Promise<ClaudeResult> {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: req.maxTokens ?? 2048,
    system: req.systemPrompt,
    messages: [{ role: 'user', content: req.userMessage }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  return {
    text,
    inputTokens:  response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}
