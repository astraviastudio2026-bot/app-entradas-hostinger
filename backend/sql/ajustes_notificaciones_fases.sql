-- ============================================================
-- FLAGS FEST · Ajustes: cupos por fase + notificaciones internas
--
-- EJECUTAR EN: Hostinger / phpMyAdmin / consola MySQL, sobre la
-- base de datos existente (flagsfest). Todas las sentencias son
-- idempotentes: se pueden ejecutar más de una vez sin romper nada
-- y NO borran ni modifican datos existentes.
--
-- También queda incluido en backend/schema.sql, por lo que
-- `npm run migrate` aplica estos cambios automáticamente.
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- 1) Cupo máximo por fase de venta.
--    NULL = la fase no tiene cupo propio (solo aplica el total
--    del evento). El consumo se calcula desde `tickets`
--    (status IN ('sold','used')), nunca se duplica el dato.
--    (ALTER vía PREPARE porque MySQL 8 no soporta
--     ADD COLUMN IF NOT EXISTS)
-- ------------------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'sale_phases'
    AND COLUMN_NAME = 'max_tickets'
);
SET @ddl := IF(
  @col_exists = 0,
  'ALTER TABLE sale_phases ADD COLUMN max_tickets INT NULL AFTER price',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 2) Notificaciones internas del panel (admin/organizadores).
--    Hoy: aviso de nueva compra web. `is_read` es global.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  type         VARCHAR(40)  NOT NULL,                       -- 'web_purchase', …
  title        VARCHAR(160) NOT NULL,
  message      VARCHAR(500) NOT NULL,
  related_type VARCHAR(40)  NULL,                           -- 'purchase_request', …
  related_id   CHAR(36)     NULL,
  is_read      TINYINT(1)   NOT NULL DEFAULT 0,
  user_id      CHAR(36)     NULL,                           -- reservado: dirigida a un usuario
  role_target  VARCHAR(30)  NULL,                           -- reservado: dirigida a un rol
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_notif_read    (is_read),
  KEY idx_notif_created (created_at),
  KEY idx_notif_related (related_type, related_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
