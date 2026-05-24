import fs from 'fs';
import path from 'path';
import { CronJob } from 'cron';
import { getSqlitePath } from '../../database/sqlite';

const MAX_BACKUPS = 7;

async function runSqliteBackup() {
  const sqlitePath = getSqlitePath();
  if (!fs.existsSync(sqlitePath)) return;

  const folder = path.dirname(sqlitePath);
  const today = new Date().toISOString().slice(0, 10);
  const filename = `kronos_backup_${today}.sqlite`;
  const target = path.join(folder, filename);

  await fs.promises.copyFile(sqlitePath, target);

  const backups = (await fs.promises.readdir(folder))
    .filter((file) => /^kronos_backup_\d{4}-\d{2}-\d{2}\.sqlite$/.test(file))
    .sort()
    .reverse();

  await Promise.all(
    backups.slice(MAX_BACKUPS).map((file) => fs.promises.unlink(path.join(folder, file)))
  );

  console.log(`[backup] done → ${filename}`);
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
