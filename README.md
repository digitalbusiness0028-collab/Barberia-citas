# JRbarber — Reservas online (gratis)

Proyecto listo para desplegar en Render.com (gratuito), con:
- Formulario de reservas
- Confirmación por email con botón
- Panel admin con métricas
- Diseño negro & dorado

## 1) Configuración local
```bash
npm install
cp .env.example .env
# Edita .env con tus datos SMTP y claves
npm start
```
Abre: http://localhost:3000

## 2) Variables de entorno necesarias
- `ADMIN_PASSWORD`: contraseña para entrar al panel admin
- `JWT_SECRET`: una cadena secreta para el token
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`: credenciales SMTP (Gmail con App Password o Brevo)
- `OWNER_EMAIL`: correo que recibe notificaciones

## 3) Despliegue en Render (gratis)
- Repositorio público en GitHub
- En Render: Build command `npm install`, Start command `npm start`
- Añade las variables de entorno anteriores en Render

## 4) Personalización rápida
- El nombre de marca ya está configurado como **JRbarber**.
- Edita servicios y duraciones en `public/index.html` si lo deseas.
