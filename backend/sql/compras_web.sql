-- ============================================================
-- FLAGS FEST · Módulo de compras web (venta pública con
-- validación manual de pagos por transferencia)
--
-- EJECUTAR EN: Hostinger / phpMyAdmin / consola MySQL, sobre la
-- base de datos existente (flagsfest). Todas las sentencias son
-- idempotentes: se pueden ejecutar más de una vez sin romper nada.
--
-- También queda incluido en backend/schema.sql, por lo que
-- `npm run migrate` crea estas tablas automáticamente.
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- Solicitudes de compra web (NO son entradas: la entrada real
-- solo se crea en `tickets` cuando un admin/organizador aprueba)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_requests (
  id                     CHAR(36)      NOT NULL PRIMARY KEY,           -- UUID generado en Node
  request_code           VARCHAR(20)   NOT NULL,                       -- "FF-WEB-000001"
  event_id               CHAR(36)      NOT NULL,
  buyer_name             VARCHAR(120)  NOT NULL,
  buyer_email            VARCHAR(160)  NOT NULL,                       -- guardado en minúsculas
  buyer_phone            VARCHAR(30)   NOT NULL,
  buyer_document         VARCHAR(30)   NULL,                           -- cédula/documento (opcional)
  selected_color         ENUM('verde','rojo','amarillo') NOT NULL,     -- tipo/color de entrada
  sale_phase_id          CHAR(36)      NULL,                           -- fase vigente al solicitar
  phase_name             VARCHAR(80)   NULL,                           -- nombre congelado de la fase
  price                  DECIMAL(10,2) NOT NULL,                       -- precio congelado al solicitar
  payment_proof_path     VARCHAR(255)  NOT NULL,                       -- ruta en STORAGE_DIR (fuera del webroot)
  payment_proof_filename VARCHAR(160)  NOT NULL,                       -- nombre original del archivo
  payment_proof_mime     VARCHAR(60)   NOT NULL,
  payment_proof_hash     CHAR(64)      NOT NULL,                       -- SHA-256 del archivo (anti-duplicados)
  status                 ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  notes                  VARCHAR(500)  NULL,                           -- observación del comprador
  rejection_reason       VARCHAR(300)  NULL,
  approved_by            CHAR(36)      NULL,
  approved_at            DATETIME      NULL,
  rejected_by            CHAR(36)      NULL,
  rejected_at            DATETIME      NULL,
  ticket_id              CHAR(36)      NULL,                           -- entrada generada al aprobar (única)
  status_email_sent_at   DATETIME      NULL,                           -- correo "solicitud recibida"
  last_status_check_at   DATETIME      NULL,                           -- última consulta pública de estado
  created_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_preq_code   (request_code),
  UNIQUE KEY uq_preq_ticket (ticket_id),                               -- una solicitud ↔ una entrada (anti doble aprobación)
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
-- Configuración de pagos / datos de transferencia (una fila por
-- evento; la ve el público en /comprar)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_settings (
  id                   CHAR(36)     NOT NULL PRIMARY KEY,
  event_id             CHAR(36)     NOT NULL,
  bank_name            VARCHAR(120) NULL,
  account_type         VARCHAR(60)  NULL,                              -- "Ahorros", "Corriente"…
  account_number       VARCHAR(60)  NULL,
  account_holder       VARCHAR(120) NULL,
  account_document     VARCHAR(30)  NULL,                              -- cédula/RUC del titular
  transfer_note        VARCHAR(300) NULL,                              -- nota adicional para la transferencia
  qr_image_path        VARCHAR(255) NULL,                              -- imagen QR de pago (opcional), en STORAGE_DIR
  qr_image_mime        VARCHAR(60)  NULL,
  public_sales_enabled TINYINT(1)   NOT NULL DEFAULT 0,                -- activa/desactiva la venta pública
  buyer_message        VARCHAR(500) NULL,                              -- mensaje personalizado para compradores
  created_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payset_event (event_id),
  CONSTRAINT fk_payset_event FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Contador global del código de solicitud web (FF-WEB-000001, …)
-- (`last_value` es palabra reservada en MySQL 8, por eso va escapada)
CREATE TABLE IF NOT EXISTS web_request_counter (
  id           TINYINT NOT NULL PRIMARY KEY,   -- siempre fila 1
  `last_value` INT     NOT NULL DEFAULT 0
) ENGINE=InnoDB;
INSERT INTO web_request_counter (id, `last_value`)
SELECT 1, 0
WHERE NOT EXISTS (SELECT 1 FROM web_request_counter WHERE id = 1);
