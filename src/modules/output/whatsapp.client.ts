import axios from 'axios';
import { env } from '../../config/env';

const evolutionHttp = axios.create({
  baseURL: env.EVOLUTION_API_URL,
  headers: { apikey: env.EVOLUTION_API_KEY },
});

export async function sendWhatsApp(to: string, text: string): Promise<void> {
  const path = `/message/sendText/${env.EVOLUTION_INSTANCE}`;
  const body = { number: to, text };

  console.log(`[whatsapp] POST ${env.EVOLUTION_API_URL}${path}`);
  console.log(`[whatsapp] body:`, JSON.stringify(body));

  try {
    const response = await evolutionHttp.post(path, body);
    console.log(`[whatsapp] status: ${response.status}`);
    console.log(`[whatsapp] response:`, JSON.stringify(response.data));
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      console.error(`[whatsapp] erro ${err.response?.status ?? 'sem status'}:`, JSON.stringify(err.response?.data ?? err.message));
    } else {
      console.error('[whatsapp] erro inesperado:', err);
    }
    throw err;
  }
}
