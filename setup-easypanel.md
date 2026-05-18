# Setup Kronos no EasyPanel — Passo a Passo Manual

Guia visual para criar o Kronos no EasyPanel usando a opção **"Custom Dockerfile"**.

---

## 📋 Checklist de Preparação

Antes de começar, tenha em mãos:

- [ ] **ANTHROPIC_API_KEY** — Chave da API Anthropic
- [ ] **EVOLUTION_API_KEY** — Gerada após criar instância Evolution
- [ ] **EVOLUTION_API_URL** — URL da instância Evolution (ex: `http://evolution-api:8080`)
- [ ] **DATABASE_URL** — Connection string do PostgreSQL (ex: `postgresql://kronos_user:senha@kronos-db:5432/kronos`)
- [ ] **PLUGAI_JWT** — Token JWT do PlugAI (com permissão viewer)
- [ ] **GOOGLE_SERVICE_ACCOUNT_JSON** — JSON da service account do Google
- [ ] **GOOGLE_DRIVE_FOLDER_ID** — ID da pasta "Kronos" no Drive
- [ ] **LAURO_PHONE** — Seu telefone (whitelist)

---

## 🔧 ORDEM DE CRIAÇÃO DOS SERVIÇOS

```
1️⃣  PostgreSQL (kronos-db)      ← Cria PRIMEIRO
2️⃣  Evolution API (evolution-api) ← Cria SEGUNDO
3️⃣  Kronos (kronos-app)          ← Cria TERCEIRO (depende dos 2 anteriores)
```

---

## 🔹 SERVIÇO 1: PostgreSQL (kronos-db)

### No EasyPanel → Databases (ou Docker)

**Clique em:** `Adicionar Banco de Dados` ou `Adicionar Container`

```
┌─────────────────────────────────────────────┐
│ Nome da Instância                           │
│ kronos-db                                   │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Imagem (se for Docker Container)            │
│ postgres:15-alpine                          │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Porta Interna                               │
│ 5432                                        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Porta Exposta                               │
│ 5432 (ou deixar sem exposição externa)      │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Variáveis de Ambiente                       │
│                                             │
│ POSTGRES_USER=kronos_user                   │
│ POSTGRES_PASSWORD=<gera_senha_forte>        │
│ POSTGRES_DB=kronos                          │
│                                             │
│ (Salve a senha! Você usará em DATABASE_URL) │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Restart Policy                              │
│ Always (sempre reiniciar)                   │
└─────────────────────────────────────────────┘
```

**✅ Salvar e aguardar container inicializar (2-3 minutos)**

**Após criar, anote a connection string:**
```
DATABASE_URL=postgresql://kronos_user:SENHA@kronos-db:5432/kronos
```

**Validar conexão (via terminal do EasyPanel, se disponível):**
```bash
psql postgresql://kronos_user:SENHA@kronos-db:5432/kronos -c "SELECT 1;"
```

---

## 🔹 SERVIÇO 2: Evolution API (evolution-api)

### No EasyPanel → Docker → Adicionar Container

```
┌─────────────────────────────────────────────┐
│ Nome                                        │
│ evolution-api                               │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Imagem                                      │
│ mntecholution/evolution-api:latest          │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Porta Interna                               │
│ 8080                                        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Porta Exposta                               │
│ (deixar sem exposição — comunicação interna)│
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Variáveis de Ambiente                       │
│                                             │
│ API_URL=http://evolution-api:8080           │
│ LOG_LEVEL=info                              │
│ DATABASE_CONNECTION_URI=                    │
│   postgresql://kronos_user:SENHA@           │
│   kronos-db:5432/evolution                  │
│                                             │
│ (Use a mesma SENHA do PostgreSQL)           │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Volumes                                     │
│ /app → /var/lib/evolution (persistência)    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Restart Policy                              │
│ Always                                      │
└─────────────────────────────────────────────┘
```

**✅ Salvar e aguardar inicializar (3-5 minutos)**

**Após criar, obter a API_KEY:**
1. Acessar dashboard da Evolution API: `http://seu-ip:8080` (ou conforme sua rede)
2. Na tela inicial, copiar a **API_KEY** gerada automaticamente
3. Anotar como: `EVOLUTION_API_KEY=xxx...`

**Criar instância "kronos":**
1. No dashboard Evolution, clique em "Nova Instância"
2. Nome: `kronos`
3. Conectar o número de WhatsApp **separado** do PlugAI
4. Após sincronizar, copiar a chave de autenticação

**Anotar:**
```
EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_API_KEY=xxx...
EVOLUTION_INSTANCE=kronos
```

---

## 🔹 SERVIÇO 3: Kronos App (kronos-app)

### No EasyPanel → Docker → Adicionar Container → **Custom Dockerfile**

**Opção 1: Upload do repositório**
1. Se EasyPanel suporta Git, clonar: `https://seu-repo/kronos`
2. EasyPanel detecta o Dockerfile automaticamente

**Opção 2: Cole o Dockerfile manualmente**
1. Clique em "Custom Dockerfile"
2. Cole o conteúdo do `Dockerfile` do projeto

