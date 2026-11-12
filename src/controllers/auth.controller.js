const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../database');
const emailService = require('../services/email.service');
const { JWT_SECRET } = require('../middlewares/auth.middleware');

/**
 * Registro de un nuevo usuario
 */
async function registro(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Debes proporcionar email y contraseña.' });
    }

    const emailNormalizado = email.toLowerCase().trim();

    // Validar formato básico de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(emailNormalizado)) {
      return res.status(400).json({ error: 'El formato del correo electrónico no es válido.' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    // Verificar si ya existe
    const usuarioExistente = await db.obtenerUsuarioPorEmail(emailNormalizado);
    if (usuarioExistente) {
      return res.status(400).json({ error: 'Este correo electrónico ya se encuentra registrado.' });
    }

    // Crear usuario con 0 créditos iniciales
    const nuevoUsuario = await db.crearUsuario({
      email: emailNormalizado,
      password: password,
      rol: 'user',
      creditos: 0
    });

    // Generar token JWT
    const token = jwt.sign(
      { id: nuevoUsuario.id, email: nuevoUsuario.email, rol: nuevoUsuario.rol },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente con 0 créditos.',
      token,
      requiere_rol: true,
      usuario: {
        id: nuevoUsuario.id,
        email: nuevoUsuario.email,
        rol: nuevoUsuario.rol,
        creditos: nuevoUsuario.creditos,
        rol_profesional: null,
        requiere_rol: true
      }
    });
  } catch (error) {
    console.error('Error en registro:', error);
    return res.status(500).json({ error: 'Error al registrar usuario: ' + error.message });
  }
}

/**
 * Inicio de sesión con validación de credenciales
 */
