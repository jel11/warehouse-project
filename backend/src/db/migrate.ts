import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import { getDb } from './connection';

async function migrate() {
  const db = getDb();

  // Применяем схему
  const schemaPath = path.resolve(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);
  console.log('✓ Схема базы данных применена');

  // Миграция: counted_qty должно быть nullable (NULL = не подсчитано)
  // SQLite не поддерживает ALTER COLUMN — пересоздаём таблицу если нужно
  const colInfo = db.prepare("PRAGMA table_info(inventory_items)").all() as Array<{
    name: string; notnull: number;
  }>;
  const countedCol = colInfo.find(c => c.name === 'counted_qty');
  if (countedCol && countedCol.notnull === 1) {
    db.exec(`
      CREATE TABLE inventory_items_new (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        inventory_id  INTEGER NOT NULL REFERENCES inventories(id),
        item_id       INTEGER NOT NULL REFERENCES items(id),
        counted_qty   REAL,
        previous_qty  REAL NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO inventory_items_new SELECT * FROM inventory_items;
      DROP TABLE inventory_items;
      ALTER TABLE inventory_items_new RENAME TO inventory_items;
      CREATE INDEX IF NOT EXISTS idx_inventory_items_inventory
        ON inventory_items(inventory_id);
    `);
    console.log('✓ inventory_items.counted_qty теперь nullable');
  }

  // Сидинг складов
  const warehouses = [
    { name: 'Бар',            is_transit: 0 },
    { name: 'Лаборатория',    is_transit: 0 },
    { name: 'Кухня',          is_transit: 0 },
    { name: 'Основной склад', is_transit: 1 }, // транзитный, всегда = 0
  ];

  const insertWarehouse = db.prepare(`
    INSERT OR IGNORE INTO warehouses (name, is_transit) VALUES (?, ?)
  `);

  for (const w of warehouses) {
    insertWarehouse.run(w.name, w.is_transit);
  }
  console.log('✓ Склады созданы');

  // Создание администратора по умолчанию
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('✗ Переменная ADMIN_PASSWORD не задана в .env');
    process.exit(1);
  }

  const existingAdmin = db.prepare('SELECT id FROM users WHERE login = ?').get('admin');
  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    db.prepare(`
      INSERT INTO users (login, password_hash, role, name)
      VALUES ('admin', ?, 'admin', 'Администратор')
    `).run(passwordHash);
    console.log('✓ Администратор создан (login: admin)');
  } else {
    console.log('— Администратор уже существует, пропуск');
  }

  console.log('\nМиграция завершена успешно.');
  process.exit(0);
}

migrate().catch((err) => {
  console.error('Ошибка миграции:', err);
  process.exit(1);
});
