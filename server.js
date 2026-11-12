require('dotenv').config();
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

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));

// Rutas de API
app.use('/api', apiRoutes);

// Endpoint de verificación de estado
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Tasador Inmobiliario IA - Chile',
    ai_configured: Boolean(process.env.DEEPSEEK_API_KEY && !process.env.DEEPSEEK_API_KEY.includes('tu_api_key'))
  });
});

// Manejador de rutas no encontradas (fallback a frontend)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
  console.log(`====================================================`);
  console.log(`  Tasador Inmobiliario IA (Chile)`);
  console.log(`  Servidor iniciado en: http://localhost:${PORT}`);
  console.log(`  Modelo IA configurado: ${process.env.DEEPSEEK_MODEL || 'deepseek-flash'}`);
  console.log(`====================================================`);
});

module.exports = app;