async function login(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Debes proporcionar email y contraseña.' });
    }

    const emailNormalizado = email.toLowerCase().trim();
    const usuario = await db.obtenerUsuarioPorEmail(emailNormalizado);

    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas. Correo o contraseña incorrectos.' });
    }

    const passwordValida = bcrypt.compareSync(password, usuario.password);
    if (!passwordValida) {
      return res.status(401).json({ error: 'Credenciales inválidas. Correo o contraseña incorrectos.' });
    }

    // Generar token JWT
    const token = jwt.sign(
      { id: usuario.id, email: usuario.email, rol: usuario.rol },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    const requiereRol = !usuario.rol_profesional || String(usuario.rol_profesional).trim() === '';

    return res.json({
      success: true,
      message: 'Inicio de sesión exitoso.',
      token,
      requiere_rol: requiereRol,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        rol: usuario.rol,
        creditos: usuario.creditos,
        nombre: usuario.nombre || '',
        picture: usuario.picture || '',
        rol_profesional: usuario.rol_profesional || null,
        requiere_rol: requiereRol
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    return res.status(500).json({ error: 'Error al iniciar sesión: ' + error.message });
  }
}

/**
 * Consulta el perfil actual del usuario logueado (incluye saldo de créditos en vivo)
 */
async function perfil(req, res) {
  try {
    const requiereRol = !req.usuario?.rol_profesional || String(req.usuario.rol_profesional).trim() === '';
    return res.json({
      success: true,
      requiere_rol: requiereRol,
      usuario: {
        ...req.usuario,
        requiere_rol: requiereRol
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al consultar perfil: ' + error.message });
  }
}

/**
 * Endpoint de Administrador para modificar créditos a un usuario por su email
 * Acciones soportadas: 'sumar', 'restar', 'establecer'
 * Si la acción es 'sumar', envía notificaciones por correo (Cliente y Admin)
 */
async function agregarCreditos(req, res) {
  try {
    const { email, creditos, accion = 'sumar', packNombre, packMonto } = req.body;

    if (!email || email.trim() === '') {
      return res.status(400).json({ error: 'Debes indicar un correo electrónico válido.' });
    }

    if (creditos === undefined || creditos === null || isNaN(Number(creditos))) {
      return res.status(400).json({ error: 'Debes indicar una cantidad de créditos válida.' });
    }

    const cantidad = parseInt(creditos, 10);
    if (cantidad < 0) {
      return res.status(400).json({ error: 'La cantidad de créditos no puede ser un número negativo.' });
    }

    const accionNormalizada = ['sumar', 'restar', 'establecer'].includes(accion) ? accion : 'sumar';

    if (accionNormalizada !== 'establecer' && cantidad === 0) {
      return res.status(400).json({ error: 'Para sumar o restar créditos, la cantidad debe ser mayor a 0.' });
    }

    const usuarioActualizado = await db.modificarCreditosPorEmail(email, cantidad, accionNormalizada, packNombre);

    if (!usuarioActualizado) {
      return res.status(404).json({ error: `No se encontró ningún usuario con el correo ${email}.` });
    }

    // Mensaje de respuesta claro según la acción ejecutada
    let mensajeRespuesta = '';
    if (accionNormalizada === 'sumar') {
      mensajeRespuesta = `Se han sumado +${cantidad} crédito(s) a ${email}. Nuevo saldo: ${usuarioActualizado.creditos}.`;
    } else if (accionNormalizada === 'restar') {
      mensajeRespuesta = `Se han restado -${cantidad} crédito(s) a ${email}. Nuevo saldo: ${usuarioActualizado.creditos}.`;
    } else if (accionNormalizada === 'establecer') {
      mensajeRespuesta = `Se ha establecido el saldo de ${email} en exactamente ${usuarioActualizado.creditos} crédito(s).`;
    }

    // Solo se envían notificaciones de venta/recarga por correo si la acción es 'sumar'
    let resultadoEmail = { enviado: false };
    if (accionNormalizada === 'sumar') {
      let nombrePack = (packNombre || '').trim();
      let montoPack = (packMonto || '').trim();

      if (!nombrePack) {
        if (cantidad === 1) {
          nombrePack = 'Pack Inicial (1 informe)';
          montoPack = '$20.000 CLP';
        } else if (cantidad === 3) {
          nombrePack = 'Pack Profesional (3 informes)';
          montoPack = '$45.000 CLP';
        } else if (cantidad === 5) {
          nombrePack = 'Pack Corredor (5 informes)';
          montoPack = '$70.000 CLP';
        } else {
          nombrePack = `Pack de ${cantidad} Informes`;
          montoPack = `$${(cantidad * 15000).toLocaleString('es-CL')} CLP`;
        }
      }

      // Envío asíncrono y protegido de correos con Nodemailer
      try {
        resultadoEmail = await emailService.enviarNotificacionesRecarga({
          clienteEmail: email.toLowerCase().trim(),
          creditos: cantidad,
          packNombre: nombrePack,
          packMonto: montoPack
        });
      } catch (mailErr) {
        console.warn('[modificarCreditos] Fallo no fatal al enviar notificaciones de correo:', mailErr.message);
        resultadoEmail = { enviado: false, error: mailErr.message };
      }
    }

    return res.json({
      success: true,
      message: `${mensajeRespuesta}${resultadoEmail.enviado ? ' Notificaciones enviadas por correo.' : ''}`,
      usuario: usuarioActualizado,
      notificacion_email: resultadoEmail
    });
  } catch (error) {
    console.error('Error en agregarCreditos/modificarCreditos:', error);
    return res.status(500).json({ error: 'Error al modificar créditos: ' + error.message });
  }
}

/**
 * Endpoint de Administrador para listar usuarios registrados
 */
async function listarUsuariosAdmin(req, res) {
  try {
    const usuarios = await db.listarUsuarios();
    return res.json({
      success: true,
      count: usuarios.length,
      usuarios
    });
  } catch (error) {
    console.error('Error en listarUsuariosAdmin:', error);
    return res.status(500).json({ error: 'Error al listar usuarios: ' + error.message });
  }
}

/**
 * Autenticación con Google OAuth 2.0 (Google Identity Services)
 * Recibe el idToken / credential emitido por Google, lo valida,
 * registra o recupera al usuario en la BD, y emite un JWT de sesión.
 */
async function googleAuth(req, res) {
  try {
    const { idToken, credential } = req.body;
    const tokenRecibido = idToken || credential;

    if (!tokenRecibido) {
      return res.status(400).json({ error: 'Token de Google no proporcionado (se requiere idToken o credential).' });
    }

    const rawClientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENTID || process.env.GMAIL_CLIENT_ID || '';
    const clientId = rawClientId.trim().replace(/^["']|["']$/g, '');
    if (!clientId || clientId.includes('tu_google_client_id')) {
      return res.status(500).json({ 
        error: 'El backend no tiene configurado GOOGLE_CLIENT_ID en las variables de entorno de Render (.env). Por favor revisa la configuración.' 
      });
    }

    const client = new OAuth2Client(clientId);

    // Verificar firma y validez del ID Token con Google
    let payload;
    try {
      const ticket = await client.verifyIdToken({
        idToken: tokenRecibido,
        audience: clientId
      });
      payload = ticket.getPayload();
    } catch (verifErr) {
      console.error('[Google Auth] Error al verificar ID Token de Google:', verifErr.message);
      return res.status(401).json({ error: 'Token de Google inválido o expirado: ' + verifErr.message });
    }

    if (!payload || !payload.email) {
      return res.status(400).json({ error: 'El token de Google no contiene una dirección de correo válida.' });
    }

    const email = payload.email.toLowerCase().trim();
    const nombre = payload.name || payload.given_name || email.split('@')[0];
    const picture = payload.picture || '';

    // Buscar o registrar usuario en SQLite (garantiza rol 'admin' para informatica.full@gmail.com)
    const usuario = await db.obtenerOCrearUsuarioGoogle({
      email,
      nombre,
      picture
    });

    // Generar token JWT firmado para la sesión de la app
    const token = jwt.sign(
      { 
        id: usuario.id, 
        email: usuario.email, 
        rol: usuario.rol,
        nombre: usuario.nombre,
        picture: usuario.picture
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`[Google Auth] Sesión iniciada con éxito para ${usuario.email} (Rol: ${usuario.rol}, Créditos: ${usuario.creditos})`);

    const requiereRol = !usuario.rol_profesional || String(usuario.rol_profesional).trim() === '';

    return res.json({
      success: true,
      message: `¡Bienvenido(a), ${usuario.nombre || usuario.email}!`,
      token,
      requiere_rol: requiereRol,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        rol: usuario.rol,
        creditos: usuario.creditos,
        nombre: usuario.nombre,
        picture: usuario.picture,
        rol_profesional: usuario.rol_profesional || null,
        requiere_rol: requiereRol
      }
    });

  } catch (error) {
    console.error('[Google Auth] Error general:', error);
    return res.status(500).json({ error: 'Error en autenticación con Google: ' + error.message });
  }
}

/**
 * Actualiza el rol profesional del usuario autenticado ('Particular', 'Corredor de Propiedades', 'Tasador Certificado')
 */
async function actualizarRol(req, res) {
  try {
    const { rol_profesional } = req.body;
    const rolesPermitidos = ['Particular', 'Corredor de Propiedades', 'Tasador Certificado'];

    if (!rol_profesional || !rolesPermitidos.includes(rol_profesional)) {
      return res.status(400).json({ 
        error: `Rol profesional inválido. Debe ser uno de: ${rolesPermitidos.join(', ')}` 
      });
    }

    // Excepción y validación: Nivel 3 (Tasador Certificado) requiere validación del Administrador
    const esAdmin = req.usuario.rol === 'admin' || req.usuario.email === 'informatica.full@gmail.com';
    if (rol_profesional.toLowerCase().includes('tasador') && !esAdmin) {
      return res.status(403).json({
        error: '🔒 El rol de Tasador requiere validación. Contacta a informatica.full@gmail.com para solicitar el acceso PRO.'
      });
    }

    const usuarioActualizado = await db.actualizarRolProfesional(req.usuario.id, rol_profesional);

    return res.json({
      success: true,
      message: 'Rol profesional actualizado correctamente.',
      requiere_rol: false,
      usuario: {
        id: usuarioActualizado.id,
        email: usuarioActualizado.email,
        rol: usuarioActualizado.rol,
        creditos: usuarioActualizado.creditos,
        nombre: usuarioActualizado.nombre,
        picture: usuarioActualizado.picture,
        rol_profesional: usuarioActualizado.rol_profesional,
        requiere_rol: false
      }
    });
  } catch (error) {
    console.error('Error en actualizarRol:', error);
    return res.status(500).json({ error: 'Error al actualizar rol profesional: ' + error.message });
  }
}

/**
 * Endpoint de Administrador para cambiar el rol profesional de un usuario
 * POST /api/admin/cambiar-rol
 * Body: { email, nuevo_rol }
 */
async function cambiarRolAdmin(req, res) {
  try {
    const { email, nuevo_rol } = req.body;

    if (!email || email.trim() === '') {
      return res.status(400).json({ error: 'Debes indicar un correo electrónico válido.' });
    }

    if (!nuevo_rol || typeof nuevo_rol !== 'string') {
      return res.status(400).json({ error: 'Debes indicar un nuevo rol profesional válido.' });
    }

    const rolesValidos = ['Particular', 'Corredor de Propiedades', 'Tasador Certificado'];
    let rolNormalizado = rolesValidos.find(r => r.toLowerCase() === nuevo_rol.toLowerCase());
    if (!rolNormalizado) {
      if (nuevo_rol.toLowerCase().includes('particular')) rolNormalizado = 'Particular';
      else if (nuevo_rol.toLowerCase().includes('corredor')) rolNormalizado = 'Corredor de Propiedades';
      else if (nuevo_rol.toLowerCase().includes('tasador')) rolNormalizado = 'Tasador Certificado';
      else {
        return res.status(400).json({
          error: `Rol inválido. Los roles permitidos son: ${rolesValidos.join(', ')}`
        });
      }
    }

    const emailNorm = email.toLowerCase().trim();

    // Protección: no modificar el rol de la cuenta principal de administración
    if (emailNorm === 'informatica.full@gmail.com') {
      return res.status(400).json({
        error: 'Operación no permitida: No se puede modificar el rol de la cuenta principal del Administrador.'
      });
    }

    const usuarioActualizado = await db.actualizarRolProfesionalPorEmail(emailNorm, rolNormalizado);

    return res.json({
      success: true,
      message: `Rol de ${emailNorm} actualizado a ${rolNormalizado}`,
      usuario: {
        id: usuarioActualizado.id,
        email: usuarioActualizado.email,
        rol: usuarioActualizado.rol,
        rol_profesional: usuarioActualizado.rol_profesional,
        ultimo_plan: usuarioActualizado.ultimo_plan,
        creditos: usuarioActualizado.creditos,
        nombre: usuarioActualizado.nombre,
        picture: usuarioActualizado.picture
      }
    });
  } catch (error) {
    console.error('Error en cambiarRolAdmin:', error);
    return res.status(500).json({ error: 'Error al cambiar rol: ' + error.message });
  }
}

/**
 * Endpoint de Administrador para resetear el rol profesional de un usuario (UPDATE usuarios SET rol_profesional = NULL WHERE email = ?)
 */
async function resetearRolAdmin(req, res) {
  try {
    const { email } = req.body;

    if (!email || email.trim() === '') {
      return res.status(400).json({ error: 'Debes indicar un correo electrónico válido.' });
    }

    const emailNorm = email.toLowerCase().trim();
    const usuarioActualizado = await db.resetearRolProfesional(emailNorm);

    return res.json({
      success: true,
      message: `El rol profesional de ${emailNorm} ha sido reseteado a NULL exitosamente. El usuario deberá elegir un nuevo rol en su próximo inicio de sesión.`,
      usuario: {
        id: usuarioActualizado.id,
        email: usuarioActualizado.email,
        rol: usuarioActualizado.rol,
        creditos: usuarioActualizado.creditos,
        nombre: usuarioActualizado.nombre,
        picture: usuarioActualizado.picture,
        rol_profesional: null,
        requiere_rol: true
      }
    });
  } catch (error) {
    console.error('Error en resetearRolAdmin:', error);
    return res.status(500).json({ error: 'Error al resetear rol: ' + error.message });
  }
}

/**
 * Retorna la configuración pública para el frontend (como GOOGLE_CLIENT_ID)
 */
function obtenerConfigAuth(req, res) {
  const rawClientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENTID || process.env.GMAIL_CLIENT_ID || '';
  const clientId = rawClientId.trim().replace(/^["']|["']$/g, '');
  const configurado = Boolean(clientId && !clientId.includes('tu_google_client_id') && clientId !== '');
  return res.json({
    googleClientId: configurado ? clientId : '',
    configurado
  });
}

/**
 * Endpoint de Administrador para eliminar permanentemente a un usuario
 * Protección: No permite auto-eliminación ni eliminar la cuenta de informatica.full@gmail.com
 */
async function eliminarUsuarioAdmin(req, res) {
  try {
    const { email } = req.params;
    if (!email || email.trim() === '') {
      return res.status(400).json({ error: 'Debes indicar el email del usuario a eliminar.' });
    }

    const emailNorm = email.toLowerCase().trim();

    // Protección estricta contra auto-eliminación o eliminar al admin principal
    if (emailNorm === 'informatica.full@gmail.com') {
      return res.status(400).json({ error: 'Operación no permitida: No es posible eliminar la cuenta principal del Administrador (informatica.full@gmail.com).' });
    }

    if (req.usuario && req.usuario.email && req.usuario.email.toLowerCase().trim() === emailNorm) {
      return res.status(400).json({ error: 'Operación no permitida: No puedes eliminar tu propia cuenta en sesión activa.' });
    }

    const resultado = await db.eliminarUsuarioPorEmail(emailNorm);
    if (!resultado) {
      return res.status(404).json({ error: `No se encontró ningún usuario con el correo ${email}.` });
    }

    return res.json({
      success: true,
      message: `La cuenta de ${email} ha sido eliminada permanentemente del sistema.`
    });
  } catch (error) {
    console.error('Error en eliminarUsuarioAdmin:', error);
    return res.status(500).json({ error: 'Error al eliminar usuario: ' + error.message });
  }
}

module.exports = {
  registro,
  login,
  googleAuth,
  obtenerConfigAuth,
  perfil,
  actualizarRol,
  cambiarRolAdmin,
  resetearRolAdmin,
  agregarCreditos,
  listarUsuariosAdmin,
  eliminarUsuarioAdmin
};
