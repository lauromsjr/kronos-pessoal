import fs from 'fs';
import path from 'path';
import { CronJob } from 'cron';
import { getSqlitePath } from '../../database/sqlite';

const MAX_BACKUPS = 7;
const BACKUP_PATTERN = /^kronos_backup_\d{4}-\d{2}-\d{2}\.sqlite$/;

function getBackupFolder() {
  return path.dirname(getSqlitePath());
}

function isValidBackupFilename(filename: string) {
  return BACKUP_PATTERN.test(filename) && path.basename(filename) === filename;
}

async function pruneOldBackups(folder: string) {
  const backups = (await fs.promises.readdir(folder))
    .filter(isValidBackupFilename)
    .sort()
    .reverse();

  await Promise.all(
    backups.slice(MAX_BACKUPS).map((file) => fs.promises.unlink(path.join(folder, file)))
  );
}

export async function runSqliteBackup(): Promise<{ filename: string; path: string }> {
  const sqlitePath = getSqlitePath();
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite file not found: ${sqlitePath}`);
  }

  const folder = getBackupFolder();
  const today = new Date().toISOString().slice(0, 10);
  const filename = `kronos_backup_${today}.sqlite`;
  const target = path.join(folder, filename);

  await fs.promises.copyFile(sqlitePath, target);
  await pruneOldBackups(folder);

  console.log(`[backup] done → ${filename}`);
  return { filename, path: target };
}

export async function listSqliteBackups(): Promise<Array<{ filename: string; created_at?: string; size_bytes: number }>> {
  const folder = getBackupFolder();
  if (!fs.existsSync(folder)) return [];

  const backups = await Promise.all(
    (await fs.promises.readdir(folder))
      .filter(isValidBackupFilename)
      .sort()
      .reverse()
      .map(async (filename) => {
        const stats = await fs.promises.stat(path.join(folder, filename));
        return {
          filename,
          created_at: stats.birthtime ? stats.birthtime.toISOString() : stats.mtime.toISOString(),
          size_bytes: stats.size,
        };
      })
  );

  return backups;
}

export function getSqliteBackupPath(filename: string): string | null {
  if (!isValidBackupFilename(filename)) return null;

  const folder = getBackupFolder();
  const resolved = path.resolve(folder, filename);
  const resolvedFolder = path.resolve(folder);
  if (path.dirname(resolved) !== resolvedFolder) return null;

  return fs.existsSync(resolved) ? resolved : null;
}

export function startDailySqliteBackup() {
  const job = new CronJob(
    '0 3 * * *',
    () => {
      runSqliteBackup().catch((err) => console.error('[backup] failed', err));
    },
    null,
    true,
    'America/Sao_Paulo'
  );

  return job;
}
