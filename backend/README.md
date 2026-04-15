# Warehouse Backend

API-сервер на Fastify + SQLite для системы учёта склада.

## Быстрый старт

```bash
cp .env.example .env   # задать JWT_SECRET и ADMIN_PASSWORD
npm install
npm run migrate        # создать БД + сидинг
npm run dev            # запуск с hot-reload на :3000
```

## Переменные окружения

| Переменная      | По умолчанию | Описание                         |
|-----------------|--------------|----------------------------------|
| PORT            | 3000         | Порт сервера                     |
| JWT_SECRET      | —            | Секрет JWT (обязательно сменить) |
| ADMIN_PASSWORD  | —            | Пароль при первой миграции       |
| BACKUP_DIR      | ./backups    | Папка для резервных копий        |
| DB_PATH         | ./database.sqlite | Путь к файлу базы           |

## Тестирование через curl

### Healthcheck
```bash
curl http://localhost:3000/health
```

### Вход (получить токен)
```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin123"}' | python3 -m json.tool
```

### Текущий пользователь
```bash
TOKEN="вставить_токен_сюда"

curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

### Один запрос: логин + me
```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"login":"admin","password":"admin123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

curl -s http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | python3 -m json.tool
```

### Ожидаемые ответы на ошибки

| Ситуация              | Статус | Тело                                    |
|-----------------------|--------|-----------------------------------------|
| Неверный пароль       | 401    | `{"error":"Неверный логин или пароль"}` |
| Без токена            | 401    | `{"error":"Необходима авторизация"}`    |
| Недостаточно прав     | 403    | `{"error":"Недостаточно прав"}`         |
| Маршрут не существует | 404    | `{"error":"Маршрут не найден"}`         |

## Структура проекта

```
src/
├── db/
│   ├── connection.ts   — singleton getDb()
│   ├── migrate.ts      — применяет схему и сидинг
│   └── schema.sql      — DDL всех таблиц
├── middleware/
│   ├── auth.ts         — requireAuth, requireRole()
│   └── audit.ts        — logAction()
├── routes/
│   └── auth.routes.ts  — POST /login, GET /me
├── services/
│   └── auth.service.ts — hashPassword, verifyPassword, generateToken, login
├── types/
│   └── index.ts        — TypeScript интерфейсы
└── server.ts           — точка входа
```
