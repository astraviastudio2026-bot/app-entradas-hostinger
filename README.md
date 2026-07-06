# FLAGS FEST · Sistema de venta de entradas

Sistema web completo para la venta y control de entradas del evento **FLAGS FEST**
(máximo 600 entradas), desarrollado por **ASTRAVIA STUDIO**.

- **Backend:** Node.js + Express + MySQL (puerto `3001`)
- **Frontend:** React + Vite (`VITE_API_URL=/api`)
- **Autenticación:** JWT + bcryptjs · **Correo:** Nodemailer · **PDF:** PDFKit · **QR:** qrcode + html5-qrcode

## Funcionalidades

| Rol | Puede |
| --- | --- |
| **Admin** | Dashboard global, crear/editar/activar vendedores y sus cupos, fases de venta, ver/anular/reenviar todas las entradas, reportes (color, fase, vendedor, ingresos), scanner QR e historial de escaneos |
| **Vendedor** | Ver su cupo/vendidas/restantes, vender entradas (nombre, correo, color), descargar PDF, envío automático por correo, ver solo sus ventas |

Cada entrada tiene código visible `FF-0001…`, QR con token aleatorio de 48 caracteres,
color (Verde *Soltero/a* · Rojo *No busco nada* · Amarillo *Depende*), fase y precio
aplicados automáticamente según la fecha, y PDF horizontal estilo neón que cambia según el color.

## Credenciales iniciales (seed)

- **admin@flagsfest.com** / **FlagsFest2026** — cámbiala tras el primer acceso.

## Desarrollo local

```bash
# Backend
cd backend
cp .env.example .env        # completa DB_* y (opcional) SMTP_*
npm install
mysql -u entradas_user -p entradas_app < schema.sql
npm run dev                 # http://localhost:3001

# Frontend
cd frontend
cp .env.example .env
npm install
npm run dev                 # http://localhost:5173 (proxy /api → 3001)
```

## Despliegue en VPS Hostinger (Ubuntu 24.04)

### 1. Base de datos (una sola vez)

```sql
CREATE DATABASE entradas_app CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'entradas_user'@'localhost' IDENTIFIED BY 'TU_PASSWORD_SEGURO';
GRANT ALL PRIVILEGES ON entradas_app.* TO 'entradas_user'@'localhost';
FLUSH PRIVILEGES;
```

### 2. Backend

```bash
cd /var/www/entradas-app/backend
cp .env.example .env && nano .env   # DB_PASSWORD, JWT_SECRET largo y aleatorio, SMTP_*
npm install
mysql -u entradas_user -p entradas_app < schema.sql
pm2 start server.js --name entradas-backend   # primera vez
pm2 restart entradas-backend                  # siguientes deploys
pm2 save
```

### 3. Frontend

```bash
cd /var/www/entradas-app/frontend
cp .env.example .env
npm install
npm run build
systemctl reload nginx
```

### 4. Nginx

Usa `deploy/nginx.conf.example` como referencia:
- `/` sirve el build estático de `frontend/dist`
- `/api` hace proxy a `http://localhost:3001`

### Verificación

```bash
curl http://localhost:3001/api/health   # {"ok":true,"db":"up",...}
```

## Notas

- El **schema.sql es idempotente**: puede re-ejecutarse sin borrar datos.
- Si SMTP está vacío, las ventas se registran igual y la app avisa que el correo no se envió;
  el PDF siempre se puede descargar y reenviar después.
- El símbolo de moneda se configura en `app_settings.currency_symbol` (por defecto `S/`).
- El límite global (600) está en `app_settings.total_tickets`.
- El scanner QR requiere **HTTPS** en producción para poder usar la cámara del celular
  (configura SSL con certbot en Nginx).
