import fs from 'fs';
import path from 'path';
import { db } from './client';

async function ensureMigrationsTable(): Promise<void> {
  await db!.query(`
    CREATE TABLE IF NOT EXISTS kronos_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ  DEFAULT NOW()
    )
  `);
}

async function isApplied(filename: string): Promise<boolean> {
  const result = await db!.query(
    'SELECT 1 FROM kronos_migrations WHERE filename = $1',
    [filename]
  );
  return result.rows.length > 0;
}

async function recordMigration(filename: string): Promise<void> {
  await db!.query(
    'INSERT INTO kronos_migrations (filename) VALUES ($1)',
    [filename]
  );
}

export async function runMigrations(): Promise<void> {
  if (!db) {
    console.log('⚠️  DATABASE_URL não configurada — migrações puladas.');
    return;
  }

  await ensureMigrationsTable();

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).sort();

  for (const file of files) {
    if (!file.endsWith('.sql')) continue;

    if (await isApplied(file)) {
      console.log(`  ↳ ${file} — já aplicada, pulando.`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    console.log(`  ↳ Aplicando ${file}...`);
    await db.query(sql);
    await recordMigration(file);
  }
}

// Execução direta: ts-node src/database/migrate.ts
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('✓ Migrações concluídas.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('✗ Migração falhou:', err);
      process.exit(1);
    });
}
