# Kronos — Deploy no EasyPanel

Guia completo para colocar o Kronos em produção no EasyPanel.

---

## 📋 Requisitos

- Acesso ao EasyPanel
- JSON da service account do Google Cloud já gerado
- JWT do PlugAI com permissão de viewer
- Chave da API Anthropic
- Número de WhatsApp separado para o Kronos (Evolution API nova)

---

## 🏗️ Arquitetura de Deploy

```
┌─────────────────────────────────────────────────┐
│         EasyPanel (seu painel de controle)      │
├─────────────────────────────────────────────────┤
│                                                 │
│  1. PostgreSQL (Kronos)        porta 5432      │
│     └─ banco: kronos                           │
│     └─ user: kronos_user                       │
│                                                 │
│  2. Evolution API              porta 8080      │
│     └─ instância: kronos                       │
│     └─ número separado do PlugAI               │
│                                                 │
│  3. Kronos Container           porta 3002      │
│     └─ Node.js 20 Alpine                       │
│     └─ TypeScript compiled                     │
│     └─ env: DATABASE_URL, ANTHROPIC_API_KEY... │
│                                                 │
└─────────────────────────────────────────────────┘
                      │
                      ▼
         [seu WhatsApp pessoal]
```

---

## 🔧 Passo a Passo de Deploy

### PASSO 1: Criar Container PostgreSQL

**No EasyPanel → Databases (ou Docker → PostgreSQL)**

```
Nome da instância:     kronos-db
Versão PostgreSQL:     15 ou superior
Porta (interna):       5432
Porta (exposta):       5432

Credenciais iniciais:
┌────────────────────────────────────────┐
│ POSTGRES_USER=kronos_user              │
│ POSTGRES_PASSWORD=<gera_senha_forte>   │
│ POSTGRES_DB=kronos                     │
└────────────────────────────────────────┘
```

**Após criar, anote a connection string:**
```
DATABASE_URL=postgresql://kronos_user:SENHA@kronos-db:5432/kronos
```

**Verificar conexão (via terminal do EasyPanel):**
```bash
psql postgresql://kronos_user:SENHA@kronos-db:5432/kronos -c "SELECT version();"
```

---

### PASSO 2: Criar Container Evolution API (instância kronos)

**No EasyPanel → Docker → Adicionar Container (ou usar imagem Evolution API)**

```
Nome:                  evolution-api
Imagem:                mntecholution/evolution-api:latest
Porta (interna):       8080
Porta (exposta):       não precisa expor (comunicação interna)

Variáveis de ambiente:
┌────────────────────────────────────────┐
│ API_URL=http://evolution-api:8080      │
│ LOG_LEVEL=info                         │
│ DATABASE_CONNECTION_URI=                │
│   postgresql://kronos_user:SENHA@      │
│   kronos-db:5432/evolution             │
└────────────────────────────────────────┘
```

**Após criar, anote a API_KEY gerada:**
- Evolution API gera uma chave automaticamente no primeiro boot
- Acesse o dashboard da Evolution API para copiar a `API_KEY`
- Anote como: `EVOLUTION_API_KEY=xxx...`

**Criar a instância "kronos" pelo dashboard Evolution:**
1. Acessar: `http://seu-ip:8080` (ou como configurado)
2. Criar nova instância
3. Nome: `kronos`
4. Conectar número de WhatsApp **separado** do usado no PlugAI
5. Copiar a chave de autenticação

---

### PASSO 3: Compilar e Enviar Dockerfile

**No local (antes de fazer push):**

```bash
# Clonar repo (ou ter código local)
cd kronos/

# Testar build localmente
docker build -t kronos:latest .

# Testar container
docker run --rm \
  -e PORT=3002 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -p 3002:3002 \
  kronos:latest
```

**Enviar para registry (se usar):**

```bash
# Fazer push para seu registry (DockerHub, GitHub Container Registry, etc)
docker tag kronos:latest seu-usuario/kronos:latest
docker push seu-usuario/kronos:latest
```

---

### PASSO 4: Criar Container Kronos no EasyPanel

**No EasyPanel → Docker → Adicionar Container**

```
Nome:                  kronos-app
Imagem:                cronos:latest (ou seu-usuario/kronos:latest)
Porta (interna):       3002
Porta (exposta):       3002

Variáveis de ambiente (colar do .env.example preenchido):
┌────────────────────────────────────────────────────────┐
│ PORT=3002                                              │
│ NODE_ENV=production                                    │
│ ANTHROPIC_API_KEY=sk-ant-...                          │
│ DATABASE_URL=postgresql://kronos_user:SENHA@          │
│   kronos-db:5432/kronos                               │
│ EVOLUTION_API_URL=http://evolution-api:8080          │
│ EVOLUTION_API_KEY=...                                 │
│ EVOLUTION_INSTANCE=kronos                             │
│ PLUGAI_API_URL=https://api.plugaimarketing.com       │
│ PLUGAI_JWT=eyJ...                                     │
│ GOOGLE_SERVICE_ACCOUNT_JSON=...                       │
│ GOOGLE_DRIVE_FOLDER_ID=...                            │
│ LAURO_PHONE=5562998441163                             │
└────────────────────────────────────────────────────────┘

Volumes (opcional, se quiser logs persistentes):
/app/logs → /var/lib/kronos/logs

Restart policy:    always
Health check:      GET http://localhost:3002/health
```

