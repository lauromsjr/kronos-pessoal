import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('3002'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Anthropic — obrigatório para o pipeline funcionar
  ANTHROPIC_API_KEY: z.string().min(1),

  // PostgreSQL — opcional localmente; migrações são puladas se ausente
  DATABASE_URL: z.string().optional(),

  // Evolution API — opcional (necessário só para envio via WhatsApp)
  EVOLUTION_API_URL: z.string().url().optional(),
  EVOLUTION_API_KEY: z.string().optional(),
  EVOLUTION_INSTANCE: z.string().default('kronos'),

  // PlugAI API — opcional (necessário só para consultas CRM)
  PLUGAI_API_URL: z.string().url().optional(),
  PLUGAI_JWT: z.string().optional(),

  // Google — opcional (necessário só para Drive/Calendar)
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  GOOGLE_DRIVE_FOLDER_ID: z.string().optional(),

  // Whitelist — opcional localmente (sem whitelist = aceita qualquer número)
  LAURO_PHONE: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Variáveis de ambiente inválidas:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
