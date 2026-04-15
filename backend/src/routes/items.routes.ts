import { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection';
import { requireAuth, requireRole } from '../middleware/auth';
import { createItem, updateItem, softDeleteItem, calcOrderQty } from '../services/items.service';
import type { Item } from '../types';

// JSON Schema для тела создания товара
const createItemSchema = {
  type: 'object',
  required: ['name', 'warehouse_id'],
  properties: {
    name:             { type: 'string', minLength: 1, maxLength: 200 },
    unit:             { type: 'string', minLength: 1, maxLength: 20 },
    warehouse_id:     { type: 'integer', minimum: 1 },
    min_stock:        { type: 'number', minimum: 0 },
    current_stock:    { type: 'number', minimum: 0 },
    order_multiplier: { type: 'number', minimum: 0.1, maximum: 10 },
    supplier:         { type: 'string', maxLength: 200 },
  },
  additionalProperties: false,
};

// JSON Schema для тела обновления товара
const updateItemSchema = {
  type: 'object',
  minProperties: 1,
  properties: {
    name:             { type: 'string', minLength: 1, maxLength: 200 },
    unit:             { type: 'string', minLength: 1, maxLength: 20 },
    min_stock:        { type: 'number', minimum: 0 },
    current_stock:    { type: 'number', minimum: 0 },
    order_multiplier: { type: 'number', minimum: 0.1, maximum: 10 },
    supplier:         { type: 'string', maxLength: 200 },
    is_active:        { type: 'integer', enum: [0, 1] },
  },
  additionalProperties: false,
};

const idParamSchema = {
  type: 'object',
  properties: { id: { type: 'string', pattern: '^[0-9]+$' } },
};

export async function itemsRoutes(server: FastifyInstance): Promise<void> {
  // GET /api/items?warehouse_id=X — список активных товаров склада
  server.get<{ Querystring: { warehouse_id?: string } }>(
    '/',
    {
      preHandler: [requireAuth],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            warehouse_id: { type: 'string', pattern: '^[0-9]+$' },
          },
        },
      },
    },
    async (request, reply) => {
      const db = getDb();
      const { warehouse_id } = request.query;

      let items: Item[];

      if (warehouse_id) {
        items = db.prepare(`
          SELECT * FROM items
          WHERE warehouse_id = ? AND deleted_at IS NULL
          ORDER BY name
        `).all(Number(warehouse_id)) as Item[];
      } else {
        items = db.prepare(`
          SELECT * FROM items
          WHERE deleted_at IS NULL
          ORDER BY warehouse_id, name
        `).all() as Item[];
      }

      // Добавляем расчётное поле order_qty к каждой позиции
      const result = items.map((item) => ({
        ...item,
        order_qty: calcOrderQty(item),
      }));

      reply.send({ data: result, total: result.length });
    }
  );

  // GET /api/items/:id — один товар
  server.get<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [requireAuth],
      schema: { params: idParamSchema },
    },
    async (request, reply) => {
      const db = getDb();
      const item = db
        .prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL')
        .get(Number(request.params.id)) as Item | undefined;

      if (!item) {
        return reply.status(404).send({ error: 'Товар не найден' });
      }

      reply.send({ data: { ...item, order_qty: calcOrderQty(item) } });
    }
  );

  // POST /api/items — создать (admin/manager)
  server.post<{ Body: Parameters<typeof createItem>[0] }>(
    '/',
    {
      preHandler: [requireAuth, requireRole('admin', 'manager')],
      schema: { body: createItemSchema },
    },
    async (request, reply) => {
      const item = createItem(request.body, request.user.id);
      reply.status(201).send({ data: { ...item, order_qty: calcOrderQty(item) } });
    }
  );

  // PATCH /api/items/:id — обновить (admin/manager)
  server.patch<{
    Params: { id: string };
    Body: Parameters<typeof updateItem>[1];
  }>(
    '/:id',
    {
      preHandler: [requireAuth, requireRole('admin', 'manager')],
      schema: { params: idParamSchema, body: updateItemSchema },
    },
    async (request, reply) => {
      const item = updateItem(Number(request.params.id), request.body, request.user.id);
      reply.send({ data: { ...item, order_qty: calcOrderQty(item) } });
    }
  );

  // DELETE /api/items/:id — soft delete (только admin)
  server.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [requireAuth, requireRole('admin')],
      schema: { params: idParamSchema },
    },
    async (request, reply) => {
      softDeleteItem(Number(request.params.id), request.user.id);
      reply.status(204).send();
    }
  );
}
