import express from 'express';
import path from 'path';
import fs from 'fs';
import { initTaskSchema } from './database/sqlite';
import { tasksRouter } from './modules/tasks/tasks.routes';

async function bootstrap() {
  await initTaskSchema();

  const app = express();
  const publicDir = fs.existsSync(path.join(__dirname, 'public'))
    ? path.join(__dirname, 'public')
    : path.join(process.cwd(), 'src', 'public');

  app.use(express.json());
  app.use(express.static(publicDir));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'kronos-tasks', ts: new Date().toISOString() });
  });

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
