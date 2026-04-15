import Database from 'better-sqlite3';
import path from 'path';

// Singleton подключение к SQLite
let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'database.sqlite');
    db = new Database(dbPath);

    // Включаем WAL-режим и внешние ключи при каждом подключении
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
