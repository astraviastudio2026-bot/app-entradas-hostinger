-- ============================================================
-- FLAGS FEST - Esquema de base de datos (MySQL 8+)
-- Sistema de venta y validación de entradas con QR
--
-- Uso recomendado:
--   npm run migrate   (backend/scripts/migrate.js)
-- El script detecta instalaciones legacy (ids INT) y migra los
-- datos. Este SQL también puede ejecutarse directo en una BD
-- vacía: todas las sentencias son idempotentes.
--
-- Todas las fechas se guardan en UTC (DATETIME); la conversión a
-- hora de Ecuador (America/Guayaquil, UTC-5) se hace al mostrar.
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- Usuarios internos (admin, vendedores, control de acceso)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL PRIMARY KEY,          -- UUID generado en Node
  full_name     VARCHAR(120) NOT NULL,
  username      VARCHAR(60)  NOT NULL,                      -- usuario interno de login, minúsculas
  email         VARCHAR(160) NULL,                          -- opcional/informativo
  password_hash VARCHAR(100) NOT NULL,                      -- bcrypt (cost 10-12)
  role          ENUM('admin','seller','validator') NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_username (username),
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Eventos (solo uno activo a la vez; lo garantiza el backend)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
  id            CHAR(36)     NOT NULL PRIMARY KEY,
  name          VARCHAR(160) NOT NULL,
  location      VARCHAR(160) NULL,
  event_date    DATE         NOT NULL,
  total_tickets INT          NOT NULL DEFAULT 600,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Fases de precio de un evento
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_phases (
  id          CHAR(36)      NOT NULL PRIMARY KEY,
  event_id    CHAR(36)      NOT NULL,
  name        VARCHAR(80)   NOT NULL,                       -- "Preventa", "Fase 1", "En puerta"…
  phase_order INT           NOT NULL,
  starts_at   DATETIME      NOT NULL,                       -- inicio del día en Ecuador convertido a UTC
  ends_at     DATETIME      NOT NULL,                       -- fin del día (23:59:59 EC) en UTC
  price       DECIMAL(10,2) NOT NULL,
  max_tickets INT           NULL,                           -- cupo máximo de la fase (NULL = sin cupo propio)
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_phases_event (event_id),
  CONSTRAINT fk_phases_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Cupo de entradas por vendedor y evento
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS seller_allocations (
  id                 CHAR(36) NOT NULL PRIMARY KEY,
  event_id           CHAR(36) NOT NULL,
  seller_id          CHAR(36) NOT NULL,
  allocated_quantity INT      NOT NULL,                     -- >= 0, validado en backend
  created_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_alloc_event_seller (event_id, seller_id),
  KEY idx_alloc_seller (seller_id),
  CONSTRAINT fk_alloc_event  FOREIGN KEY (event_id)  REFERENCES events(id) ON DELETE CASCADE,
  CONSTRAINT fk_alloc_seller FOREIGN KEY (seller_id) REFERENCES users(id)  ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Entradas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id                  CHAR(36)      NOT NULL PRIMARY KEY,
  event_id            CHAR(36)      NOT NULL,
  seller_id           CHAR(36)      NOT NULL,
  sale_phase_id       CHAR(36)      NULL,
  ticket_number       INT           NOT NULL,               -- correlativo POR EVENTO (0001, 0002…)
  short_code          VARCHAR(12)   NOT NULL,               -- global legible: "FF-0001"
  qr_token            VARCHAR(64)   NOT NULL,               -- 32 bytes aleatorios en hex (64 chars; legacy 48)
  qr_hash             CHAR(64)      NOT NULL,               -- SHA-256(token + "." + QR_SECRET)
  customer_name       VARCHAR(120)  NOT NULL,
  customer_email      VARCHAR(160)  NOT NULL,
  selected_color      ENUM('verde','rojo','amarillo') NOT NULL,
  price               DECIMAL(10,2) NOT NULL,               -- congelado al precio de la fase al vender
  status              ENUM('sold','used','cancelled') NOT NULL DEFAULT 'sold',
  notes               VARCHAR(500)  NULL,
  pdf_path            VARCHAR(255)  NULL,                   -- ruta del PDF en disco
  email_sent_at       DATETIME      NULL,
  email_last_error    TEXT          NULL,
  sold_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at             DATETIME      NULL,
  validated_by        CHAR(36)      NULL,
  cancelled_at        DATETIME      NULL,
  cancelled_by        CHAR(36)      NULL,
  cancellation_reason VARCHAR(300)  NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tickets_event_number (event_id, ticket_number),
  UNIQUE KEY uq_tickets_short_code   (short_code),
  UNIQUE KEY uq_tickets_qr_token     (qr_token),
  UNIQUE KEY uq_tickets_qr_hash      (qr_hash),
  KEY idx_tickets_event   (event_id),
  KEY idx_tickets_seller  (seller_id),
  KEY idx_tickets_status  (status),
  KEY idx_tickets_email   (customer_email),
  CONSTRAINT fk_tickets_event     FOREIGN KEY (event_id)      REFERENCES events(id)      ON DELETE CASCADE,
  CONSTRAINT fk_tickets_seller    FOREIGN KEY (seller_id)     REFERENCES users(id),
  CONSTRAINT fk_tickets_phase     FOREIGN KEY (sale_phase_id) REFERENCES sale_phases(id) ON DELETE SET NULL,
  CONSTRAINT fk_tickets_validator FOREIGN KEY (validated_by)  REFERENCES users(id)       ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contador global para el short_code (FF-0001, FF-0002, …)
-- (`last_value` es palabra reservada en MySQL 8, por eso va escapada)
CREATE TABLE IF NOT EXISTS short_code_counter (
  id           TINYINT NOT NULL PRIMARY KEY,   -- siempre fila 1
  `last_value` INT     NOT NULL DEFAULT 0
) ENGINE=InnoDB;
INSERT INTO short_code_counter (id, `last_value`)
SELECT 1, 0
WHERE NOT EXISTS (SELECT 1 FROM short_code_counter WHERE id = 1);

-- ------------------------------------------------------------
-- Historial de intentos de validación (se registra TODO intento)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_validations (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  ticket_id    CHAR(36)     NULL,                           -- NULL si el QR era ilegible/desconocido
  validator_id CHAR(36)     NULL,
  result       ENUM('valid','already_used','cancelled','invalid') NOT NULL,
  message      VARCHAR(200) NOT NULL,
  metadata     JSON         NULL,                           -- { source: 'scanner'|'manual'|'link', … }
  scanned_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_validations_ticket  (ticket_id),
  KEY idx_validations_scanned (scanned_at),
  CONSTRAINT fk_val_ticket    FOREIGN KEY (ticket_id)    REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_val_validator FOREIGN KEY (validator_id) REFERENCES users(id)   ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Compras web: solicitudes de compra pública (NO son entradas;
-- la entrada real solo se crea en `tickets` al aprobar el pago)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_requests (
  id                     CHAR(36)      NOT NULL PRIMARY KEY,
  request_code           VARCHAR(20)   NOT NULL,                       -- "FF-WEB-000001"
  event_id               CHAR(36)      NOT NULL,
  buyer_name             VARCHAR(120)  NOT NULL,
  buyer_email            VARCHAR(160)  NOT NULL,
  buyer_phone            VARCHAR(30)   NOT NULL,
  buyer_document         VARCHAR(30)   NULL,
  selected_color         ENUM('verde','rojo','amarillo') NOT NULL,
  sale_phase_id          CHAR(36)      NULL,
  phase_name             VARCHAR(80)   NULL,
  price                  DECIMAL(10,2) NOT NULL,                       -- precio congelado al solicitar
  payment_proof_path     VARCHAR(255)  NOT NULL,
  payment_proof_filename VARCHAR(160)  NOT NULL,
  payment_proof_mime     VARCHAR(60)   NOT NULL,
  payment_proof_hash     CHAR(64)      NOT NULL,                       -- SHA-256 del archivo (anti-duplicados)
  status                 ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  notes                  VARCHAR(500)  NULL,
  rejection_reason       VARCHAR(300)  NULL,
  approved_by            CHAR(36)      NULL,
  approved_at            DATETIME      NULL,
  rejected_by            CHAR(36)      NULL,
  rejected_at            DATETIME      NULL,
  ticket_id              CHAR(36)      NULL,
  status_email_sent_at   DATETIME      NULL,
  last_status_check_at   DATETIME      NULL,
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_preq_code   (request_code),
  UNIQUE KEY uq_preq_ticket (ticket_id),
  KEY idx_preq_event  (event_id),
  KEY idx_preq_status (status),
  KEY idx_preq_email  (buyer_email),
  KEY idx_preq_hash   (payment_proof_hash),
  KEY idx_preq_created (created_at),
  CONSTRAINT fk_preq_event    FOREIGN KEY (event_id)      REFERENCES events(id)      ON DELETE CASCADE,
  CONSTRAINT fk_preq_phase    FOREIGN KEY (sale_phase_id) REFERENCES sale_phases(id) ON DELETE SET NULL,
  CONSTRAINT fk_preq_ticket   FOREIGN KEY (ticket_id)     REFERENCES tickets(id)     ON DELETE SET NULL,
  CONSTRAINT fk_preq_approver FOREIGN KEY (approved_by)   REFERENCES users(id)       ON DELETE SET NULL,
  CONSTRAINT fk_preq_rejecter FOREIGN KEY (rejected_by)   REFERENCES users(id)       ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Configuración de pagos / datos de transferencia por evento
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_settings (
  id                   CHAR(36)     NOT NULL PRIMARY KEY,
  event_id             CHAR(36)     NOT NULL,
  bank_name            VARCHAR(120) NULL,
  account_type         VARCHAR(60)  NULL,
  account_number       VARCHAR(60)  NULL,
  account_holder       VARCHAR(120) NULL,
  account_document     VARCHAR(30)  NULL,
  transfer_note        VARCHAR(300) NULL,
  qr_image_path        VARCHAR(255) NULL,
  qr_image_mime        VARCHAR(60)  NULL,
  public_sales_enabled TINYINT(1)   NOT NULL DEFAULT 0,
  buyer_message        VARCHAR(500) NULL,
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payset_event (event_id),
  CONSTRAINT fk_payset_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contador global del código de solicitud web (FF-WEB-000001, …)
CREATE TABLE IF NOT EXISTS web_request_counter (
  id           TINYINT NOT NULL PRIMARY KEY,   -- siempre fila 1
  `last_value` INT     NOT NULL DEFAULT 0
) ENGINE=InnoDB;
INSERT INTO web_request_counter (id, `last_value`)
SELECT 1, 0
WHERE NOT EXISTS (SELECT 1 FROM web_request_counter WHERE id = 1);

-- ------------------------------------------------------------
-- Notificaciones internas del panel (admin/organizadores).
-- Hoy se usan para avisar de nuevas compras web; el diseño admite
-- otros tipos futuros. `is_read` es global (panel compartido).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id           CHAR(36)     NOT NULL PRIMARY KEY,
  type         VARCHAR(40)  NOT NULL,                       -- 'web_purchase', …
  title        VARCHAR(160) NOT NULL,
  message      VARCHAR(500) NOT NULL,
  related_type VARCHAR(40)  NULL,                           -- 'purchase_request', …
  related_id   CHAR(36)     NULL,
  is_read      TINYINT(1)   NOT NULL DEFAULT 0,
  user_id      CHAR(36)     NULL,                           -- reservado: notificación dirigida a un usuario
  role_target  VARCHAR(30)  NULL,                           -- reservado: dirigida a un rol
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_notif_read    (is_read),
  KEY idx_notif_created (created_at),
  KEY idx_notif_related (related_type, related_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Auditoría de acciones
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          CHAR(36)    NOT NULL PRIMARY KEY,
  actor_id    CHAR(36)    NULL,
  action      VARCHAR(60) NOT NULL,     -- 'ticket.create','ticket.resend_email','user.create',…
  entity_type VARCHAR(40) NOT NULL,
  entity_id   CHAR(36)    NULL,
  metadata    JSON        NULL,
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_actor (actor_id),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
