# Kronos — Dockerfile otimizado para produção no EasyPanel
# Multi-stage build: build + runtime

# ============================================
# STAGE 1: BUILD
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache python3 make g++

# Copiar arquivos de dependências
COPY package*.json ./
COPY tsconfig.json ./

# Instalar todas as dependências (incluindo devDependencies para build)
RUN npm ci

# Copiar código-fonte
COPY src ./src

# Compilar TypeScript para JavaScript
RUN npm run build
RUN npm prune --omit=dev

# ============================================
# STAGE 2: RUNTIME (imagem final)
# ============================================
FROM node:20-alpine

WORKDIR /app

# Copiar package.json e package-lock.json para instalar versões exatas
COPY package.json package-lock.json ./

# Instalar apenas dependências de produção
COPY --from=builder /app/node_modules ./node_modules

# Copiar código compilado do stage anterior
COPY --from=builder /app/dist ./dist
COPY src/public ./dist/public

# Copiar arquivos de contexto (memória estática)
COPY src/contexts ./dist/contexts
COPY src/database/migrations ./dist/database/migrations

RUN mkdir -p /app/data
VOLUME ["/app/data"]

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3002/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Expor porta
EXPOSE 3002

# Executar aplicação
CMD ["node", "dist/app.js"]
