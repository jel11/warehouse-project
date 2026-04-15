// Роли пользователей
export type Role = 'admin' | 'manager' | 'inventarizator';

// Статусы инвентаризации
export type InventoryStatus = 'open' | 'closed';

// Статусы заявки на заказ
export type OrderStatus = 'draft' | 'confirmed' | 'done';

export interface User {
  id: number;
  login: string;
  password_hash: string;
  role: Role;
  name: string;
  created_at: string;
  deleted_at: string | null;
}

export interface Warehouse {
  id: number;
  name: string;
  is_transit: number; // 0 | 1 (SQLite boolean)
  deleted_at: string | null;
}

export interface Item {
  id: number;
  name: string;
  unit: string;
  warehouse_id: number;
  min_stock: number;
  current_stock: number;
  order_multiplier: number;
  supplier: string | null;
  is_active: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Inventory {
  id: number;
  user_id: number;
  warehouse_id: number;
  status: InventoryStatus;
  notes: string | null;
  created_at: string;
  closed_at: string | null;
  deleted_at: string | null;
}

export interface InventoryItem {
  id: number;
  inventory_id: number;
  item_id: number;
  counted_qty: number;
  previous_qty: number;
  created_at: string;
}

export interface Order {
  id: number;
  inventory_id: number;
  status: OrderStatus;
  created_at: string;
  deleted_at: string | null;
}

export interface OrderItem {
  id: number;
  order_id: number;
  item_id: number;
  qty_to_order: number;
  supplier: string | null;
}

export interface AuditLog {
  id: number;
  user_id: number | null;
  action: string;
  entity: string;
  entity_id: number;
  old_value: string | null; // JSON
  new_value: string | null; // JSON
  timestamp: string;
}

// Payload JWT токена
export interface JwtPayload {
  id: number;
  login: string;
  role: Role;
}
