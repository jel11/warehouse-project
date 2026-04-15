# Backend — Warehouse Management App

## Стек
- Node.js 20 + Fastify 4 + TypeScript
- better-sqlite3 (синхронный SQLite, без ORM)
- JWT (@fastify/jwt) + bcrypt для аутентификации
- dotenv для конфигурации

## Запуск
```bash
cp .env.example .env        # настроить переменные
npm install
npm run migrate             # создать БД, склады, admin-пользователя
npm run dev                 # dev-режим с hot reload (tsx watch)
```

## Структура src/
```
routes/      — маршруты Fastify (auth, warehouses, items, inventories, orders)
services/    — бизнес-логика, отдельная от маршрутов
db/
  connection.ts  — singleton getDb()
  schema.sql     — DDL всех таблиц
  migrate.ts     — применяет схему и сидинг
middleware/  — декораторы (authenticate, checkRole)
jobs/        — node-cron задачи (резервное копирование)
types/       — TypeScript интерфейсы
```

## Правила работы с БД
- Всегда использовать `getDb()` из `db/connection.ts` — никаких new Database()
- Soft delete: обновлять `deleted_at = datetime('now')`, не DELETE
- После любого изменения данных писать запись в `audit_log`
- Все веса в кг (REAL), остатки могут быть дробными
- Основной склад (is_transit=1): current_stock всегда должен оставаться 0

## Правила маршрутов
- Все защищённые маршруты используют `preHandler: [server.authenticate]`
- Ответы об ошибках: `{ error: "текст" }` или `{ error: "...", details: [...] }`
- Успешные ответы: `{ data: ... }` или `{ data: ..., total: N }` для списков
- Статусы HTTP: 200 OK, 201 Created, 400 Bad Request, 401, 403, 404, 500

## Переменные окружения (.env)
| Переменная      | Описание                          |
|-----------------|-----------------------------------|
| PORT            | Порт сервера (default: 3000)      |
| JWT_SECRET      | Секрет для подписи JWT            |
| ADMIN_PASSWORD  | Пароль admin при первой миграции  |
| BACKUP_DIR      | Путь для резервных копий          |
| DB_PATH         | Путь к файлу базы (опционально)   |
| FRONTEND_URL    | URL фронтенда для CORS (опц.)     |
