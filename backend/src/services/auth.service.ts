import bcrypt from 'bcrypt';
import { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection';
import type { User, JwtPayload } from '../types';

const SALT_ROUNDS = 10;
// Срок жизни токена: 7 дней в секундах
const TOKEN_TTL = 7 * 24 * 60 * 60;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function generateToken(server: FastifyInstance, user: User): string {
  const payload: JwtPayload = {
    id: user.id,
    login: user.login,
    role: user.role,
  };
  return server.jwt.sign(payload, { expiresIn: TOKEN_TTL });
}

export interface LoginResult {
  token: string;
  user: {
    id: number;
    login: string;
    role: string;
    name: string;
  };
}

export async function login(
  server: FastifyInstance,
  loginStr: string,
  password: string
): Promise<LoginResult> {
  const db = getDb();

  // Ищем активного пользователя по логину
  const user = db
    .prepare('SELECT * FROM users WHERE login = ? AND deleted_at IS NULL')
    .get(loginStr) as User | undefined;

  if (!user) {
    throw Object.assign(new Error('Неверный логин или пароль'), { statusCode: 401 });
  }

  const passwordValid = await verifyPassword(password, user.password_hash);
  if (!passwordValid) {
    throw Object.assign(new Error('Неверный логин или пароль'), { statusCode: 401 });
  }

  const token = generateToken(server, user);

  return {
    token,
    user: {
      id: user.id,
      login: user.login,
      role: user.role,
      name: user.name,
    },
  };
}
