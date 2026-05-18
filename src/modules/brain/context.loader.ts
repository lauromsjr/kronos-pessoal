import fs from 'fs';
import path from 'path';
import { db } from '../../database/client';
import { Business, Intent, KronosLearning, LoadedContext } from '../../shared/types';

const CONTEXTS_DIR = path.join(__dirname, '../../contexts');

// Arquivos base — sempre carregados em qualquer contexto
const BASE_FILES: string[] = ['master.md', 'personal_info.md', 'business_context.md'];

// Arquivos extras por negócio — carregados adicionalmente ao base
const BUSINESS_FILES: Record<Business, string[]> = {
  ibogaliv: ['ibogaliv.md'],
  olympus:  ['olympus_imoveis.md'],
  plugai:   ['plugai.md'],
  pessoal:  [],
};

export async function loadContext(intent: Intent): Promise<LoadedContext> {
  const filesToLoad = [
    ...BASE_FILES,
    ...(BUSINESS_FILES[intent.business] ?? []),
  ];

  const staticFiles = filesToLoad
    .map((filename) => readFile(filename))
    .filter(Boolean);

  const learnings = await fetchLearnings(intent.business);

  return { staticFiles, learnings };
}

function readFile(filename: string): string {
  const filePath = path.join(CONTEXTS_DIR, filename);
  if (!fs.existsSync(filePath)) {
    console.warn(`⚠️  Contexto não encontrado: ${filename}`);
    return '';
  }
  return fs.readFileSync(filePath, 'utf-8');
}

async function fetchLearnings(context: Business): Promise<KronosLearning[]> {
  if (!db) return [];

  try {
    const result = await db.query<KronosLearning>(
      `SELECT * FROM kronos_learnings WHERE context = $1 ORDER BY created_at DESC LIMIT 20`,
      [context]
    );
    return result.rows;
  } catch {
    // Banco pode não estar acessível durante desenvolvimento local
    return [];
  }
}
