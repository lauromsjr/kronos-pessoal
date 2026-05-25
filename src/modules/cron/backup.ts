import fs from 'fs';
import path from 'path';
import { CronJob } from 'cron';
import { closeDb, getSqlitePath } from '../../database/sqlite';

const MAX_BACKUPS = 7;
const BACKUP_PATTERN = /^kronos_backup_\d{4}-\d{2}-\d{2}\.sqlite$/;
const RESTORABLE_BACKUP_PATTERN = /^(kronos_backup_\d{4}-\d{2}-\d{2}|before-restore-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.(sqlite|db)$/;

function getBackupFolder() {
  return path.dirname(getSqlitePath());
}

function isValidBackupFilename(filename: string) {
  return RESTORABLE_BACKUP_PATTERN.test(filename) && path.basename(filename) === filename;
}

function isValidRestoreFilename(filename: string) {
  return RESTORABLE_BACKUP_PATTERN.test(filename)
    && path.basename(filename) === filename
    && !filename.includes('..')
    && !filename.includes('/')
    && !filename.includes('\\')
    && !path.isAbsolute(filename);
}

async function pruneOldBackups(folder: string) {
  const backups = (await fs.promises.readdir(folder))
    .filter((filename) => BACKUP_PATTERN.test(filename) && path.basename(filename) === filename)
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
  if (!isValidRestoreFilename(filename)) return null;

  const folder = getBackupFolder();
  const resolved = path.resolve(folder, filename);
  const resolvedFolder = path.resolve(folder);
  if (path.dirname(resolved) !== resolvedFolder) return null;

  return fs.existsSync(resolved) ? resolved : null;
}

function restoreTimestamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)?.value || '00';
  return `${value('year')}-${value('month')}-${value('day')}-${value('hour')}-${value('minute')}-${value('second')}`;
}

export async function restoreSqliteBackup(filename: string): Promise<{ restored_from: string; safety_backup: string }> {
  if (!isValidRestoreFilename(filename)) {
    throw new Error('Invalid backup filename');
  }

  const backups = await listSqliteBackups();
  if (!backups.some((backup) => backup.filename === filename)) {
    throw new Error('Backup not found');
  }

  const sqlitePath = getSqlitePath();
  const folder = getBackupFolder();
  const selectedPath = getSqliteBackupPath(filename);
  if (!selectedPath) throw new Error('Backup not found');
  if (!fs.existsSync(sqlitePath)) throw new Error('Current SQLite file not found');

  const safetyFilename = `before-restore-${restoreTimestamp()}.sqlite`;
  const safetyPath = path.join(folder, safetyFilename);
  const tempPath = path.join(folder, `.restore-${Date.now()}.tmp`);
  const rollbackPath = path.join(folder, `.rollback-${Date.now()}.sqlite`);

  await closeDb();
  await fs.promises.copyFile(sqlitePath, safetyPath, fs.constants.COPYFILE_EXCL);
  await fs.promises.copyFile(selectedPath, tempPath);

  const tempStats = await fs.promises.stat(tempPath);
  if (!tempStats.isFile() || tempStats.size === 0) {
    await fs.promises.unlink(tempPath).catch(() => undefined);
    throw new Error('Selected backup is empty or invalid');
  }

  try {
    await fs.promises.rename(sqlitePath, rollbackPath);
    await fs.promises.rename(tempPath, sqlitePath);
    await fs.promises.unlink(rollbackPath).catch(() => undefined);
  } catch (err) {
    await fs.promises.unlink(tempPath).catch(() => undefined);
    if (!fs.existsSync(sqlitePath) && fs.existsSync(rollbackPath)) {
      await fs.promises.rename(rollbackPath, sqlitePath).catch(() => undefined);
    }
    throw err;
  }

  return { restored_from: filename, safety_backup: safetyFilename };
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
