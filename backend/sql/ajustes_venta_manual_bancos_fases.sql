-- ============================================================
-- FLAGS FEST · Ajustes: cédula/celular en venta manual,
-- múltiples bancos (payment_methods) con snapshot en las
-- solicitudes web, y contabilidad por cuenta.
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
-- Helper de columnas: MySQL 8 no soporta ADD COLUMN IF NOT
-- EXISTS, así que cada ALTER va vía PREPARE condicionado a
-- information_schema.
-- ------------------------------------------------------------

-- 1) tickets.customer_document (cédula del cliente, venta manual)
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'customer_document');
SET @ddl := IF(@c = 0,
  'ALTER TABLE tickets ADD COLUMN customer_document VARCHAR(30) NULL AFTER customer_email', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- 2) tickets.customer_phone (celular/WhatsApp del cliente)
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tickets' AND COLUMN_NAME = 'customer_phone');
SET @ddl := IF(@c = 0,
  'ALTER TABLE tickets ADD COLUMN customer_phone VARCHAR(30) NULL AFTER customer_document', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ------------------------------------------------------------
-- 3) Métodos de pago por transferencia (varios bancos, cada uno
--    con su propio QR). El público elige a cuál transfirió.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_methods (
  id               CHAR(36)     NOT NULL PRIMARY KEY,
  event_id         CHAR(36)     NOT NULL,
  bank_name        VARCHAR(120) NOT NULL,
  account_type     VARCHAR(60)  NULL,
  account_number   VARCHAR(60)  NOT NULL,
  account_holder   VARCHAR(120) NOT NULL,
  account_document VARCHAR(30)  NULL,
  transfer_note    VARCHAR(300) NULL,
  qr_image_path    VARCHAR(255) NULL,
  qr_image_mime    VARCHAR(60)  NULL,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order       INT          NOT NULL DEFAULT 1,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_paymethods_event (event_id, is_active, sort_order),
  CONSTRAINT fk_paymethods_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 4) Snapshot del método de pago en las solicitudes web
--    (si luego se edita/borra la cuenta, la solicitud aprobada
--     conserva la trazabilidad del banco usado en su momento)
-- ------------------------------------------------------------
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_requests' AND COLUMN_NAME = 'payment_method_id');
SET @ddl := IF(@c = 0,
  'ALTER TABLE purchase_requests ADD COLUMN payment_method_id CHAR(36) NULL AFTER price', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_requests' AND COLUMN_NAME = 'payment_method_label');
SET @ddl := IF(@c = 0,
  'ALTER TABLE purchase_requests ADD COLUMN payment_method_label VARCHAR(160) NULL AFTER payment_method_id', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_requests' AND COLUMN_NAME = 'bank_name');
SET @ddl := IF(@c = 0,
  'ALTER TABLE purchase_requests ADD COLUMN bank_name VARCHAR(120) NULL AFTER payment_method_label', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_requests' AND COLUMN_NAME = 'account_number_snapshot');
SET @ddl := IF(@c = 0,
  'ALTER TABLE purchase_requests ADD COLUMN account_number_snapshot VARCHAR(60) NULL AFTER bank_name', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_requests' AND COLUMN_NAME = 'account_holder_snapshot');
SET @ddl := IF(@c = 0,
  'ALTER TABLE purchase_requests ADD COLUMN account_holder_snapshot VARCHAR(120) NULL AFTER account_number_snapshot', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Índice para filtros/contabilidad por método
SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_requests' AND INDEX_NAME = 'idx_preq_paymethod');
SET @ddl := IF(@c = 0,
  'ALTER TABLE purchase_requests ADD KEY idx_preq_paymethod (payment_method_id)', 'SELECT 1');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ------------------------------------------------------------
-- 5) Migrar el banco único ya configurado en payment_settings al
--    primer método de payment_methods (una sola vez: solo si ese
--    evento aún no tiene métodos y tenía datos bancarios).
--    Los campos bancarios de payment_settings quedan LEGACY (no
--    se borran); el switch general y el mensaje siguen ahí.
-- ------------------------------------------------------------
INSERT INTO payment_methods
  (id, event_id, bank_name, account_type, account_number, account_holder,
   account_document, transfer_note, qr_image_path, qr_image_mime, is_active, sort_order)
SELECT UUID(), s.event_id, s.bank_name, s.account_type, s.account_number, s.account_holder,
       s.account_document, s.transfer_note, s.qr_image_path, s.qr_image_mime, 1, 1
FROM payment_settings s
WHERE s.bank_name IS NOT NULL
  AND s.account_number IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM payment_methods m WHERE m.event_id = s.event_id);
