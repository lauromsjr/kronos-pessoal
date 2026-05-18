import { Pool } from 'pg';
import { env } from '../config/env';

// Pool só é criado se DATABASE_URL estiver configurada
export const db: Pool | null = env.DATABASE_URL
  ? new Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : null;

if (db) {
  db.on('error', (err) => {
    console.error('PostgreSQL pool error:', err);
  });
}
