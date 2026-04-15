import { getDb } from '../db/connection';

/**
 * Записывает действие в audit_log.
 * Вызывать после каждого изменения данных.
 *
 * @param userId   - id пользователя (null = системное действие)
 * @param action   - глагол: 'create' | 'update' | 'delete' | 'login' и т.п.
 * @param entity   - имя таблицы: 'users', 'items', 'inventories' и т.п.
 * @param entityId - id изменённой записи
 * @param oldValue - состояние до изменения (или null)
 * @param newValue - состояние после изменения (или null)
 */
export function logAction(
  userId: number | null,
  action: string,
  entity: string,
  entityId: number,
  oldValue: object | null = null,
  newValue: object | null = null
): void {
  const db = getDb();

  db.prepare(`
    INSERT INTO audit_log (user_id, action, entity, entity_id, old_value, new_value)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    action,
    entity,
    entityId,
    oldValue !== null ? JSON.stringify(oldValue) : null,
    newValue !== null ? JSON.stringify(newValue) : null
  );
}
