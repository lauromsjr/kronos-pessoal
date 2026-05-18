// ─── Payload de entrada (vem do n8n) ───────────────────────────────────────

export interface IncomingMessage {
  phone: string;
  message: string;
  type: 'text' | 'audio' | 'image';
  sessionId?: string;
}

// ─── Intenção identificada pelo router ─────────────────────────────────────

export type Business = 'ibogaliv' | 'olympus' | 'plugai' | 'pessoal';

export type IntentCategory =
  | 'conteudo'
  | 'crm'
  | 'agenda'
  | 'financeiro'
  | 'estrategia'
  | 'geral';

export interface Intent {
  business: Business;
  category: IntentCategory;
  rawMessage: string;
  sessionId: string;
}

// ─── Contexto carregado para o prompt ──────────────────────────────────────

export interface LoadedContext {
  staticFiles: string[];        // conteúdo dos .md relevantes
  learnings: KronosLearning[];  // regras aprendidas do PostgreSQL
}

// ─── Modelos do banco ───────────────────────────────────────────────────────

export interface KronosLearning {
  id: string;
  context: Business;
  category: IntentCategory;
  what_happened: string;
  new_rule: string;
  applied_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface KronosInteraction {
  id: string;
  session_id: string | null;
  input_text: string;
  intent: string | null;
  contexts_loaded: string[];
  output_text: string | null;
  output_channel: OutputChannel | null;
  tokens_used: number | null;
  duration_ms: number | null;
  had_feedback: boolean;
  created_at: Date;
}

export interface KronosPattern {
  id: string;
  name: string;
  context: Business;
  pattern_type: 'copy' | 'estrutura' | 'fluxo';
  content: string;
  usage_count: number;
  approved_at: Date;
  updated_at: Date;
}

export interface KronosDevBacklog {
  id: string;
  requested_at: Date;
  description: string;
  what_is_needed: string;
  status: 'pending' | 'done';
  priority: 'low' | 'medium' | 'high';
}

// ─── Saída ──────────────────────────────────────────────────────────────────

export type OutputChannel = 'whatsapp' | 'drive' | 'sheets';

export interface KronosResponse {
  text: string;
  channel: OutputChannel;
  driveUrl?: string;
  tokensUsed?: number;
  durationMs?: number;
}