**Salvar e iniciar container.**

---

### PASSO 5: Verificar Saúde do Kronos

**Health check endpoint:**
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

**Logs do container:**
```
EasyPanel → Containers → kronos-app → Logs
```

---

### PASSO 6: Testar Webhook

**Enviar mensagem de teste para o Kronos:**

```bash
curl -s -X POST http://localhost:3002/webhook/message \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "5562998441163",
    "message": "Oi Kronos, cria um post para Instagram da IbogaLiv"
  }' | jq .
```

**Resposta esperada:**
```json
{
  "ok": true,
  "data": {
    "reply": "# Post Instagram — IbogaLiv\n...",
    "intent": "ibogaliv/conteudo",
    "tokensUsed": 4516,
    "durationMs": 17233
  }
}
```

---

## 🔗 Integração com n8n

**No n8n, criar workflow: "Kronos Receptor"**

```
[Evolution Webhook Trigger]
   ↓ (recebe mensagem do WhatsApp)
[Extract phone + message]
   ↓
[POST http://kronos-app:3002/webhook/message]
   ↓ (recebe resposta)
[Evolution Send Message]
   ↓
[Enviar resposta no WhatsApp]
```

**Configurar webhook da Evolution API:**
- URL: `http://seu-n8n:5678/webhook/evolution-kronos`
- Tipo: `messages.upsert`
- Authenticar se necessário

---

## 📊 Variáveis por Ambiente

### Desenvolvimento (local)
```env
PORT=3002
NODE_ENV=development
DATABASE_URL=postgresql://user:pass@localhost:5432/kronos
ANTHROPIC_API_KEY=sk-ant-...
# Resto opcional para desenvolver
```

### Produção (EasyPanel)
```env
PORT=3002
NODE_ENV=production
DATABASE_URL=postgresql://kronos_user:SENHA@kronos-db:5432/kronos
ANTHROPIC_API_KEY=sk-ant-...
EVOLUTION_API_URL=http://evolution-api:8080
EVOLUTION_API_KEY=...
PLUGAI_API_URL=https://api.plugaimarketing.com
PLUGAI_JWT=...
GOOGLE_SERVICE_ACCOUNT_JSON=...
GOOGLE_DRIVE_FOLDER_ID=...
LAURO_PHONE=5562998441163
```

---

## 🚨 Checklist de Deploy

- [ ] PostgreSQL criado e funcional
- [ ] Evolution API criada com instância "kronos"
- [ ] Dockerfile testado localmente
- [ ] Container Kronos criado no EasyPanel
- [ ] Todas as variáveis de ambiente preenchidas
- [ ] Health check retornando `ok: true`
- [ ] Webhook testado com curl
- [ ] n8n conectado ao Kronos
- [ ] Mensagem WhatsApp testada end-to-end
- [ ] Logs do Kronos mostram "[INFO] Aplicando migrações..."
- [ ] Banco de dados inicializado com schema completo

---

## 🔒 Segurança

1. **LAURO_PHONE**: Somente o número dele consegue usar o Kronos
2. **ANTHROPIC_API_KEY**: Nunca commitar no git (usar .env no EasyPanel)
3. **DATABASE_URL**: Credenciais fortes, sem padrão
4. **EVOLUTION_API_KEY**: Gerar nova, revoke a antiga periodicamente
5. **Firewall**: Kronos não precisa estar exposto publicamente (n8n acessa internamente)

---

## 📝 Logs Esperados ao Iniciar

```
> kronos@1.0.0 start
> node dist/app.js

🔄 Aplicando migrações...
✅ Migrações aplicadas com sucesso

🟢 Kronos rodando em http://localhost:3002
   POST /webhook/message
   GET  /health

🕐 Cron weekly.review agendado (sexta 18h)
```

---

## 🆘 Troubleshooting

### "DATABASE_URL não configurada"
- Verificar se variável foi salva no EasyPanel
- Reiniciar container

### "CONNECTION REFUSED" ao Evolution API
- Verificar se Evolution API está rodando
- Confirmar URL: `http://evolution-api:8080`

### "ANTHROPIC_API_KEY inválida"
- Copiar chave completa (incluindo prefixo `sk-ant-`)
- Sem espaços em branco

### "Migrações falhando"
- Verificar conexão PostgreSQL
- Confirmar que banco `kronos` existe
- Checar logs: `EasyPanel → cronos-app → Logs`

---

## 📞 Próximos Passos

1. Deploy completo testado
2. Integração n8n ativa
3. Evolution API com instância funcional
4. Teste end-to-end: WhatsApp → Kronos → resposta

Após isso, o Kronos está **100% operacional no WhatsApp**.
