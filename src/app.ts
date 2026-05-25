import express from 'express';
import path from 'path';
import fs from 'fs';
import { initTaskSchema } from './database/sqlite';
import { authRouter } from './modules/auth/auth.routes';
import { backupRouter } from './modules/backup/backup.routes';
import { calendarRouter } from './modules/calendar/calendar.routes';
import { dailyReviewRouter, ensureDailyReviewTable } from './modules/dailyReview/dailyReview.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { ensureSubtasksTable, tasksRouter } from './modules/tasks/tasks.routes';
import { startDailySqliteBackup } from './modules/cron/backup';

async function bootstrap() {
  await initTaskSchema();
  await ensureSubtasksTable();
  await ensureDailyReviewTable();
  startDailySqliteBackup();

  const app = express();
  const publicDir = fs.existsSync(path.join(__dirname, 'public'))
    ? path.join(__dirname, 'public')
    : path.join(process.cwd(), 'src', 'public');

  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'kronos-tasks', ts: new Date().toISOString() });
  });

  app.use('/api', authRouter);
  app.use('/api', backupRouter);
  app.use('/api', calendarRouter);
  app.use('/api', dailyReviewRouter);
  app.use('/api', reportsRouter);
  app.use('/api', tasksRouter);

  app.get('*', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(err);
    const message = err instanceof Error ? err.message : 'Erro interno';
    res.status(400).json({ error: message });
  });

  const port = Number(process.env.PORT || 3002);
  app.listen(port, () => {
    console.log(`Kronos Tarefas v1 rodando em http://localhost:${port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Falha ao inicializar Kronos:', err);
  process.exit(1);
});
