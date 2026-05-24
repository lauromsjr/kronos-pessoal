import path from 'path';
import { Router } from 'express';
import { getSqliteBackupPath, listSqliteBackups, runSqliteBackup } from '../cron/backup';
import { requireTaskAuth } from '../auth/auth';

const router = Router();
const BACKUP_PATTERN = /^kronos_backup_\d{4}-\d{2}-\d{2}\.sqlite$/;

router.use('/backups', requireTaskAuth);

router.get('/backups', async (_req, res, next) => {
  try {
    const backups = await listSqliteBackups();
    res.json({ data: backups });
  } catch (err) { next(err); }
});

router.post('/backups/run', async (_req, res, next) => {
  try {
    const backup = await runSqliteBackup();
    const backups = await listSqliteBackups();
    const metadata = backups.find((item) => item.filename === backup.filename);

    res.json({
      ok: true,
      backup: {
        filename: backup.filename,
        size_bytes: metadata?.size_bytes ?? 0,
      },
    });
  } catch (err) { next(err); }
});

router.get('/backups/:filename/download', (req, res) => {
  const filename = req.params.filename;
  if (!BACKUP_PATTERN.test(filename) || path.basename(filename) !== filename) {
    return res.status(404).json({ error: 'Backup not found' });
  }

  const backupPath = getSqliteBackupPath(filename);
  if (!backupPath) return res.status(404).json({ error: 'Backup not found' });

  return res.download(backupPath, filename);
});

export const backupRouter = router;
