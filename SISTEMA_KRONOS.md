# Kronos — Plano de Execução Técnica Final
**Versão:** 3.0 (definitiva)
**Data:** 15/04/2026
**Go-live:** 20/04/2026 (segunda-feira)

---

## 1. Decisões de Arquitetura

| Decisão | Escolha | Motivo |
|---|---|---|
| Relação com PlugAI | Serviço 100% independente | Isolamento de falhas, sem acoplamento |
| Dados do PlugAI | Consumido via API pública (`api.plugaimarketing.com`) | Kronos lê, nunca escreve direto no banco do PlugAI |
| Cérebro LLM | Claude API (`claude-sonnet-4-5`) | Melhor custo-benefício, API Key já existe |
| Orquestração | n8n (já rodando) | Aproveita infra existente |
| WhatsApp | Nova instância Evolution API (número separado) | Sem conflito com instância do PlugAI |
| Banco de dados | PostgreSQL novo (container separado) | Isolado do PlugAI, mesmo padrão de stack |
| Memória estática | Arquivos `.md` no container | Contextos dos negócios, regras, perfil do Lauro |
| Memória dinâmica | Tabelas no PostgreSQL do Kronos | Aprendizados, feedbacks, backlog de features |
| Backup | Google Drive (service account já existe) | Porto seguro, rotina semanal automática |
| Runtime | Node.js 20 + TypeScript 5 | Mesmo padrão do PlugAI |
| Deploy | EasyPanel — novo container | Mesmo padrão do PlugAI |
| Porta | 3002 | 3001 = PlugAI backend |

---

## 2. Visão Geral da Arquitetura

```
[Lauro — WhatsApp pessoal]
          │
          ▼
[Evolution API — instância "kronos"]   ← número separado do PlugAI
          │
          │ webhook
          ▼
[n8n — workflow "Kronos Receptor"]
   • extrai phone, mensagem, tipo
   • transcreve áudio (Whisper) se necessário
   • monta payload JSON
          │
          │ POST /webhook/message
          ▼
┌─────────────────────────────────────────┐
│         KRONOS SERVICE (porta 3002)     │
│         Node.js + TypeScript            │
│                                         │
│  [IntentRouter]                         │
│   → identifica negócio + intenção       │
│          │                              │
│  [ContextLoader]                        │
│   → carrega .md relevantes              │
│   → busca learnings ativos no PG        │
│          │                              │
│  [PromptBuilder]                        │
│   → monta system prompt + contexto      │
│          │                              │
│  [Claude API]  ← cérebro               │
│          │                              │
│  [MemoryManager]                        │
│   → detecta feedback                    │
│   → registra aprendizado no PG          │
│   → registra interação no PG            │
│          │                              │
│  [OutputHandler]                        │
│   → decide canal de saída               │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┼──────────────┐
    ▼          ▼              ▼
[WhatsApp] [Google Drive]  [PlugAI API]
 resposta   docs longos    lê dados CRM
 direta     via link       financeiro
```

---

## 3. Estrutura de Pastas

```
kronos/                               ← projeto separado do plugai/
├── src/
│   ├── app.ts                        ← Entry point Express (porta 3002)
│   ├── config/
│   │   └── env.ts                    ← Validação de env vars (Zod)
│   ├── contexts/                     ← Memória estática (.md)
│   │   ├── master.md                 ← Identidade + regras do Kronos
│   │   ├── personal_info.md          ← Perfil do Lauro
│   │   ├── business_context.md       ← Mapa do ecossistema
│   │   ├── ibogaliv.md
│   │   ├── olympus_imoveis.md
│   │   ├── plugai.md
│   │   ├── strategy.md
│   │   ├── current_data.md
│   │   └── padroes/
│   │       ├── copies_ibogaliv.md
│   │       ├── copies_olympus.md
│   │       └── fluxos_automacao.md
│   ├── modules/
│   │   ├── webhook/
│   │   │   └── webhook.routes.ts     ← POST /webhook/message (recebe do n8n)
│   │   ├── router/
│   │   │   └── intent.router.ts      ← detecta negócio + intenção
│   │   ├── brain/
│   │   │   ├── claude.client.ts      ← wrapper Claude API
│   │   │   ├── context.loader.ts     ← carrega .md por contexto + learnings do PG
│   │   │   └── prompt.builder.ts     ← monta prompt final
│   │   ├── memory/
│   │   │   ├── memory.repository.ts  ← queries PostgreSQL
│   │   │   └── memory.manager.ts     ← detecta feedback, registra aprendizado
│   │   ├── agents/
│   │   │   ├── content.agent.ts      ← geração de conteúdo
│   │   │   ├── crm.agent.ts          ← consulta PlugAI API (/api/leads, /api/sales)
│   │   │   └── agenda.agent.ts       ← Google Calendar
│   │   ├── output/
│   │   │   ├── output.handler.ts     ← decide canal de saída
│   │   │   ├── whatsapp.client.ts    ← envia via Evolution API (instância kronos)
│   │   │   └── drive.client.ts       ← salva no Google Drive
│   │   └── cron/
│   │       └── weekly.review.ts      ← revisão toda sexta, backup Drive
│   ├── database/
│   │   ├── client.ts                 ← Pool PostgreSQL
│   │   ├── migrate.ts
│   │   └── migrations/
│   │       └── 001_initial.sql
│   └── shared/
│       ├── types/index.ts
│       └── utils/
│           └── response.ts
├── .env
├── package.json
├── tsconfig.json
└── Dockerfile
```

