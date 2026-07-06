-- ============================================================
-- FLAGS FEST - Esquema de base de datos (MySQL 8+)
-- Sistema de venta de entradas
--
-- Uso:
--   mysql -u entradas_user -p entradas_app < schema.sql
--
-- El script es idempotente: usa CREATE TABLE IF NOT EXISTS y
-- seeds con INSERT ... ON DUPLICATE KEY / WHERE NOT EXISTS,
-- por lo que puede re-ejecutarse sin destruir datos.
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- Usuarios (administradores y vendedores)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  name          VARCHAR(120)     NOT NULL,
  email         VARCHAR(190)     NOT NULL,
  password_hash VARCHAR(100)     NOT NULL,
  role          ENUM('admin','seller') NOT NULL DEFAULT 'seller',
  quota         INT UNSIGNED     NOT NULL DEFAULT 0 COMMENT 'Cupo de entradas asignado (solo vendedores)',
  is_active     TINYINT(1)       NOT NULL DEFAULT 1,
  created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email),
  KEY idx_users_role (role),
  KEY idx_users_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Fases de venta (preventas, dia del evento, etc.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_phases (
  id         INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  name       VARCHAR(120)   NOT NULL,
  price      DECIMAL(10,2)  NOT NULL,
  start_date DATETIME       NOT NULL,
  end_date   DATETIME       NOT NULL,
  is_active  TINYINT(1)     NOT NULL DEFAULT 1,
  created_at DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_phases_name (name),
  KEY idx_phases_active_dates (is_active, start_date, end_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Entradas
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id             INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  code           VARCHAR(20)    NOT NULL COMMENT 'Codigo visible tipo FF-0001',
  qr_token       CHAR(48)       NOT NULL COMMENT 'Token aleatorio del QR',
  buyer_name     VARCHAR(150)   NOT NULL,
  buyer_email    VARCHAR(190)   NOT NULL,
  selected_color ENUM('verde','rojo','amarillo') NOT NULL,
  price          DECIMAL(10,2)  NOT NULL COMMENT 'Precio aplicado al momento de la venta',
  phase_id       INT UNSIGNED   NOT NULL,
  seller_id      INT UNSIGNED   NOT NULL,
  status         ENUM('sold','used','cancelled') NOT NULL DEFAULT 'sold',
  email_sent_at  DATETIME       NULL,
  sold_at        DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  used_at        DATETIME       NULL,
  cancelled_at   DATETIME       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tickets_code (code),
  UNIQUE KEY uq_tickets_qr_token (qr_token),
  KEY idx_tickets_status (status),
  KEY idx_tickets_seller (seller_id, status),
  KEY idx_tickets_phase (phase_id),
  KEY idx_tickets_color (selected_color),
  KEY idx_tickets_sold_at (sold_at),
  CONSTRAINT fk_tickets_phase  FOREIGN KEY (phase_id)  REFERENCES sale_phases (id),
  CONSTRAINT fk_tickets_seller FOREIGN KEY (seller_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Historial de escaneos de QR
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ticket_scans (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  ticket_id  INT UNSIGNED  NULL COMMENT 'NULL si el token escaneado no existe',
  scanned_by INT UNSIGNED  NULL,
  qr_token   CHAR(48)      NOT NULL,
  result     ENUM('valid','already_used','cancelled','invalid') NOT NULL,
  scanned_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_scans_ticket (ticket_id),
  KEY idx_scans_scanned_at (scanned_at),
  CONSTRAINT fk_scans_ticket FOREIGN KEY (ticket_id)  REFERENCES tickets (id) ON DELETE SET NULL,
  CONSTRAINT fk_scans_user   FOREIGN KEY (scanned_by) REFERENCES users (id)  ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- Configuracion de la aplicacion (clave/valor)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   VARCHAR(60)  NOT NULL,
  setting_value VARCHAR(255) NOT NULL,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- SEEDS
-- ============================================================

-- Limite global de entradas del evento
INSERT INTO app_settings (setting_key, setting_value)
VALUES ('total_tickets', '600')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('event_name', 'FLAGS FEST')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- Simbolo de moneda usado en PDF, correos y reportes
INSERT INTO app_settings (setting_key, setting_value)
VALUES ('currency_symbol', 'S/')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- Usuario administrador inicial
--   email:    admin@flagsfest.com
--   password: FlagsFest2026
-- (cambia la contrasena despues del primer inicio de sesion)
INSERT INTO users (name, email, password_hash, role, quota, is_active)
SELECT 'Administrador', 'admin@flagsfest.com',
       '$2a$10$FPyT1JC/nZFLtqK/CvYsBeMr9XnzxSAIDYBGDXbes1r9j4Uacjaa2',
       'admin', 0, 1
WHERE NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');

-- Fases de venta base (editables desde el panel)
INSERT INTO sale_phases (name, price, start_date, end_date, is_active)
SELECT 'Primera preventa', 25.00, '2026-07-01 00:00:00', '2026-07-15 23:59:59', 1
WHERE NOT EXISTS (SELECT 1 FROM sale_phases WHERE name = 'Primera preventa');

INSERT INTO sale_phases (name, price, start_date, end_date, is_active)
SELECT 'Segunda preventa', 35.00, '2026-07-16 00:00:00', '2026-07-29 23:59:59', 1
WHERE NOT EXISTS (SELECT 1 FROM sale_phases WHERE name = 'Segunda preventa');

INSERT INTO sale_phases (name, price, start_date, end_date, is_active)
SELECT 'Dia del evento', 45.00, '2026-07-30 00:00:00', '2026-07-30 23:59:59', 1
WHERE NOT EXISTS (SELECT 1 FROM sale_phases WHERE name = 'Dia del evento');
