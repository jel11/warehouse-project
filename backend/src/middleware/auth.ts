import { FastifyRequest, FastifyReply } from 'fastify';
import type { Role, JwtPayload } from '../types';

// Расширяем тип JWT payload через namespace @fastify/jwt
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

// Проверяет JWT и записывает payload в request.user
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await request.jwtVerify();
    // request.user заполняется плагином @fastify/jwt автоматически
  } catch {
    reply.status(401).send({ error: 'Необходима авторизация' });
  }
}

// Фабрика preHandler-а для проверки роли
// Использование: preHandler: [requireAuth, requireRole('admin', 'manager')]
export function requireRole(...roles: Role[]) {
  return async function (request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = request.user;
    if (!user || !roles.includes(user.role)) {
      reply.status(403).send({ error: 'Недостаточно прав' });
    }
  };
}