---

## 4. Banco de Dados — Schema Kronos

```sql
-- kronos/src/database/migrations/001_initial.sql

-- Aprendizados dinâmicos (memória de médio/longo prazo)
CREATE TABLE kronos_learnings (
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
CREATE TABLE kronos_dev_backlog (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_at    TIMESTAMPTZ  DEFAULT NOW(),
  description     TEXT         NOT NULL,
  what_is_needed  TEXT         NOT NULL,
  status          VARCHAR(20)  DEFAULT 'pending', -- pending | done
  priority        VARCHAR(10)  DEFAULT 'medium'
);

-- Log de interações
CREATE TABLE kronos_interactions (
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
CREATE TABLE kronos_patterns (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  context      VARCHAR(50)  NOT NULL,
  pattern_type VARCHAR(50)  NOT NULL,  -- copy | estrutura | fluxo
  content      TEXT         NOT NULL,
  usage_count  INT          DEFAULT 0,
  approved_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX idx_learnings_context ON kronos_learnings(context, category);
CREATE INDEX idx_interactions_created ON kronos_interactions(created_at DESC);
CREATE INDEX idx_backlog_status ON kronos_dev_backlog(status);
```

---

## 5. Variáveis de Ambiente

```env
# Kronos — .env
PORT=3002
NODE_ENV=production

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# PostgreSQL (container novo, separado do PlugAI)
DATABASE_URL=postgresql://kronos_user:SENHA@kronos-db:5432/kronos

# Evolution API — instância kronos (número separado)
EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_API_KEY=...
EVOLUTION_INSTANCE=kronos

# PlugAI API (Kronos consome como cliente externo)
PLUGAI_API_URL=https://api.plugaimarketing.com
PLUGAI_JWT=...        ← JWT com role viewer na org do Lauro

# Google (service account já existe)
GOOGLE_SERVICE_ACCOUNT_JSON=...
GOOGLE_DRIVE_FOLDER_ID=...   ← pasta "Kronos" no Drive do Lauro

# Lauro
LAURO_PHONE=5562XXXXXXXXX    ← whitelist: só Lauro usa o Kronos
```

---

## 6. Regras de Saída (OutputHandler)

| Tipo | Canal |
|---|---|
| Resposta curta, status, confirmação | WhatsApp direto |
| Lista de tarefas, prioridades | WhatsApp direto |
| Post, copy, roteiro, análise | Google Drive → link no WhatsApp |
| Dados do CRM, relatório | Google Drive → link no WhatsApp |
| Código, workflow n8n | Google Drive → link no WhatsApp |
| Demanda não implementada | WhatsApp — mensagem padrão |

**Mensagem padrão — funcionalidade não implementada:**
```
⚠️ Kronos ainda não tem essa funcionalidade.
📋 Demanda: [descrição do que foi pedido]
🔧 Necessário: [descrição técnica do que precisa ser construído]
➡️ Registrei no backlog. Me leva ao Claude Code para a gente desenvolver.
```

---

## 7. Sistema de Auto-evolução

