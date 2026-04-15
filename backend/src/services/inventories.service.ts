import { getDb } from '../db/connection';
import { logAction } from '../middleware/audit';
import { calcOrderQty } from './items.service';
import type { Inventory, InventoryItem, Item, Order, OrderItem } from '../types';

// ─── Типы ────────────────────────────────────────────────────────────────────

export interface InventoryItemRow extends InventoryItem {
  // Поля товара, добавляемые JOIN-ом для удобства фронта
  item_name: string;
  item_unit: string;
  min_stock: number;
  order_multiplier: number;
  supplier: string | null;
}

export interface InventoryWithItems extends Inventory {
  items: InventoryItemRow[];
  warehouse_name: string;
  user_name: string;
}

// ─── Вспомогательные функции ─────────────────────────────────────────────────

function err(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

/** Загружает инвентаризацию и проверяет что она существует и не удалена. */
function getInventoryOrThrow(id: number): Inventory {
  const db = getDb();
  const inv = db
    .prepare('SELECT * FROM inventories WHERE id = ? AND deleted_at IS NULL')
    .get(id) as Inventory | undefined;
  if (!inv) throw err('Инвентаризация не найдена', 404);
  return inv;
}

// ─── Публичные функции сервиса ────────────────────────────────────────────────

/**
 * Создаёт черновик инвентаризации.
 * Автоматически копирует все активные товары склада в inventory_items:
 *   counted_qty = NULL (не подсчитано), previous_qty = current_stock
 */
export function createInventory(
  warehouseId: number,
  userId: number,
  notes?: string
): InventoryWithItems {
  const db = getDb();

  return db.transaction(() => {
    // Проверяем склад
    const warehouse = db
      .prepare('SELECT id, name FROM warehouses WHERE id = ? AND deleted_at IS NULL')
      .get(warehouseId) as { id: number; name: string } | undefined;
    if (!warehouse) throw err('Склад не найден', 404);

    // Запрещаем параллельные открытые инвентаризации одного склада
    const openInv = db
      .prepare(`SELECT id FROM inventories
                WHERE warehouse_id = ? AND status = 'open' AND deleted_at IS NULL`)
      .get(warehouseId);
    if (openInv) {
      throw err('По этому складу уже есть открытая инвентаризация', 409);
    }

    // Создаём запись инвентаризации
    const invResult = db.prepare(`
      INSERT INTO inventories (user_id, warehouse_id, notes)
      VALUES (?, ?, ?)
    `).run(userId, warehouseId, notes ?? null);

    const inventoryId = Number(invResult.lastInsertRowid);

    // Копируем активные товары склада
    const items = db.prepare(`
      SELECT * FROM items
      WHERE warehouse_id = ? AND is_active = 1 AND deleted_at IS NULL
      ORDER BY name
    `).all(warehouseId) as Item[];

    const insertLine = db.prepare(`
      INSERT INTO inventory_items (inventory_id, item_id, counted_qty, previous_qty)
      VALUES (?, ?, NULL, ?)
    `);
    for (const item of items) {
      insertLine.run(inventoryId, item.id, item.current_stock);
    }

    logAction(userId, 'create', 'inventories', inventoryId, null, {
      warehouse_id: warehouseId,
      items_count: items.length,
    });

    return getInventoryWithItems(inventoryId);
  })();
}

/**
 * Загружает инвентаризацию вместе с позициями и данными товаров.
 */
export function getInventoryWithItems(id: number): InventoryWithItems {
  const db = getDb();

  const inv = db.prepare(`
    SELECT i.*, w.name AS warehouse_name, u.name AS user_name
    FROM inventories i
    JOIN warehouses w ON w.id = i.warehouse_id
    JOIN users u ON u.id = i.user_id
    WHERE i.id = ? AND i.deleted_at IS NULL
  `).get(id) as (Inventory & { warehouse_name: string; user_name: string }) | undefined;

  if (!inv) throw err('Инвентаризация не найдена', 404);

  const items = db.prepare(`
    SELECT
      ii.id, ii.inventory_id, ii.item_id,
      ii.counted_qty, ii.previous_qty, ii.created_at,
      it.name  AS item_name,
      it.unit  AS item_unit,
      it.min_stock,
      it.order_multiplier,
      it.supplier
    FROM inventory_items ii
    JOIN items it ON it.id = ii.item_id
    WHERE ii.inventory_id = ?
    ORDER BY it.name
  `).all(id) as InventoryItemRow[];

  return { ...inv, items };
}

/**
 * Обновляет counted_qty одной позиции инвентаризации.
 * Инвентаризация должна быть открытой.
 */
export function updateInventoryItem(
  inventoryId: number,
  itemId: number,
  countedQty: number,
  userId: number
): InventoryItemRow {
  const db = getDb();

  const inv = getInventoryOrThrow(inventoryId);
  if (inv.status === 'closed') throw err('Закрытая инвентаризация не редактируется', 403);

  const line = db.prepare(`
    SELECT * FROM inventory_items WHERE inventory_id = ? AND item_id = ?
  `).get(inventoryId, itemId) as InventoryItem | undefined;

  if (!line) throw err('Позиция не найдена в этой инвентаризации', 404);

  const old = { counted_qty: line.counted_qty };

  db.prepare(`
    UPDATE inventory_items SET counted_qty = ? WHERE inventory_id = ? AND item_id = ?
  `).run(countedQty, inventoryId, itemId);

  logAction(userId, 'update', 'inventory_items', line.id, old, { counted_qty: countedQty });

  // Возвращаем обновлённую строку с JOIN
  return db.prepare(`
    SELECT
      ii.id, ii.inventory_id, ii.item_id,
      ii.counted_qty, ii.previous_qty, ii.created_at,
      it.name AS item_name, it.unit AS item_unit,
      it.min_stock, it.order_multiplier, it.supplier
    FROM inventory_items ii
    JOIN items it ON it.id = ii.item_id
    WHERE ii.inventory_id = ? AND ii.item_id = ?
  `).get(inventoryId, itemId) as InventoryItemRow;
}

/**
 * Закрывает инвентаризацию.
 * 1. Все counted_qty должны быть заполнены.
 * 2. Обновляет current_stock товаров.
 * 3. Создаёт заявку (orders + order_items) для позиций ниже min_stock.
 * 4. Ставит status='closed', closed_at=NOW.
 */
export function closeInventory(
  inventoryId: number,
  userId: number
): { inventory: InventoryWithItems; order: (Order & { items: OrderItem[] }) | null } {
  const db = getDb();

  return db.transaction(() => {
    const inv = getInventoryOrThrow(inventoryId);
    if (inv.status === 'closed') throw err('Инвентаризация уже закрыта', 409);

    const lines = db.prepare(`
      SELECT ii.*, it.min_stock, it.order_multiplier, it.supplier
      FROM inventory_items ii
      JOIN items it ON it.id = ii.item_id
      WHERE ii.inventory_id = ?
    `).all(inventoryId) as (InventoryItem & {
      min_stock: number; order_multiplier: number; supplier: string | null;
    })[];

    // Проверяем что все позиции подсчитаны
    const unfilled = lines.filter(l => l.counted_qty === null);
    if (unfilled.length > 0) {
      throw err(
        `Не заполнено ${unfilled.length} позиций. Заполните все перед закрытием.`,
        422
      );
    }

    // Обновляем current_stock товаров
    const updateStock = db.prepare(
      `UPDATE items SET current_stock = ?, updated_at = datetime('now') WHERE id = ?`
    );
    for (const line of lines) {
      updateStock.run(line.counted_qty, line.item_id);
    }

    // Создаём заявку для позиций ниже нормы
    const needOrder = lines.filter(line =>
      (line.counted_qty as number) < line.min_stock
    );

    let order: (Order & { items: OrderItem[] }) | null = null;

    if (needOrder.length > 0) {
      const orderResult = db.prepare(`
        INSERT INTO orders (inventory_id, status) VALUES (?, 'draft')
      `).run(inventoryId);

      const orderId = Number(orderResult.lastInsertRowid);

      const insertOrderItem = db.prepare(`
        INSERT INTO order_items (order_id, item_id, qty_to_order, supplier)
        VALUES (?, ?, ?, ?)
      `);

      const orderItems: OrderItem[] = [];
      for (const line of needOrder) {
        const qtyToOrder = calcOrderQty({
          min_stock:        line.min_stock,
          order_multiplier: line.order_multiplier,
          current_stock:    line.counted_qty as number,
        });
        const res = insertOrderItem.run(orderId, line.item_id, qtyToOrder, line.supplier);
        orderItems.push({
          id: Number(res.lastInsertRowid),
          order_id: orderId,
          item_id: line.item_id,
          qty_to_order: qtyToOrder,
          supplier: line.supplier,
        });
      }

      const orderRow = db
        .prepare('SELECT * FROM orders WHERE id = ?')
        .get(orderId) as Order;

      order = { ...orderRow, items: orderItems };
      logAction(userId, 'create', 'orders', orderId, null, { inventory_id: inventoryId });
    }

    // Закрываем инвентаризацию
    db.prepare(`
      UPDATE inventories
      SET status = 'closed', closed_at = datetime('now')
      WHERE id = ?
    `).run(inventoryId);

    logAction(userId, 'close', 'inventories', inventoryId, { status: 'open' }, { status: 'closed' });

    return { inventory: getInventoryWithItems(inventoryId), order };
  })();
}

/**
 * Создаёт корректирующую инвентаризацию на основе закрытой.
 * Копирует те же товары, но с текущими остатками и counted_qty=NULL.
 */
export function createCorrection(
  sourceInventoryId: number,
  userId: number,
  notes?: string
): InventoryWithItems {
  const db = getDb();

  return db.transaction(() => {
    const source = getInventoryOrThrow(sourceInventoryId);
    if (source.status !== 'closed') {
      throw err('Корректировку можно создать только на основе закрытой инвентаризации', 422);
    }

    // Запрещаем параллельные открытые инвентаризации того же склада
    const openInv = db
      .prepare(`SELECT id FROM inventories
                WHERE warehouse_id = ? AND status = 'open' AND deleted_at IS NULL`)
      .get(source.warehouse_id);
    if (openInv) {
      throw err('По этому складу уже есть открытая инвентаризация', 409);
    }

    // Создаём новую инвентаризацию
    const invResult = db.prepare(`
      INSERT INTO inventories (user_id, warehouse_id, notes)
      VALUES (?, ?, ?)
    `).run(userId, source.warehouse_id, notes ?? `Корректировка к инв. #${sourceInventoryId}`);

    const newInventoryId = Number(invResult.lastInsertRowid);

    // Берём товары из исходной инвентаризации, но с актуальными остатками
    const sourceItems = db.prepare(`
      SELECT ii.item_id, it.current_stock
      FROM inventory_items ii
      JOIN items it ON it.id = ii.item_id
      WHERE ii.inventory_id = ? AND it.deleted_at IS NULL
      ORDER BY it.name
    `).all(sourceInventoryId) as { item_id: number; current_stock: number }[];

    const insertLine = db.prepare(`
      INSERT INTO inventory_items (inventory_id, item_id, counted_qty, previous_qty)
      VALUES (?, ?, NULL, ?)
    `);
    for (const row of sourceItems) {
      insertLine.run(newInventoryId, row.item_id, row.current_stock);
    }

    logAction(userId, 'correction', 'inventories', newInventoryId, null, {
      source_inventory_id: sourceInventoryId,
      warehouse_id: source.warehouse_id,
    });

    return getInventoryWithItems(newInventoryId);
  })();
}

/**
 * Мягкое удаление инвентаризации (только admin).
 */
export function softDeleteInventory(id: number, userId: number): void {
  const db = getDb();

  const inv = getInventoryOrThrow(id);

  db.prepare(`UPDATE inventories SET deleted_at = datetime('now') WHERE id = ?`).run(id);

  logAction(userId, 'delete', 'inventories', id, inv, null);
}
