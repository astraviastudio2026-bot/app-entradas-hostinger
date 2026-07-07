# FLAGS FEST · Sistema de venta y validación de entradas

Sistema web interno para la venta y control de acceso del evento **FLAGS FEST**
("Green Flags & Red Flags Party"), desarrollado por **ASTRAVIA STUDIO**.

- **Backend:** Node.js + Express + MySQL (`mysql2/promise`, puerto `3001`)
- **Frontend:** React + Vite (`VITE_API_URL=/api`)
- **Auth:** JWT en cookie httpOnly + bcrypt · **Correo:** Resend por SMTP (Nodemailer) · **PDF:** PDFKit · **QR:** qrcode + html5-qrcode
- **Zona horaria del negocio:** Ecuador (America/Guayaquil, UTC-5). La BD guarda todo en UTC.
- **Producción:** https://flagsfest.astraviastudio.cloud

## Roles

| Rol | Puede |
| --- | --- |
| **admin** | Configurar evento, fases de precio, cupos por vendedor y usuarios; ver todas las entradas, métricas y validaciones; vender y validar |
| **seller** (vendedor) | Vender dentro de su cupo; ver/descargar/reenviar SOLO sus entradas |
| **validator** (control de acceso) | Usar el escáner QR en la puerta y validar entradas (también por código manual) |

Los usuarios son internos: inician sesión con **usuario** (p. ej. `vendedor1`) y contraseña.
No hay registro público.

## Seguridad del QR

- Cada entrada tiene un token aleatorio de 32 bytes; el QR contiene solo la URL
  `APP_URL/ticket/validate/<token>` (sin datos personales).
- La BD guarda el token y su `SHA-256(token + "." + QR_SECRET)`; la validación busca por hash,
  así un QR falsificado sin el secreto nunca valida.
- Abrir el enlace del QR **jamás valida la entrada**: solo el personal autorizado
  (admin/validator, con sesión) puede validarla, y todo intento queda registrado en
  `ticket_validations`.
- Venta y validación usan transacciones con `FOR UPDATE`: sin sobreventa y sin doble ingreso
  con escaneos simultáneos.

## Desarrollo local

```bash
# Backend
cd backend
cp .env.example .env        # DB_*, JWT_SECRET, QR_SECRET, STORAGE_DIR, (opcional) SMTP_*
npm install
npm run migrate             # crea el esquema (y migra datos de la versión anterior si los hay)
npm run seed                # admin + evento FLAGS FEST (30/07/2026) con fases $8/$12/$15/$20
npm run dev                 # http://localhost:3001

# Frontend
cd frontend
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173 (proxy /api → 3001)
```

Seed: crea el usuario **admin** con la contraseña de `ADMIN_SEED_PASSWORD` (o una aleatoria
impresa por consola) y, si no existe, el evento "FLAGS FEST" (Paradox Club, 30/07/2026,
600 entradas) con las fases Preventa $8, Fase 1 $12, Fase 2 $15 y En puerta $20.

### Flujo de prueba completo

1. Login `admin` → **Evento**: verifica evento y fases (una vigente hoy).
2. **Usuarios**: crea un vendedor (`vendedor1`) y un validador (`puerta1`); asigna cupo al vendedor.
3. Login `vendedor1` → **Vender**: registra una venta → descarga el PDF → reenvía el correo.
4. Login `puerta1` → **Scanner**: escanea el QR (válida) → re-escanea (ya usada) → prueba un
   código manual (`FF-0001`) y un token inventado (inválido).
5. Login `admin` → **Inicio**: revisa métricas, cupos y últimas validaciones.

## Compras web (venta pública con validación manual de pagos)

- **/comprar** (público, sin login): landing del evento con fase/precio/disponibilidad,
  datos de transferencia configurados por el admin y formulario con subida de comprobante
  (JPG/PNG/WEBP/PDF, máx. 5 MB). Al enviar se crea una **solicitud pendiente**
  (`purchase_requests`, código `FF-WEB-000001`) y se envía un correo de confirmación
  **sin entrada**. NUNCA se genera QR/PDF en este paso.
- **/estado-compra** (público): consulta por **código + correo** (ambos obligatorios) y
  opción "Olvidé mi código" (envía los códigos al correo, nunca los muestra en pantalla).
- **Compras web** (dashboard, admin y seller): resumen, filtros, comprobante, detalle,
  **Aprobar** (transacción con `FOR UPDATE`: revalida pendiente + disponibilidad, crea la
  entrada real con el mismo QR/PDF/correo de una venta manual — compatible con el escáner)
  y **Rechazar** con motivo (correo automático al comprador).
