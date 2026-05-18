import { Business, Intent, IntentCategory } from '../../shared/types';
import { insertLearning } from './memory.repository';

// Palavras que indicam feedback negativo do Lauro
const FEEDBACK_TRIGGERS = [
  'não era isso',
  'ajusta',
  'errado',
  'muda',
  'prefiro',
  'não gostei',
  'corrige',
  'diferente',
  'não foi isso',
];

export function hasFeedback(message: string): boolean {
  const lower = message.toLowerCase();
  return FEEDBACK_TRIGGERS.some((trigger) => lower.includes(trigger));
}

export async function processFeedback(
  message: string,
  intent: Intent
): Promise<void> {
  if (!hasFeedback(message)) return;

  // TODO: usar Claude para extrair o aprendizado estruturado da mensagem de feedback
  // Por enquanto registra o texto bruto
  await insertLearning(
    intent.business as Business,
    intent.category as IntentCategory,
    message,
    `Feedback recebido: ${message}`
  );
}
