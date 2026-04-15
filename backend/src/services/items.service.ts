import { getDb } from '../db/connection';
import { logAction } from '../middleware/audit';
import type { Item } from '../types';

/**
 * Рассчитывает количество к заказу для позиции.
 * Формула: MAX(0, min_stock * order_multiplier - current_stock), округлить до 2 знаков
 */
export function calcOrderQty(item: Pick<Item, 'min_stock' | 'order_multiplier' | 'current_stock'>): number {
  const raw = item.min_stock * item.order_multiplier - item.current_stock;
  return Math.round(Math.max(0, raw) * 100) / 100;
}

export interface CreateItemInput {
  name: string;
  unit?: string;
  warehouse_id: number;
  min_stock?: number;
  current_stock?: number;
  order_multiplier?: number;
  supplier?: string;
}

export interface UpdateItemInput {
  name?: string;
  unit?: string;
  min_stock?: number;
  current_stock?: number;
  order_multiplier?: number;
  supplier?: string;
  is_active?: number;
}

export function createItem(input: CreateItemInput, userId: number): Item {
  const db = getDb();

  // Проверяем что склад существует и не удалён
  const warehouse = db
    .prepare('SELECT id FROM warehouses WHERE id = ? AND deleted_at IS NULL')
    .get(input.warehouse_id);
  if (!warehouse) {
    throw Object.assign(new Error('Склад не найден'), { statusCode: 404 });
  }

  const result = db.prepare(`
    INSERT INTO items (name, unit, warehouse_id, min_stock, current_stock, order_multiplier, supplier)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.name,
    input.unit ?? 'кг',
    input.warehouse_id,
    input.min_stock ?? 0,
    input.current_stock ?? 0,
    input.order_multiplier ?? 1.5,
    input.supplier ?? null,
  );

  const item = db
    .prepare('SELECT * FROM items WHERE id = ?')
    .get(result.lastInsertRowid) as Item;

  logAction(userId, 'create', 'items', item.id, null, item);
  return item;
}

export function updateItem(id: number, input: UpdateItemInput, userId: number): Item {
  const db = getDb();

  const existing = db
    .prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL')
    .get(id) as Item | undefined;

  if (!existing) {
    throw Object.assign(new Error('Товар не найден'), { statusCode: 404 });
  }

  // Вычисляем итоговые значения для полей, от которых зависит расчёт заявки
  const newMinStock        = input.min_stock        ?? existing.min_stock;
  const newCurrentStock    = input.current_stock    ?? existing.current_stock;
  const newOrderMultiplier = input.order_multiplier ?? existing.order_multiplier;

  const orderQty = calcOrderQty({
    min_stock:        newMinStock,
    order_multiplier: newOrderMultiplier,
    current_stock:    newCurrentStock,
  });

  db.prepare(`
    UPDATE items
    SET name             = COALESCE(?, name),
        unit             = COALESCE(?, unit),
        min_stock        = COALESCE(?, min_stock),
        current_stock    = COALESCE(?, current_stock),
        order_multiplier = COALESCE(?, order_multiplier),
        supplier         = COALESCE(?, supplier),
        is_active        = COALESCE(?, is_active),
        updated_at       = datetime('now')
    WHERE id = ?
  `).run(
    input.name            ?? null,
    input.unit            ?? null,
    input.min_stock       ?? null,
    input.current_stock   ?? null,
    input.order_multiplier ?? null,
    input.supplier        ?? null,
    input.is_active       ?? null,
    id,
  );

  const updated = db
    .prepare('SELECT * FROM items WHERE id = ?')
    .get(id) as Item;

  logAction(userId, 'update', 'items', id, existing, { ...updated, order_qty: orderQty });
  return updated;
}

export function softDeleteItem(id: number, userId: number): void {
  const db = getDb();

  const existing = db
    .prepare('SELECT * FROM items WHERE id = ? AND deleted_at IS NULL')
    .get(id) as Item | undefined;

  if (!existing) {
    throw Object.assign(new Error('Товар не найден'), { statusCode: 404 });
  }

  db.prepare(`UPDATE items SET deleted_at = datetime('now') WHERE id = ?`).run(id);

  logAction(userId, 'delete', 'items', id, existing, null);
}
