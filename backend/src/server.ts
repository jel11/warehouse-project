import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { getDb } from './db/connection';
import { authRoutes } from './routes/auth.routes';

const server = Fastify({
  logger: {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true },
    },
  },
});

// CORS
server.register(cors, {
  origin: process.env.FRONTEND_URL || true,
  credentials: true,
});

// JWT
server.register(jwt, {
  secret: process.env.JWT_SECRET || 'fallback_secret_change_in_production',
});

// Маршруты
server.register(authRoutes, { prefix: '/api/auth' });

// Healthcheck
server.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Обработка необработанных ошибок
server.setErrorHandler((error, _request, reply) => {
  server.log.error(error);

  if (error.statusCode) {
    reply.status(error.statusCode).send({ error: error.message });
    return;
  }

  // Ошибки валидации Fastify
  if (error.validation) {
    reply.status(400).send({ error: 'Ошибка валидации', details: error.validation });
    return;
  }

  reply.status(500).send({ error: 'Внутренняя ошибка сервера' });
});

// 404
server.setNotFoundHandler((_request, reply) => {
  reply.status(404).send({ error: 'Маршрут не найден' });
});

// Запуск сервера
const start = async () => {
  try {
    // Проверяем подключение к БД
    getDb();
    server.log.info('✓ База данных подключена');

    const port = Number(process.env.PORT) || 3000;
    const host = process.env.HOST || '0.0.0.0';

    await server.listen({ port, host });
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async () => {
  server.log.info('Завершение работы сервера...');
  await server.close();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

start();
