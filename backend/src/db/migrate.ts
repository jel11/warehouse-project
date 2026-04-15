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
