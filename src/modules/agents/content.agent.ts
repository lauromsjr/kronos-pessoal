import { Intent, KronosResponse } from '../../shared/types';

export type ContentFormat = 'post_linkedin' | 'carrossel_instagram' | 'legenda' | 'roteiro';

export interface ContentRequest {
  intent: Intent;
  format: ContentFormat;
  brief: string;
}

// TODO (Sexta 18/04): implementar geração de conteúdo via Claude API
// - LinkedIn: post longo, tom profissional adaptado ao negócio
// - Instagram: carrossel com slides numerados, copy por slide
// - Legenda: texto curto com hashtags
// - Roteiro: estrutura de vídeo/reels

export async function generateContent(_req: ContentRequest): Promise<KronosResponse> {
  throw new Error('content.agent: não implementado');
}
