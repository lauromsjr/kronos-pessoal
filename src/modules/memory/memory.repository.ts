import { db } from '../../database/client';
import {
  Business,
  IntentCategory,
  KronosDevBacklog,
  KronosInteraction,
  KronosLearning,
} from '../../shared/types';

// ─── Learnings ───────────────────────────────────────────────────────────────

export async function getLearnings(
  context: Business,
  category: IntentCategory
): Promise<KronosLearning[]> {
  const result = await db.query<KronosLearning>(
    `SELECT * FROM kronos_learnings WHERE context = $1 AND category = $2 ORDER BY created_at DESC LIMIT 20`,
    [context, category]
  );
  return result.rows;
}

export async function insertLearning(
  context: Business,
  category: IntentCategory,
  whatHappened: string,
  newRule: string
): Promise<KronosLearning> {
  const result = await db.query<KronosLearning>(
    `INSERT INTO kronos_learnings (context, category, what_happened, new_rule)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [context, category, whatHappened, newRule]
  );
  return result.rows[0];
}

// ─── Interactions ─────────────────────────────────────────────────────────────

export async function insertInteraction(
  data: Omit<KronosInteraction, 'id' | 'created_at'>
): Promise<KronosInteraction> {
  const result = await db.query<KronosInteraction>(
    `INSERT INTO kronos_interactions
       (session_id, input_text, intent, contexts_loaded, output_text, output_channel, tokens_used, duration_ms, had_feedback)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      data.session_id,
      data.input_text,
      data.intent,
      data.contexts_loaded,
      data.output_text,
      data.output_channel,
      data.tokens_used,
      data.duration_ms,
      data.had_feedback,
    ]
  );
  return result.rows[0];
}

// ─── Backlog ──────────────────────────────────────────────────────────────────

export async function insertBacklogItem(
  description: string,
  whatIsNeeded: string
): Promise<KronosDevBacklog> {
  const result = await db.query<KronosDevBacklog>(
    `INSERT INTO kronos_dev_backlog (description, what_is_needed)
     VALUES ($1, $2)
     RETURNING *`,
    [description, whatIsNeeded]
  );
  return result.rows[0];
}
