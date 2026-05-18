import axios from 'axios';
import { env } from '../../config/env';

// O Kronos NUNCA chama endpoints de mutação do PlugAI (POST, PATCH, DELETE)
const plugaiHttp = axios.create({
  baseURL: env.PLUGAI_API_URL,
  headers: { Authorization: `Bearer ${env.PLUGAI_JWT}` },
});

// TODO (Sexta 18/04): implementar consultas ao PlugAI API

export async function getKpis(year: number, month: number) {
  const { data } = await plugaiHttp.get('/api/dashboard/kpis', { params: { year, month } });
  return data;
}

export async function getLeadsPipeline() {
  const { data } = await plugaiHttp.get('/api/leads/kanban');
  return data;
}

export async function getLeadsByVertical(vertical: 'ibogaliv' | 'olympus') {
  const { data } = await plugaiHttp.get('/api/leads', { params: { vertical } });
  return data;
}

export async function getSalesSummary(year: number, month: number) {
  const { data } = await plugaiHttp.get('/api/sales/summary', { params: { year, month } });
  return data;
}

export async function getPlanejamentoOverview(year: number, month: number) {
  const { data } = await plugaiHttp.get('/api/planejamento/overview', { params: { year, month } });
  return data;
}

export async function getAdsOverview(year: number, month: number) {
  const { data } = await plugaiHttp.get('/api/ads/overview', { params: { year, month } });
  return data;
}
