import { IntentCategory, KronosResponse, OutputChannel } from '../../shared/types';
import { sendWhatsApp } from './whatsapp.client';

// Regra de saída conforme SISTEMA_KRONOS.md seção 6
const LONG_OUTPUT_CATEGORIES: IntentCategory[] = ['conteudo', 'crm', 'financeiro', 'estrategia'];

export function decideOutputChannel(
  _category: IntentCategory,
  _textLength: number
): OutputChannel {
  // Drive não implementado — forçar whatsapp até lá
  return 'whatsapp';
}

export async function handleOutput(phone: string, response: KronosResponse): Promise<void> {
  if (response.channel === 'whatsapp') {
    await sendWhatsApp(phone, response.text);
    return;
  }

  // drive e sheets ainda não implementados — loga sem quebrar o fluxo
  console.warn(`[output] canal '${response.channel}' não implementado — resposta não enviada ao destino.`);
}
