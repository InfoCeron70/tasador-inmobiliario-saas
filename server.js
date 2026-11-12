require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const apiRoutes = require('./src/routes/api.routes');

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares globales
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

/**
 * Función para servir index.html inyectando directamente las variables públicas
 * como GOOGLE_CLIENT_ID en window.__ENV__ y en data-attribute de <body>
 */
function servirIndexHtmlConEnv(req, res) {
  try {
    const indexPath = path.join(__dirname, 'public', 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');

    // Leer GOOGLE_CLIENT_ID desde process.env (limpiando posibles comillas residuales)
    const rawClientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENTID || process.env.GMAIL_CLIENT_ID || '';
    const googleClientId = rawClientId.trim().replace(/^["']|["']$/g, '');
    const estaConfigurado = Boolean(googleClientId && !googleClientId.includes('tu_google_client_id') && googleClientId !== '');

    // Inyectar script con configuración global en el <head>
    const scriptEnv = `
  <script id="server-env">
    window.__ENV__ = {
      GOOGLE_CLIENT_ID: ${JSON.stringify(estaConfigurado ? googleClientId : '')},
      GOOGLE_CONFIGURADO: ${estaConfigurado}
    };
  </script>`;

    if (html.includes('</head>')) {
      html = html.replace('</head>', `${scriptEnv}\n</head>`);
    } else {
      html = scriptEnv + html;
    }

    // Inyectar data-attribute en el tag <body>
    html = html.replace('<body', `<body data-google-client-id="${estaConfigurado ? googleClientId : ''}" data-google-configurado="${estaConfigurado}"`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  } catch (err) {
    console.error('[Error]: No se pudo inyectar variables de entorno en index.html:', err);
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
}

// Ruta principal para servir index.html con variables de entorno inyectadas
app.get('/', servirIndexHtmlConEnv);
app.get('/index.html', servirIndexHtmlConEnv);

// Servir archivos estáticos (css, js, imágenes) excluyendo el index estático
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Rutas de API
app.use('/api', apiRoutes);

// Endpoint de verificación de estado
app.get('/api/health', (req, res) => {
  const rawClientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENTID || process.env.GMAIL_CLIENT_ID || '';
  const googleClientId = rawClientId.trim().replace(/^["']|["']$/g, '');
  const googleConfigurado = Boolean(googleClientId && !googleClientId.includes('tu_google_client_id') && googleClientId !== '');

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Tasador Inmobiliario IA - Chile',
    ai_configured: Boolean(process.env.DEEPSEEK_API_KEY && !process.env.DEEPSEEK_API_KEY.includes('tu_api_key')),
    google_auth_configured: googleConfigurado
  });
});

// Manejador de rutas no encontradas (fallback SPA a frontend con inyección de variables)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return servirIndexHtmlConEnv(req, res);
  }
  res.status(404).json({ error: 'Recurso no encontrado' });
});

// Manejo centralizado de errores
app.use((err, req, res, next) => {
  console.error('[Error de Servidor]:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor'
  });
});

app.listen(PORT, () => {
  const rawClientId = process.env.GOOGLE_CLIENT_ID || '';
  const cleanId = rawClientId.trim().replace(/^["']|["']$/g, '');
  const googleOk = Boolean(cleanId && !cleanId.includes('tu_google_client_id'));

  console.log(`====================================================`);
  console.log(`  Tasador Inmobiliario IA (Chile)`);
  console.log(`  Servidor iniciado en: http://localhost:${PORT}`);
  console.log(`  Modelo IA configurado: ${process.env.DEEPSEEK_MODEL || 'deepseek-flash'}`);
  console.log(`  Google Client ID: ${googleOk ? 'Configurado (' + cleanId.substring(0, 15) + '...)' : 'NO configurado'}`);
  console.log(`====================================================`);
});

module.exports = app;
