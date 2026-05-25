import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';

export type KronosDb = Database<sqlite3.Database, sqlite3.Statement>;

let connection: KronosDb | null = null;

const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'kronos.sqlite');

export function getSqlitePath(): string {
  return dbPath;
}

export async function getDb(): Promise<KronosDb> {
  if (connection) return connection;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  connection = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await connection.exec('PRAGMA foreign_keys = ON;');
  return connection;
}

export async function initTaskSchema(): Promise<void> {
  const db = await getDb();

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      company TEXT,
      impact TEXT,
      list_type TEXT,
      status TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME NULL,
      completed_at DATETIME NULL,
      duration_min INTEGER NULL
    );

    CREATE TABLE IF NOT EXISTS task_status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_filters
      ON tasks(list_type, company, impact, status);

    CREATE INDEX IF NOT EXISTS idx_task_status_history_task
      ON task_status_history(task_id, changed_at DESC);
  `);

  const columns = await db.all<{ name: string }[]>('PRAGMA table_info(tasks)');
  if (!columns.some((column) => column.name === 'due_date')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN due_date DATE NULL;');
  }
  if (!columns.some((column) => column.name === 'sync_to_calendar')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN sync_to_calendar INTEGER NOT NULL DEFAULT 0;');
  }
  if (!columns.some((column) => column.name === 'google_event_id')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN google_event_id TEXT NULL;');
  }
  if (!columns.some((column) => column.name === 'calendar_start_time')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN calendar_start_time TEXT NULL;');
  }
  if (!columns.some((column) => column.name === 'calendar_duration_min')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN calendar_duration_min INTEGER NULL;');
  }
  if (!columns.some((column) => column.name === 'recurrence_type')) {
    await db.exec("ALTER TABLE tasks ADD COLUMN recurrence_type TEXT NOT NULL DEFAULT 'none';");
  }
  if (!columns.some((column) => column.name === 'recurrence_interval')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN recurrence_interval INTEGER NOT NULL DEFAULT 1;');
  }
  if (!columns.some((column) => column.name === 'recurrence_next_date')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN recurrence_next_date TEXT NULL;');
  }
  if (!columns.some((column) => column.name === 'recurring_parent_id')) {
    await db.exec('ALTER TABLE tasks ADD COLUMN recurring_parent_id INTEGER NULL;');
  }
}
