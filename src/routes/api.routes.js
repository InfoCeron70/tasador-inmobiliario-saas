const express = require('express');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const tasacionController = require('../controllers/tasacion.controller');
const indicadoresController = require('../controllers/indicadores.controller');
const sugerenciasController = require('../controllers/sugerencias.controller');
const { verificarToken, verificarAdmin } = require('../middlewares/auth.middleware');

// Rutas públicas de Autenticación
router.get('/auth/config', authController.obtenerConfigAuth);
router.post('/auth/google', authController.googleAuth);
router.post('/auth/registro', authController.registro);
router.post('/auth/login', authController.login);

// Indicadores económicos (público, con cache de 60 min)
router.get('/indicadores', indicadoresController.obtenerIndicadores);

// Sugerencia de comparables con IA
router.post('/sugerir-comparables', (req, res, next) => {
  if (req.headers.authorization) {
    return verificarToken(req, res, () => {
      const esAdmin = req.usuario.rol === 'admin' || req.usuario.email === 'informatica.full@gmail.com';
      if (!esAdmin) {
        const rolProf = (req.usuario.rol_profesional || '').toLowerCase();
        const puedeIA = rolProf.includes('corredor') || rolProf.includes('tasador');
        if (!puedeIA) {
          return res.status(403).json({
            error: '🔒 La sugerencia de comparables con IA está reservada para Corredores de Propiedades y Tasadores Certificados.'
          });
        }
      }
      next();
    });
  }
  next();
}, sugerenciasController.sugerirComparables);

// Rutas protegidas de autenticación y perfil
router.get('/auth/perfil', verificarToken, authController.perfil);
router.post('/auth/rol', verificarToken, authController.actualizarRol);

// Rutas protegidas exclusivas para Administrador
router.get('/admin/usuarios', verificarToken, verificarAdmin, authController.listarUsuariosAdmin);
router.post('/admin/agregar-creditos', verificarToken, verificarAdmin, authController.agregarCreditos);
router.post('/admin/cambiar-rol', verificarToken, verificarAdmin, authController.cambiarRolAdmin);
router.post('/admin/resetear-rol', verificarToken, verificarAdmin, authController.resetearRolAdmin);
router.delete('/admin/usuarios/:email', verificarToken, verificarAdmin, authController.eliminarUsuarioAdmin);

// Rutas de Tasación protegidas con verificarToken (Requiere sesión activa y créditos > 0)
router.post('/tasacion', verificarToken, tasacionController.crearTasacion);
router.get('/tasaciones', verificarToken, tasacionController.obtenerHistorial);
router.get('/tasaciones/:id', verificarToken, tasacionController.obtenerTasacionPorId);

// Exportación en memoria
router.post('/exportar/pdf', (req, res, next) => {
  if (req.headers.authorization) {
    return verificarToken(req, res, next);
  }
  next();
}, tasacionController.exportarPdf);
router.post('/exportar/excel', (req, res, next) => {
  return verificarToken(req, res, () => {
    const esAdmin = req.usuario.rol === 'admin' || req.usuario.email === 'informatica.full@gmail.com';
    if (esAdmin) return next();

    const rolProf = (req.usuario.rol_profesional || '').toLowerCase();
    const puedeExcel = rolProf.includes('corredor') || rolProf.includes('tasador');

    if (!puedeExcel) {
      return res.status(403).json({
        error: '🔒 Acceso denegado: La descarga de informes en Excel está reservada para Corredores de Propiedades y Tasadores Certificados. Por favor actualiza tu perfil profesional.'
      });
    }

    next();
  });
}, tasacionController.exportarExcel);

module.exports = router;
