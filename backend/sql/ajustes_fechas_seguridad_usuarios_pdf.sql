-- ============================================================
-- FLAGS FEST · Ajustes: seguridad de usuarios internos
--   (correo vinculado + verificación + recuperación de contraseña
--    + bloqueo por intentos fallidos + último acceso)
--
-- EJECUTAR EN: Hostinger / phpMyAdmin / consola MySQL, sobre la
-- base de datos existente (flagsfest). Todas las sentencias son
-- idempotentes: se pueden ejecutar más de una vez sin romper nada
-- y NO borran ni modifican datos existentes (usuarios, tickets,
-- compras y configuraciones quedan intactos).
--
-- También queda incluido en backend/schema.sql, por lo que
-- `npm run migrate` aplica estos cambios automáticamente.
--
-- NOTA SOBRE FECHAS: la corrección del bug de fechas (30/07/2026
-- mostrado como 29/07/2026) NO requiere cambios de base de datos:
-- events.event_date ya es una columna DATE. El arreglo vive en el
-- código (driver + helpers de formato).
--
-- NOTA SOBRE TOKENS: email_verification_token y
-- password_reset_token guardan el SHA-256 (hex) del token enviado
-- por correo, NUNCA el token en claro.
-- ============================================================

SET NAMES utf8mb4;

-- ------------------------------------------------------------
-- Procedimiento auxiliar: agrega una columna a `users` solo si
-- no existe (MySQL 8 no soporta ADD COLUMN IF NOT EXISTS).
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS ff_add_users_column;
DELIMITER $$
CREATE PROCEDURE ff_add_users_column(IN col_name VARCHAR(64), IN col_def VARCHAR(255))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'users'
      AND COLUMN_NAME = col_name
  ) THEN
    SET @ddl = CONCAT('ALTER TABLE users ADD COLUMN ', col_name, ' ', col_def);
    PREPARE stmt FROM @ddl;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

-- ------------------------------------------------------------
-- 1) Columnas de seguridad en `users`
-- ------------------------------------------------------------
CALL ff_add_users_column('email_verified_at',             'DATETIME NULL AFTER is_active');
CALL ff_add_users_column('email_verification_token',      'CHAR(64) NULL AFTER email_verified_at');
CALL ff_add_users_column('email_verification_expires_at', 'DATETIME NULL AFTER email_verification_token');
CALL ff_add_users_column('password_reset_token',          'CHAR(64) NULL AFTER email_verification_expires_at');
CALL ff_add_users_column('password_reset_expires_at',     'DATETIME NULL AFTER password_reset_token');
CALL ff_add_users_column('last_login_at',                 'DATETIME NULL AFTER password_reset_expires_at');
CALL ff_add_users_column('last_login_ip',                 'VARCHAR(45) NULL AFTER last_login_at');
CALL ff_add_users_column('failed_login_attempts',         'INT NOT NULL DEFAULT 0 AFTER last_login_ip');
CALL ff_add_users_column('locked_until',                  'DATETIME NULL AFTER failed_login_attempts');

DROP PROCEDURE IF EXISTS ff_add_users_column;

-- ------------------------------------------------------------
-- 2) Índice para el login por correo (solo si no existe)
-- ------------------------------------------------------------
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND INDEX_NAME = 'idx_users_email'
);
SET @ddl := IF(
  @idx_exists = 0,
  'ALTER TABLE users ADD INDEX idx_users_email (email)',
  'SELECT 1'
);
PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ------------------------------------------------------------
-- 3) audit_logs ya existe en este esquema (se reutiliza para las
--    nuevas acciones: user.update_email, user.reset_password,
--    user.verify_email, auth.password_reset, auth.lockout…).
--    Se crea solo si faltara (instalaciones muy antiguas).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          CHAR(36)    NOT NULL PRIMARY KEY,
  actor_id    CHAR(36)    NULL,
  action      VARCHAR(60) NOT NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id   CHAR(36)    NULL,
  metadata    JSON        NULL,
  created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_actor (actor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
