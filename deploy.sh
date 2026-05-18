#!/bin/bash

# Kronos — Deploy Script
# Uso: ./deploy.sh
# Requer: docker, git, arquivo .env na raiz

set -e  # Parar ao primeiro erro

echo "🚀 Iniciando deploy do Kronos..."
echo ""

# ============================================
# PASSO 1: Git Pull
# ============================================
echo "📥 PASSO 1: Fazendo git pull..."
git pull origin main
echo "✅ Git pull concluído"
echo ""

# ============================================
# PASSO 2: Build da imagem Docker
# ============================================
echo "🔨 PASSO 2: Buildar imagem Docker..."
docker build -t kronos:latest .
echo "✅ Build concluído: kronos:latest"
echo ""

# ============================================
# PASSO 3: Parar container antigo
# ============================================
echo "🛑 PASSO 3: Parando container antigo (se existir)..."
if docker ps -a --format '{{.Names}}' | grep -q "^kronos$"; then
  echo "   → Container 'kronos' encontrado. Parando..."
  docker stop kronos 2>/dev/null || true
  docker rm kronos 2>/dev/null || true
  echo "✅ Container antigo removido"
else
  echo "   → Nenhum container antigo encontrado"
fi
echo ""

# ============================================
# PASSO 4: Subir novo container com env vars
# ============================================
echo "▶️  PASSO 4: Iniciando novo container..."

# Verificar se .env existe
if [ ! -f .env ]; then
  echo "❌ Erro: arquivo .env não encontrado na raiz do projeto!"
  echo "   Copie .env.example para .env e preencha as variáveis:"
  echo "   cp .env.example .env"
  exit 1
fi

# Passar env vars do .env para o container
echo "   → Lendo variáveis do arquivo .env..."
docker run -d \
  --name kronos \
  --env-file .env \
  -p 3002:3002 \
  --restart unless-stopped \
  kronos:latest

echo "✅ Container 'kronos' iniciado com sucesso"
echo ""

# ============================================
# PASSO 5: Mostrar logs iniciais
# ============================================
echo "📋 PASSO 5: Mostrando logs iniciais..."
echo "   (aguardando 3 segundos para container estabilizar...)"
sleep 3
docker logs kronos --tail 20

echo ""
echo "🎉 Deploy concluído!"
echo ""
echo "📞 Verificar saúde do Kronos:"
echo "   curl http://localhost:3002/health"
echo ""
echo "📊 Ver logs em tempo real:"
echo "   docker logs -f kronos"
echo ""
echo "🛑 Parar container:"
echo "   docker stop kronos"
