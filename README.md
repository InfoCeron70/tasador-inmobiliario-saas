# Tasador Inmobiliario IA (Chile) 🇨🇱 • Modelo SaaS

Aplicación web profesional para la **Tasación de Inmuebles** habitacionales en el mercado chileno bajo un modelo **SaaS (Software as a Service)** con sistema de autenticación por tokens **JWT**, consumo de **créditos por tasación**, panel de **administración**, persistencia relacional en **SQLite3**, exportación en memoria a **PDF/Excel**, e Inteligencia Artificial (**DeepSeek**).

---

## 🛠️ Stack Tecnológico

- **Backend**: Node.js v18+ / v24+ con Express 5.
- **Autenticación & Seguridad**: `jsonwebtoken` (JWT en `localStorage`), `bcryptjs` (hash de contraseñas con salt), `dotenv` y `cors`.
- **Base de Datos**: SQLite3 (`sqlite3`) con tablas `usuarios` e `historial`.
- **Inteligencia Artificial**: DeepSeek API (`deepseek-flash`) con salida JSON estricta (`response_format: { type: "json_object" }`) y motor técnico de respaldo.
- **Exportación en Memoria**: `pdfkit` (PDF institucional) y `exceljs` (Planilla de cálculo con formato moneda CLP).
- **Frontend**: HTML5, Vanilla JavaScript y Tailwind CSS (CDN) con diseño Enterprise Financiero responsivo móvil/desktop.

---

## 🔐 Cuenta de Administrador Inicial

Al inicializar la base de datos, el sistema inserta automáticamente la cuenta maestra de administrador:

- **Email**: `informatica.full@gmail.com`
- **Contraseña**: `admin123`
- **Rol**: `admin`
- **Créditos**: `9999` (Ilimitados)

---

## 💳 Lógica de Negocio SaaS & Créditos

1. **Registro**: Cualquier usuario nuevo se registra con email y contraseña, creándose su cuenta con **0 créditos**.
2. **Protección**: Las rutas de tasación (`/api/tasacion`) están protegidas por el middleware `verificarToken`.
3. **Consumo de Créditos**: Cada tasación descuenta **1 crédito** atómicamente antes de calcular el informe. Si el usuario tiene 0 créditos, el sistema responde `403 Forbidden` y bloquea la tasación, mostrando la alerta para recargar.
4. **Panel Admin**: Solo visible para `informatica.full@gmail.com` (o rol `admin`), permitiendo buscar a cualquier usuario por su correo y recargarle créditos con un clic.

---

## 📋 Endpoints de la API

| Método | Endpoint | Acceso | Descripción |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/auth/registro` | Público | Registra usuario con 0 créditos y devuelve token JWT. |
| `POST` | `/api/auth/login` | Público | Inicia sesión y devuelve token JWT y créditos actuales. |
| `GET` | `/api/auth/perfil` | Usuario | Devuelve los datos del usuario y saldo de créditos actualizados. |
| `POST` | `/api/admin/agregar-creditos` | **Admin** | Asigna/recarga créditos a un usuario por su email. |
| `POST` | `/api/tasacion` | Usuario | Consume 1 crédito, calcula tasación con IA y guarda en SQLite. |
| `GET` | `/api/tasaciones` | Usuario | Historial de tasaciones (filtrado por `usuario_id`). |
| `GET` | `/api/tasaciones/:id` | Usuario | Detalle de tasación por ID. |
| `POST` | `/api/exportar/pdf` | Público | Genera y descarga informe en memoria PDF. |
| `POST` | `/api/exportar/excel` | Público | Genera y descarga planilla en memoria Excel. |

---

## 🚀 Puesta en Marcha

1. **Variables de Entorno (`.env`)**:
   ```env
   PORT=3000
   JWT_SECRET=super_secreto_tasador_inmobiliario_jwt_2026
   DEEPSEEK_API_KEY=tu_api_key_de_deepseek_aqui
   DEEPSEEK_MODEL=deepseek-flash
   ```

2. **Iniciar Servidor**:
   ```powershell
   npm start
   ```

3. **Abrir en el Navegador**:
   [http://localhost:3000](http://localhost:3000)
