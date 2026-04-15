import { FastifyInstance } from 'fastify';
import { getDb } from '../db/connection';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  createInventory,
  getInventoryWithItems,
  updateInventoryItem,
  closeInventory,
  createCorrection,
  softDeleteInventory,
} from '../services/inventories.service';
import type { Inventory } from '../types';

const idParam = {
  type: 'object',
  properties: { id: { type: 'string', pattern: '^[0-9]+$' } },
};

export async function inventoriesRoutes(server: FastifyInstance): Promise<void> {
  // GET /api/inventories?warehouse_id=X&status=Y
  server.get<{ Querystring: { warehouse_id?: string; status?: string } }>(
    '/',
    {
      preHandler: [requireAuth],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            warehouse_id: { type: 'string', pattern: '^[0-9]+$' },
            status:       { type: 'string', enum: ['open', 'closed'] },
          },
        },
      },
    },
    async (request, reply) => {
      const db = getDb();
      const { warehouse_id, status } = request.query;

      // Строим запрос динамически по фильтрам
      const conditions: string[] = ['i.deleted_at IS NULL'];
      const params: (string | number)[] = [];

      if (warehouse_id) {
        conditions.push('i.warehouse_id = ?');
        params.push(Number(warehouse_id));
      }
      if (status) {
        conditions.push('i.status = ?');
        params.push(status);
      }

      const sql = `
        SELECT i.id, i.warehouse_id, i.user_id, i.status, i.notes,
               i.created_at, i.closed_at,
               w.name AS warehouse_name,
               u.name AS user_name,
               COUNT(ii.id)                                  AS total_items,
               SUM(CASE WHEN ii.counted_qty IS NULL THEN 1 ELSE 0 END) AS pending_items
        FROM inventories i
        JOIN warehouses w ON w.id = i.warehouse_id
        JOIN users u ON u.id = i.user_id
        LEFT JOIN inventory_items ii ON ii.inventory_id = i.id
        WHERE ${conditions.join(' AND ')}
        GROUP BY i.id
        ORDER BY i.created_at DESC
      `;

      const rows = db.prepare(sql).all(...params);
      reply.send({ data: rows, total: (rows as unknown[]).length });
    }
  );

  // GET /api/inventories/:id
  server.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireAuth], schema: { params: idParam } },
    async (request, reply) => {
      const inv = getInventoryWithItems(Number(request.params.id));
      reply.send({ data: inv });
    }
  );

  // POST /api/inventories — создать черновик
  server.post<{ Body: { warehouse_id: number; notes?: string } }>(
    '/',
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: 'object',
          required: ['warehouse_id'],
          properties: {
            warehouse_id: { type: 'integer', minimum: 1 },
            notes:        { type: 'string', maxLength: 500 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const { warehouse_id, notes } = request.body;
      const inv = createInventory(warehouse_id, request.user.id, notes);
      reply.status(201).send({ data: inv });
    }
  );

  // PATCH /api/inventories/:id/items/:itemId — ввод counted_qty
  server.patch<{
    Params: { id: string; itemId: string };
    Body: { counted_qty: number };
  }>(
    '/:id/items/:itemId',
    {
      preHandler: [requireAuth],
      schema: {
        params: {
          type: 'object',
          properties: {
            id:     { type: 'string', pattern: '^[0-9]+$' },
            itemId: { type: 'string', pattern: '^[0-9]+$' },
          },
        },
        body: {
          type: 'object',
          required: ['counted_qty'],
          properties: {
            counted_qty: { type: 'number', minimum: 0 },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const updated = updateInventoryItem(
        Number(request.params.id),
        Number(request.params.itemId),
        request.body.counted_qty,
        request.user.id
      );
      reply.send({ data: updated });
    }
  );

  // POST /api/inventories/:id/close
  server.post<{ Params: { id: string } }>(
    '/:id/close',
    { preHandler: [requireAuth], schema: { params: idParam } },
    async (request, reply) => {
      // Менеджер и инвентаризатор тоже могут закрывать — проверка только на open
      const result = closeInventory(Number(request.params.id), request.user.id);
      reply.send({ data: result });
    }
  );

  // POST /api/inventories/:id/correction — только admin
  server.post<{
    Params: { id: string };
    Body: { notes?: string };
  }>(
    '/:id/correction',
    {
      preHandler: [requireAuth, requireRole('admin')],
      schema: {
        params: idParam,
        body: {
          type: 'object',
          properties: { notes: { type: 'string', maxLength: 500 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const inv = createCorrection(
        Number(request.params.id),
        request.user.id,
        request.body?.notes
      );
      reply.status(201).send({ data: inv });
    }
  );

  // DELETE /api/inventories/:id — soft delete, только admin
  server.delete<{ Params: { id: string } }>(
    '/:id',
    {
      preHandler: [requireAuth, requireRole('admin')],
      schema: { params: idParam },
    },
    async (request, reply) => {
      softDeleteInventory(Number(request.params.id), request.user.id);
      reply.status(204).send();
    }
  );
}
