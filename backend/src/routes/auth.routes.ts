import { FastifyInstance } from 'fastify';
import { login } from '../services/auth.service';
import { requireAuth } from '../middleware/auth';
import { logAction } from '../middleware/audit';
import { getDb } from '../db/connection';
import type { User } from '../types';

interface LoginBody {
  login: string;
  password: string;
}

export async function authRoutes(server: FastifyInstance): Promise<void> {
  // POST /api/auth/login
  server.post<{ Body: LoginBody }>(
    '/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['login', 'password'],
          properties: {
            login: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const { login: loginStr, password } = request.body;
      const result = await login(server, loginStr, password);

      // Логируем успешный вход
      logAction(result.user.id, 'login', 'users', result.user.id);

      reply.status(200).send({ data: result });
    }
  );

  // GET /api/auth/me — возвращает текущего пользователя
  server.get(
    '/me',
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const db = getDb();
      const user = db
        .prepare('SELECT id, login, role, name, created_at FROM users WHERE id = ? AND deleted_at IS NULL')
        .get(request.user.id) as Omit<User, 'password_hash' | 'deleted_at'> | undefined;

      if (!user) {
        return reply.status(404).send({ error: 'Пользователь не найден' });
      }

      reply.send({ data: user });
    }
  );
}
