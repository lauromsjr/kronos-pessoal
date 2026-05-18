import { Business, Intent, IntentCategory, IncomingMessage } from '../../shared/types';

// Palavras-chave por negócio
const BUSINESS_KEYWORDS: Record<Business, string[]> = {
  ibogaliv:  ['iboga', 'ibogaliv', 'dependência', 'tratamento', 'paciente'],
  olympus:   ['olympus', 'imóvel', 'imóveis', 'corretor', 'apartamento', 'casa', 'terreno'],
  plugai:    ['plugai', 'plug', 'automação', 'cliente', 'saas', 'agência'],
  pessoal:   [],  // fallback
};

// Palavras-chave por categoria
const CATEGORY_KEYWORDS: Record<IntentCategory, string[]> = {
  conteudo:  ['post', 'conteúdo', 'copy', 'instagram', 'linkedin', 'carrossel', 'legenda'],
  crm:       ['lead', 'leads', 'pipeline', 'venda', 'vendas', 'kpi', 'funil'],
  agenda:    ['reunião', 'agenda', 'calendário', 'horário', 'compromisso'],
  financeiro:['financeiro', 'receita', 'faturamento', 'custo', 'lucro'],
  estrategia:['estratégia', 'okr', 'meta', 'plano', 'planejamento'],
  geral:     [],  // fallback
};

export function detectIntent(msg: IncomingMessage): Intent {
  const text = msg.message.toLowerCase();

  const business = detectBusiness(text);
  const category = detectCategory(text);

  return {
    business,
    category,
    rawMessage: msg.message,
    sessionId: msg.sessionId ?? `session_${Date.now()}`,
  };
}

function detectBusiness(text: string): Business {
  for (const [biz, keywords] of Object.entries(BUSINESS_KEYWORDS) as [Business, string[]][]) {
    if (biz === 'pessoal') continue;
    if (keywords.some((kw) => text.includes(kw))) return biz;
  }
  return 'pessoal';
}

function detectCategory(text: string): IntentCategory {
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS) as [IntentCategory, string[]][]) {
    if (cat === 'geral') continue;
    if (keywords.some((kw) => text.includes(kw))) return cat;
  }
  return 'geral';
}
