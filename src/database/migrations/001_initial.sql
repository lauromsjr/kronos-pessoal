-- Kronos — schema inicial
-- Migration: 001_initial.sql

-- Aprendizados dinâmicos (memória de médio/longo prazo)
CREATE TABLE IF NOT EXISTS kronos_learnings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  context       VARCHAR(50)  NOT NULL,  -- ibogaliv | olympus | plugai | pessoal
  category      VARCHAR(50)  NOT NULL,  -- conteudo | crm | agenda | geral
  what_happened TEXT         NOT NULL,  -- o que o Lauro corrigiu
  new_rule      TEXT         NOT NULL,  -- regra aprendida
  applied_count INT          DEFAULT 0,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- Backlog de funcionalidades não implementadas
CREATE TABLE IF NOT EXISTS kronos_dev_backlog (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_at    TIMESTAMPTZ  DEFAULT NOW(),
  description     TEXT         NOT NULL,
  what_is_needed  TEXT         NOT NULL,
  status          VARCHAR(20)  DEFAULT 'pending', -- pending | done
  priority        VARCHAR(10)  DEFAULT 'medium'
);

-- Log de interações
CREATE TABLE IF NOT EXISTS kronos_interactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      VARCHAR(100),
  input_text      TEXT         NOT NULL,
  intent          VARCHAR(100),
  contexts_loaded TEXT[],
  output_text     TEXT,
  output_channel  VARCHAR(20),          -- whatsapp | drive | sheets
  tokens_used     INT,
  duration_ms     INT,
  had_feedback    BOOLEAN      DEFAULT FALSE,
  created_at      TIMESTAMPTZ  DEFAULT NOW()
);

-- Padrões validados (copies, estruturas aprovadas)
CREATE TABLE IF NOT EXISTS kronos_patterns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  context      VARCHAR(50)  NOT NULL,
  pattern_type VARCHAR(50)  NOT NULL,  -- copy | estrutura | fluxo
  content      TEXT         NOT NULL,
  usage_count  INT          DEFAULT 0,
  approved_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learnings_context    ON kronos_learnings(context, category);
CREATE INDEX IF NOT EXISTS idx_interactions_created ON kronos_interactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backlog_status       ON kronos_dev_backlog(status);