```
┌─────────────────────────────────────────────┐
│ Nome                                        │
│ kronos-app                                  │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Imagem (se usar build local)                │
│ kronos:latest                               │
│ (ou seu-usuario/kronos:latest se no registry)
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Porta Interna                               │
│ 3002                                        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Porta Exposta                               │
│ 3002 (ou deixar sem exposição se usar revers │
│      proxy/ngix interno)                    │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Variáveis de Ambiente (PREENCHA NESTA ORDEM)│
│                                             │
│ 1️⃣  SERVER CONFIG                          │
│ PORT=3002                                   │
│ NODE_ENV=production                         │
│                                             │
│ 2️⃣  ANTHROPIC                              │
│ ANTHROPIC_API_KEY=sk-ant-xxxxx...          │
│ (Obter em: Anthropic Console)               │
│                                             │
│ 3️⃣  DATABASE                               │
│ DATABASE_URL=postgresql://kronos_user:SENHA│
│   @kronos-db:5432/kronos                   │
│ (Do SERVIÇO 1 — PostgreSQL)                │
│                                             │
│ 4️⃣  EVOLUTION API                          │
│ EVOLUTION_API_URL=http://evolution-api:8080│
│ EVOLUTION_API_KEY=xxxxx...                 │
│ EVOLUTION_INSTANCE=kronos                  │
│ (Do SERVIÇO 2)                              │
│                                             │
│ 5️⃣  PlugAI (opcional, mas recomendado)    │
│ PLUGAI_API_URL=https://api.plugaimarketing │
│   .com                                      │
│ PLUGAI_JWT=eyJ0eXAiOiJKV1QiLCJhbGc...     │
│ (Gerar em: PlugAI → Integrações)            │
│                                             │
│ 6️⃣  GOOGLE (opcional, mas recomendado)    │
│ GOOGLE_SERVICE_ACCOUNT_JSON={               │
│   "type": "service_account",                │
│   "project_id": "...",                      │
│   "private_key_id": "...",                  │
│   ...                                       │
│ }                                           │
│ GOOGLE_DRIVE_FOLDER_ID=1AbCd...            │
│ (Do Google Cloud Console)                   │
│                                             │
│ 7️⃣  SEGURANÇA (CRÍTICO)                   │
│ LAURO_PHONE=5562998441163                  │
│ (Seu telefone — whitelist)                  │
│                                             │
└─────────────────────────────────────────────┘
```

**📌 IMPORTANTE:** Preencha as variáveis **nesta ordem exata** para facilitar debug.

```
┌─────────────────────────────────────────────┐
│ Volumes (opcional)                          │
│ /app/logs → /var/lib/kronos/logs            │
│ (para persistência de logs)                 │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Restart Policy                              │
│ Always (sempre reiniciar se cair)           │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│ Health Check (opcional mas recomendado)     │
│ Tipo: HTTP GET                              │
│ Path: /health                               │
│ Port: 3002                                  │
│ Interval: 30s                               │
│ Timeout: 10s                                │
│ Start period: 5s                            │
│ Retries: 3                                  │
└─────────────────────────────────────────────┘
```

**✅ Salvar e aguardar inicializar (3-5 minutos)**

---

## ✅ Validar Após Deploy

### 1. Health Check
```bash
curl -s http://localhost:3002/health | jq .
```

**Resposta esperada:**
```json
{
  "ok": true,
  "service": "kronos",
  "ts": "2026-04-16T23:30:00Z"
}
```

### 2. Logs do Container
```
EasyPanel → Containers → kronos-app → Logs
```

**Procurar por:**
```
🔄 Aplicando migrações...
✅ Migrações aplicadas com sucesso

🟢 Kronos rodando em http://localhost:3002
   POST /webhook/message
   GET  /health

🕐 Cron weekly.review agendado (sexta 18h)
```

### 3. Testar Webhook
```bash
curl -s -X POST http://localhost:3002/webhook/message \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5562998441163",
    "message": "Oi Kronos, status?"
  }' | jq .
```

**Resposta esperada:**
```json
{
  "ok": true,
  "data": {
    "reply": "...",
    "intent": "...",
    "tokensUsed": 1234,
    "durationMs": 5000
  }
}
```

---

## 🆘 Troubleshooting

| Problema | Solução |
|---|---|
| **"CONNECTION REFUSED" no PostgreSQL** | Verificar se kronos-db está rodando. Confirmar DATABASE_URL é igual ao POSTGRES_USER e POSTGRES_PASSWORD definidos no serviço 1 |
| **"EVOLUTION_API_KEY inválida"** | Copiar chave completa do dashboard Evolution. Sem espaços em branco. |
| **"ANTHROPIC_API_KEY inválida"** | Confirmar se começa com `sk-ant-`. Sem espaços. |
| **Container restart loop** | Ver logs: `docker logs kronos-app --tail 50`. Verificar env vars obrigatórias. |
| **Health check failing** | Aguardar 5-10 segundos após iniciar. Se persistir, ver logs. |
| **Migrações falhando** | DATABASE_URL pode estar errado. Testar conexão diretamente: `psql <DATABASE_URL>` |

---

## 📊 Próximos Passos

1. ✅ PostgreSQL criado e validado
2. ✅ Evolution API criada com instância "kronos"
3. ✅ Kronos container rodando
4. ✅ Health check OK
5. Integrar com n8n → webhook Evolution → Kronos → resposta WhatsApp
6. Testar end-to-end: WhatsApp pessoal → Kronos → resposta

---

## 🎯 Resumo Visual

```
┌──────────────────────────────────────────────────┐
│ EasyPanel — Serviços do Kronos                   │
├──────────────────────────────────────────────────┤
│                                                  │
│ ✅ kronos-db (PostgreSQL)                        │
│    porta 5432 — banco "kronos"                   │
│                                                  │
│ ✅ evolution-api (WhatsApp)                      │
│    porta 8080 — instância "kronos"               │
│                                                  │
│ ✅ kronos-app (Node.js)                          │
│    porta 3002 — Kronos service                   │
│                                                  │
└──────────────────────────────────────────────────┘
         ↓
    [seu WhatsApp pessoal]
```

---

**🎉 Pronto! Kronos está em produção no EasyPanel.**
