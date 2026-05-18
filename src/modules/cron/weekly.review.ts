import { CronJob } from 'cron';

// Toda sexta às 18h — revisão semanal e backup no Drive
// TODO (Sábado 19/04): implementar lógica completa
//   1. Agrupa learnings da semana
//   2. Identifica padrões repetidos nas interações
//   3. Envia resumo no WhatsApp
//   4. Aguarda "sim" do Lauro → edita .md + backup Drive

export const weeklyReviewJob = new CronJob(
  '0 18 * * 5', // sexta-feira às 18h
  async () => {
    console.log('[cron] weekly.review iniciado');
    // TODO: implementar
  },
  null,
  false,
  'America/Sao_Paulo'
);
