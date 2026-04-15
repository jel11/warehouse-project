PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Пользователи системы
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  login        TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role         TEXT NOT NULL CHECK(role IN ('admin', 'manager', 'inventarizator')),
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);

-- Склады (Бар, Лаборатория, Кухня, Основной)
CREATE TABLE IF NOT EXISTS warehouses (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,
  is_transit INTEGER NOT NULL DEFAULT 0 CHECK(is_transit IN (0, 1)),
  deleted_at TEXT
);

-- Позиции номенклатуры
CREATE TABLE IF NOT EXISTS items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT NOT NULL,
  unit             TEXT NOT NULL DEFAULT 'кг',
  warehouse_id     INTEGER NOT NULL REFERENCES warehouses(id),
  min_stock        REAL NOT NULL DEFAULT 0,
  current_stock    REAL NOT NULL DEFAULT 0,
  order_multiplier REAL NOT NULL DEFAULT 1.5,
  supplier         TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  deleted_at       TEXT,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Инвентаризации
CREATE TABLE IF NOT EXISTS inventories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  status       TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed')),
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at    TEXT,
  deleted_at   TEXT
);

-- Позиции инвентаризации
-- counted_qty = NULL означает «позиция ещё не подсчитана»
CREATE TABLE IF NOT EXISTS inventory_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id  INTEGER NOT NULL REFERENCES inventories(id),
  item_id       INTEGER NOT NULL REFERENCES items(id),
  counted_qty   REAL,                          -- NULL = не подсчитано
  previous_qty  REAL NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Заявки на заказ (генерируются из инвентаризации)
CREATE TABLE IF NOT EXISTS orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL REFERENCES inventories(id),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'confirmed', 'done')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at   TEXT
);

-- Позиции заявки на заказ
CREATE TABLE IF NOT EXISTS order_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id),
  item_id      INTEGER NOT NULL REFERENCES items(id),
  qty_to_order REAL NOT NULL DEFAULT 0,
  supplier     TEXT
);

-- Журнал изменений (audit log)
CREATE TABLE IF NOT EXISTS audit_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER REFERENCES users(id),
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  old_value TEXT, -- JSON
  new_value TEXT, -- JSON
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Индексы для производительности
CREATE INDEX IF NOT EXISTS idx_items_warehouse ON items(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventories_warehouse ON inventories(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_inventories_user ON inventories(user_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_inventory ON inventory_items(inventory_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