```
Lauro envia feedback ou correção
        │
        ▼
MemoryManager detecta padrão de feedback
(palavras: "não era isso", "ajusta", "errado", "muda", "prefiro")
        │
        ▼
Aplica ajuste na resposta imediatamente
        │
        ▼
INSERT em kronos_learnings:
{
  context: 'ibogaliv',
  category: 'conteudo',
  what_happened: 'Tom muito formal no post de Instagram',
  new_rule: 'Instagram IbogaLiv: tom informal, empático, sem termos clínicos'
}
        │
        ▼
Nas próximas interações do mesmo contexto:
ContextLoader busca learnings ativos → inclui no prompt como "REGRAS APRENDIDAS"
→ erro nunca se repete

────── Revisão semanal (cron toda sexta 18h) ──────

1. Agrupa learnings da semana
2. Identifica padrões repetidos nas interações
3. Envia resumo no WhatsApp:
   "Kronos — Revisão semanal:
    • 3 ajustes de tom no conteúdo IbogaLiv
    • 1 novo padrão de copy validado
    Posso atualizar os contextos?"
4. Lauro responde "sim" → Kronos edita os .md + backup no Drive
```

---

## 8. Integração com PlugAI API

O Kronos consome o PlugAI como cliente externo. Nunca escreve diretamente no banco do PlugAI.

**Endpoints que o Kronos vai usar:**

| Funcionalidade | Endpoint PlugAI |
|---|---|
| KPIs do mês | `GET /api/dashboard/kpis?year=&month=` |
| Pipeline de leads | `GET /api/leads/kanban` |
| Leads da IbogaLiv | `GET /api/leads?vertical=ibogaliv` |
| Leads da Olympus | `GET /api/leads?vertical=olympus` |
| Vendas do período | `GET /api/sales/summary?year=&month=` |
| Diagnóstico gerencial | `GET /api/planejamento/overview?year=&month=` |
| Performance de ads | `GET /api/ads/overview?year=&month=` |

**O Kronos NUNCA chama endpoints de mutação do PlugAI** (POST, PATCH, DELETE).  
Toda escrita nos dados de negócio passa pelo Lauro conscientemente.

---

## 9. Cronograma de Execução

### Hoje — Quarta 15/04
- [ ] Criar repositório `kronos/` no mesmo workspace local
- [ ] Scaffolding completo: package.json, tsconfig, estrutura de pastas
- [ ] Copiar arquivos `.md` de contexto para `src/contexts/`
- [ ] `001_initial.sql` criado
- [ ] `app.ts` + `env.ts` + `webhook.routes.ts` funcionando
- [ ] Testar: `curl POST /webhook/message` → Claude API → resposta no terminal
- [ ] **Validação:** Kronos responde localmente ✓

### Quinta 17/04
- [ ] Criar nova instância Evolution API no EasyPanel (instância "kronos")
- [ ] Criar container PostgreSQL do Kronos no EasyPanel
- [ ] Criar container do Kronos no EasyPanel (Dockerfile)
- [ ] Workflow n8n: webhook Evolution → POST kronos:3002/webhook/message
- [ ] **Validação:** Mensagem no WhatsApp → resposta do Kronos ✓

### Sexta 18/04
- [ ] `content.agent.ts` — geração de post LinkedIn e carrossel Instagram
- [ ] `crm.agent.ts` — consulta leads e KPIs do PlugAI
- [ ] `memory.manager.ts` — detecta feedback, salva learnings
- [ ] `output.handler.ts` — lógica de canal de saída
- [ ] `drive.client.ts` — salva documentos no Drive
- [ ] **Validação:** "cria post LinkedIn para IbogaLiv" → rascunho no Drive → link no WhatsApp ✓

### Sábado 19/04
- [ ] `weekly.review.ts` — cron de revisão semanal
- [ ] `agenda.agent.ts` — Google Calendar
- [ ] Testes com 30+ interações reais cobrindo todos os fluxos
- [ ] Ajustes de tom e formato com feedbacks reais
- [ ] Backup completo no Drive

### Segunda 20/04 — Go-live
- [ ] Kronos 100% funcional no WhatsApp
- [ ] Agente de conteúdo operacional
- [ ] CRM consultivo operacional
- [ ] Memória e auto-evolução ativos
- [ ] Revisão semanal configurada

---

## 10. Separação de Responsabilidades — Resumo

| Sistema | Responsabilidade | Banco | WhatsApp |
|---|---|---|---|
| PlugAI | Plataforma SaaS, dados de negócio, dashboard | PostgreSQL `plugai` | Instância `plugai` |
| Kronos | Assistente pessoal do Lauro | PostgreSQL `kronos` | Instância `kronos` |

**Kronos lê PlugAI. PlugAI não sabe que o Kronos existe.**

---

## 11. Próximos Passos Imediatos

**Você faz agora (5 min):**
1. Criar pasta `kronos/` no seu workspace local (`C:\Claude\workspace\`)
2. Me confirmar que está feito

**Nós fazemos juntos em seguida:**
3. Scaffolding completo do projeto via Claude Code
4. Primeira resposta funcionando localmente ainda hoje