- **Evento → Venta web** (admin): datos bancarios públicos, mensaje al comprador, imagen QR
  de pago opcional y switch para activar/desactivar la venta pública.
- Anti-duplicados: hash SHA-256 del comprobante (`payment_proof_hash`) + misma
  combinación correo/evento/color/precio pendiente. Anti doble aprobación: lock de fila +
  `ticket_id` UNIQUE.
- Los comprobantes viven en `STORAGE_DIR/proofs/` (fuera del webroot) y solo se sirven por
  el endpoint autenticado `GET /api/purchases/:id/proof`.

## Endpoints principales

```
Auth        POST /api/auth/login · POST /api/auth/logout · GET /api/auth/me
Admin       GET/POST /api/admin/users · POST /api/admin/users/:id/toggle
            GET/POST /api/admin/events (un solo evento activo)
            GET/POST /api/admin/phases (fechas AAAA-MM-DD en día de Ecuador)
            GET/POST /api/admin/allocations · GET /api/admin/dashboard
            GET/POST /api/admin/payment-settings (venta web / transferencia)
Tickets     POST /api/tickets (venta) · GET /api/tickets · GET /api/tickets/:id
            GET /api/tickets/:id/pdf · POST /api/tickets/:id/resend · POST /api/tickets/:id/cancel
Validación  POST /api/tickets/validate · POST /api/tickets/validate-code
            GET /api/tickets/validations
Compras web GET /api/purchases (filtros+resumen) · GET /api/purchases/:id
            GET /api/purchases/:id/proof · POST /api/purchases/:id/approve
            POST /api/purchases/:id/reject   (roles: admin, seller)
Público     GET /api/public/event · GET /api/public/payment-qr
            POST /api/public/purchase (multipart, rate-limited)
            POST /api/public/purchase-status · POST /api/public/recover-code
Contexto    GET /api/dashboard (evento/fase/cupo según rol) · GET /api/health
SPA pública /comprar · /estado-compra · /ticket/validate/:token (nunca valida sola)
```

## Despliegue en VPS Hostinger (Ubuntu 24.04)

### 1. Base de datos (una sola vez)

```sql
CREATE DATABASE flagsfest CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'flagsfest'@'localhost' IDENTIFIED BY 'TU_PASSWORD_SEGURO';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP ON flagsfest.* TO 'flagsfest'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Backend

```bash
cd /var/www/flagsfest/app/backend
cp .env.example .env && nano .env   # DB_*, JWT_SECRET y QR_SECRET (openssl rand -hex 32), SMTP_PASS
mkdir -p /var/www/flagsfest/storage # STORAGE_DIR fuera del webroot
npm install
npm run migrate   # si la BD tiene la versión anterior, migra los datos y deja legacy_*
npm run seed
pm2 start server.js --name entradas-backend   # primera vez
pm2 save && pm2 startup
```

> **Migración desde la versión anterior de esta app:** `npm run migrate` detecta el esquema
> antiguo (login por email), renombra las tablas a `legacy_*` y copia usuarios (login pasa a
> ser la parte local del correo, misma contraseña), fases, cupos y entradas (mismos QR).
> Verifica y luego elimina las tablas `legacy_*`.

### 3. Frontend

```bash
cd /var/www/flagsfest/app/frontend
cp .env.example .env
npm install && npm run build
systemctl reload nginx
```

### 4. Nginx + SSL

Usa `deploy/nginx.conf.example`. HTTPS es obligatorio (la cámara del scanner lo exige):
`certbot --nginx -d flagsfest.astraviastudio.cloud`.

### 5. Correo (Resend)

Verifica el dominio `mail.flagsfest.astraviastudio.cloud` en Resend (SPF/DKIM) y coloca la
API key en `SMTP_PASS`. Asunto del correo: "Tu entrada para Flag Fest", con el PDF adjunto.

## Notas

- Si SMTP está vacío, las ventas se registran igual; el error queda en `email_last_error`
  y la entrada se puede reenviar después. El PDF siempre se puede descargar (se regenera
  bajo demanda si no está en disco).
- Los PDFs viven en `STORAGE_DIR` (fuera del webroot) y solo se sirven por el endpoint
  autenticado. Inclúyelo en los backups junto con un dump diario de MySQL.
- Rate limit en login (10 intentos / 15 min por IP), helmet, CORS restringido al dominio
  propio y desactivación de usuarios con expulsión inmediata de la sesión.
