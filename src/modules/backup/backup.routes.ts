import path from 'path';
import { Router } from 'express';
import { getSqliteBackupPath, listSqliteBackups, restoreSqliteBackup, runSqliteBackup } from '../cron/backup';
import { requireApiAuth } from '../auth/auth';

const router = Router();
const BACKUP_PATTERN = /^(kronos_backup_\d{4}-\d{2}-\d{2}|before-restore-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.(sqlite|db)$/;

router.use('/backups', requireApiAuth);

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

router.post('/backups/restore', async (req, res, next) => {
  try {
    const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
    if (!BACKUP_PATTERN.test(filename) || path.basename(filename) !== filename || filename.includes('..')) {
      return res.status(400).json({ error: 'Invalid backup filename' });
    }

    const result = await restoreSqliteBackup(filename);
    return res.json({
      ok: true,
      restored_from: result.restored_from,
      safety_backup: result.safety_backup,
      message: 'Backup restaurado. Recarregue a página.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not restore backup';
    const status = message === 'Backup not found' ? 404 : 400;
    return res.status(status).json({ error: message });
  }
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
