import { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection';
import { requireAuth, requireRole } from '../middleware/auth';
import { logAction } from '../middleware/audit';
import type { Warehouse } from '../types';

export async function warehousesRoutes(server: FastifyInstance): Promise<void> {
  // GET /api/warehouses — все активные склады
  server.get(
    '/',
    { preHandler: [requireAuth] },
    async (_request, reply) => {
      const db = getDb();
      const warehouses = db
        .prepare('SELECT id, name, is_transit FROM warehouses WHERE deleted_at IS NULL ORDER BY id')
        .all();
      reply.send({ data: warehouses });
    }
  );

  // POST /api/warehouses — создать склад (только admin)
  server.post<{ Body: { name: string; is_transit?: number } }>(
    '/',
    {
      preHandler: [requireAuth, requireRole('admin')],
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name:       { type: 'string', minLength: 1, maxLength: 100 },
            is_transit: { type: 'integer', enum: [0, 1] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const db = getDb();
      const { name, is_transit = 0 } = request.body;

      const existing = db
        .prepare('SELECT id FROM warehouses WHERE name = ? AND deleted_at IS NULL')
        .get(name);
      if (existing) {
        return reply.status(409).send({ error: 'Склад с таким названием уже существует' });
      }

      const result = db
        .prepare('INSERT INTO warehouses (name, is_transit) VALUES (?, ?)')
        .run(name, is_transit);

      const warehouse = db
        .prepare('SELECT id, name, is_transit FROM warehouses WHERE id = ?')
        .get(result.lastInsertRowid) as Warehouse;

      logAction(request.user.id, 'create', 'warehouses', warehouse.id, null, warehouse);

      reply.status(201).send({ data: warehouse });
    }
  );

  // PATCH /api/warehouses/:id — обновить склад (только admin)
  server.patch<{
    Params: { id: string };
    Body: { name?: string; is_transit?: number };
  }>(
    '/:id',
    {
      preHandler: [requireAuth, requireRole('admin')],
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string', pattern: '^[0-9]+$' } },
        },
        body: {
          type: 'object',
          minProperties: 1,
          properties: {
            name:       { type: 'string', minLength: 1, maxLength: 100 },
            is_transit: { type: 'integer', enum: [0, 1] },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const db = getDb();
      const id = Number(request.params.id);

      const existing = db
        .prepare('SELECT * FROM warehouses WHERE id = ? AND deleted_at IS NULL')
        .get(id) as Warehouse | undefined;

      if (!existing) {
        return reply.status(404).send({ error: 'Склад не найден' });
      }

      const { name, is_transit } = request.body;

      // Проверяем уникальность нового имени (если меняется)
      if (name && name !== existing.name) {
        const duplicate = db
          .prepare('SELECT id FROM warehouses WHERE name = ? AND deleted_at IS NULL AND id != ?')
          .get(name, id);
        if (duplicate) {
          return reply.status(409).send({ error: 'Склад с таким названием уже существует' });
        }
      }

      db.prepare(`
        UPDATE warehouses
        SET name       = COALESCE(?, name),
            is_transit = COALESCE(?, is_transit)
        WHERE id = ?
      `).run(name ?? null, is_transit ?? null, id);

      const updated = db
        .prepare('SELECT id, name, is_transit FROM warehouses WHERE id = ?')
        .get(id) as Warehouse;

      logAction(request.user.id, 'update', 'warehouses', id, existing, updated);

      reply.send({ data: updated });
    }
  );
}
