const jwt = require('jsonwebtoken');
const db = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'super_secreto_tasador_inmobiliario_jwt_2026';

/**
 * Middleware para verificar autenticación mediante JWT
 */
async function verificarToken(req, res, next) {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ error: 'Acceso denegado. Se requiere token de autenticación.' });
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    if (!token) {
      return res.status(401).json({ error: 'Formato de token inválido.' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // Obtener datos frescos del usuario desde la base de datos (incluyendo créditos actualizados)
    const usuario = await db.obtenerUsuarioPorId(decoded.id);

    if (!usuario) {
      return res.status(401).json({ error: 'Usuario no encontrado o sesión expirada.' });
    }

    req.usuario = usuario;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Tu sesión ha expirado. Por favor inicia sesión nuevamente.' });
    }
    return res.status(401).json({ error: 'Token inválido o corrupto.' });
  }
}

/**
 * Middleware para verificar si el usuario tiene rol de Administrador
 */
function verificarAdmin(req, res, next) {
  if (!req.usuario) {
    return res.status(401).json({ error: 'Autenticación requerida.' });
  }

  const esAdmin = req.usuario.rol === 'admin' || req.usuario.email === 'informatica.full@gmail.com';

  if (!esAdmin) {
    return res.status(403).json({ error: 'Acceso restringido. Solo administradores pueden realizar esta acción.' });
  }

  next();
}

module.exports = {
  verificarToken,
  verificarAdmin,
  JWT_SECRET
};
