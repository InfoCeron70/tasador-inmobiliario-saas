const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Configuración de la conexión PostgreSQL
const connectionString = process.env.DATABASE_URL;

const poolConfig = {
  connectionString: connectionString || 'postgresql://postgres:postgres@localhost:5432/tasaciones_db'
};

// Configuración inteligente de SSL:
// En Coolify (redes internas Docker) o localhost, SSL no suele ser requerido.
// Si se conecta a un PostgreSQL externo o remoto que requiera SSL, se habilita con rejectUnauthorized: false.
const isLocal = !connectionString || connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
const isInternalDocker = connectionString && (connectionString.includes('@postgres:') || connectionString.includes('@database:') || connectionString.includes('sslmode=disable'));
const sslExplicitlyDisabled = process.env.DATABASE_SSL === 'false';
const sslExplicitlyEnabled = process.env.DATABASE_SSL === 'true';

if (sslExplicitlyEnabled || (!isLocal && !isInternalDocker && !sslExplicitlyDisabled)) {
  poolConfig.ssl = {
    rejectUnauthorized: false
  };
}

const pool = new Pool(poolConfig);

pool.on('error', (err) => {
  console.error('[Error inesperado en Pool de PostgreSQL]:', err.message);
});

/**
 * Inicialización de esquemas de tablas y usuarios por defecto
 */
async function initDB() {
  try {
    // 1. Tabla de Usuarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        rol VARCHAR(50) DEFAULT 'user',
        creditos INTEGER DEFAULT 0,
        rol_profesional VARCHAR(100) DEFAULT NULL,
        ultimo_plan VARCHAR(100) DEFAULT NULL,
        nombre VARCHAR(255) DEFAULT '',
        picture TEXT DEFAULT '',
        fecha_registro TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Migraciones defensivas: asegurar existencia de columnas si la tabla ya existía
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS nombre VARCHAR(255) DEFAULT ''`);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS picture TEXT DEFAULT ''`);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS rol_profesional VARCHAR(100) DEFAULT NULL`);
    await pool.query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_plan VARCHAR(100) DEFAULT NULL`);

    // 2. Tabla de Historial con clave foránea a usuarios
    await pool.query(`
      CREATE TABLE IF NOT EXISTS historial (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE,
        fecha VARCHAR(100) NOT NULL,
        comuna VARCHAR(100) NOT NULL,
        tipo_inmueble VARCHAR(100),
        superficie_m2 DOUBLE PRECISION DEFAULT 0,
        dormitorios INTEGER DEFAULT 0,
        banos INTEGER DEFAULT 0,
        valor_referencia DOUBLE PRECISION NOT NULL,
        precio_unitario_promedio DOUBLE PRECISION DEFAULT 0,
        datos_entrada TEXT NOT NULL,
        resultado_ia TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Tablas PostgreSQL verificadas/creadas correctamente.');

    // Auto-crear usuario administrador y usuario de prueba si no existen
    await inicializarUsuarioAdmin();
    await inicializarUsuarioPrueba();
  } catch (err) {
    console.error('Error al verificar/inicializar tablas PostgreSQL:', err.message);
  }
}

// Probar conexión inicial y ejecutar inicialización
pool.connect()
  .then((client) => {
    console.log('Conexión establecida con la base de datos PostgreSQL.');
    client.release();
    return initDB();
  })
  .catch((err) => {
    console.error('Aviso de conexión PostgreSQL:', err.message);
    if (!process.env.DATABASE_URL) {
      console.warn('Recuerda configurar la variable DATABASE_URL en tu entorno (.env o Coolify).');
    }
  });

/**
 * Inserta automáticamente al administrador inicial si no existe
 */
async function inicializarUsuarioAdmin() {
  const adminEmail = 'informatica.full@gmail.com';
  try {
    const res = await pool.query(`SELECT id FROM usuarios WHERE email = $1`, [adminEmail]);
    if (res.rows.length === 0) {
      const passwordHash = bcrypt.hashSync('admin123', 10);
      await pool.query(
        `INSERT INTO usuarios (email, password, rol, creditos) VALUES ($1, $2, 'admin', 9999)`,
        [adminEmail, passwordHash]
      );
      console.log(`Usuario Administrador inicial creado con éxito: ${adminEmail} (9999 créditos)`);
    }
  } catch (err) {
    console.error('Error al inicializar usuario admin:', err.message);
  }
}

/**
 * Inserta automáticamente al usuario de prueba (cliente@correo.cl / 123456) con 5 créditos si no existe
 */
async function inicializarUsuarioPrueba() {
  const testEmail = 'cliente@correo.cl';
  try {
    const res = await pool.query(`SELECT id, creditos FROM usuarios WHERE email = $1`, [testEmail]);
    const passwordHash = bcrypt.hashSync('123456', 10);
    if (res.rows.length === 0) {
      await pool.query(
        `INSERT INTO usuarios (email, password, rol, creditos) VALUES ($1, $2, 'user', 5)`,
        [testEmail, passwordHash]
      );
      console.log(`Usuario de prueba inicial creado con éxito: ${testEmail} (Password: 123456, 5 créditos)`);
    } else {
      const row = res.rows[0];
      const creditosAsignar = row.creditos < 5 ? 5 : row.creditos;
      await pool.query(
        `UPDATE usuarios SET password = $1, creditos = $2 WHERE email = $3`,
        [passwordHash, creditosAsignar, testEmail]
      );
      console.log(`Usuario de prueba actualizado: ${testEmail} (Password: 123456, Créditos: ${creditosAsignar})`);
    }
  } catch (err) {
    console.error('Error al inicializar usuario de prueba:', err.message);
  }
}

/**
 * Registra un nuevo usuario con contraseña encriptada
 */
async function crearUsuario({ email, password, rol = 'user', creditos = 0 }) {
  const passwordHash = bcrypt.hashSync(password, 10);
  const query = `
    INSERT INTO usuarios (email, password, rol, creditos)
    VALUES ($1, $2, $3, $4)
    RETURNING id, email, rol, creditos, nombre, picture, rol_profesional, fecha_registro
  `;
  const values = [email.toLowerCase().trim(), passwordHash, rol, creditos];
  const res = await pool.query(query, values);
  return res.rows[0];
}

/**
 * Obtiene usuario por email
 */
async function obtenerUsuarioPorEmail(email) {
  const query = `SELECT * FROM usuarios WHERE email = $1`;
  const res = await pool.query(query, [email.toLowerCase().trim()]);
  return res.rows[0] || null;
}

/**
 * Obtiene usuario por ID (sin contraseña)
 */
async function obtenerUsuarioPorId(id) {
  const query = `
    SELECT id, email, rol, creditos, nombre, picture, rol_profesional, ultimo_plan, fecha_registro 
    FROM usuarios 
    WHERE id = $1
  `;
  const res = await pool.query(query, [id]);
  return res.rows[0] || null;
}

/**
 * Descuenta 1 crédito al usuario de forma atómica si tiene creditos > 0
 */
async function descontarCredito(usuarioId) {
  const query = `
    UPDATE usuarios 
    SET creditos = creditos - 1 
    WHERE id = $1 AND creditos > 0
  `;
  const res = await pool.query(query, [usuarioId]);
  return res.rowCount > 0;
}

/**
 * Limpia y normaliza el nombre del pack comercial
 */
function limpiarNombrePack(str) {
  if (!str) return 'Pack Personalizado';
  const s = str.trim();
  if (s.toLowerCase().includes('inicial')) return 'Pack Inicial';
  if (s.toLowerCase().includes('profesional')) return 'Pack Profesional';
  if (s.toLowerCase().includes('corredor')) return 'Pack Corredor';
  if (s.toLowerCase().includes('personalizado')) return 'Pack Personalizado';
  return s.replace(/\s*\(.*?\)/, '').trim();
}

/**
 * Modifica créditos a un usuario por su email: 'sumar', 'restar' o 'establecer' (Solo Admin)
 * Si la acción es 'sumar' y se seleccionó un pack, guarda el último plan adquirido.
 */
async function modificarCreditosPorEmail(email, cantidad, accion = 'sumar', packNombre = null) {
  const emailNorm = email.toLowerCase().trim();
  const cant = parseInt(cantidad, 10);
  if (isNaN(cant) || cant < 0) {
    throw new Error('La cantidad de créditos debe ser un número entero mayor o igual a 0.');
  }

  const usuario = await obtenerUsuarioPorEmail(emailNorm);
  if (!usuario) {
    return null; // Usuario no encontrado
  }

  const saldoAnterior = usuario.creditos !== undefined ? usuario.creditos : 0;
  let nuevoSaldo = saldoAnterior;

  if (accion === 'sumar') {
    nuevoSaldo = saldoAnterior + cant;
  } else if (accion === 'restar') {
    nuevoSaldo = Math.max(0, saldoAnterior - cant);
  } else if (accion === 'establecer') {
    nuevoSaldo = Math.max(0, cant);
  } else {
    nuevoSaldo = saldoAnterior + cant;
  }

  let queryUpdate = `UPDATE usuarios SET creditos = $1 WHERE id = $2`;
  let params = [nuevoSaldo, usuario.id];

  // Si la acción es 'sumar' y se indicó un pack, guardar en ultimo_plan
  let planGuardado = usuario.ultimo_plan;
  if (accion === 'sumar' && packNombre && packNombre.trim()) {
    const planLimpio = limpiarNombrePack(packNombre);
    queryUpdate = `UPDATE usuarios SET creditos = $1, ultimo_plan = $2 WHERE id = $3`;
    params = [nuevoSaldo, planLimpio, usuario.id];
    planGuardado = planLimpio;
  }

  await pool.query(queryUpdate, params);

  return {
    id: usuario.id,
    email: usuario.email,
    rol: usuario.rol,
    creditos: nuevoSaldo,
    saldoAnterior,
    accion,
    ultimo_plan: planGuardado,
    diferencia: nuevoSaldo - saldoAnterior
  };
}

/**
 * Agrega créditos a un usuario por su email (Solo Admin) - Alias compatible
 */
function agregarCreditosPorEmail(email, cantidad) {
  return modificarCreditosPorEmail(email, cantidad, 'sumar');
}

/**
 * Guarda una nueva tasación en la base de datos asociada a un usuario
 */
async function guardarTasacion(data) {
  const query = `
    INSERT INTO historial (
      usuario_id,
      fecha,
      comuna,
      tipo_inmueble,
      superficie_m2,
      dormitorios,
      banos,
      valor_referencia,
      precio_unitario_promedio,
      datos_entrada,
      resultado_ia
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id
  `;

  const params = [
    data.usuario_id || null,
    data.fecha || new Date().toISOString(),
    data.comuna,
    data.tipo_inmueble || '',
    Number(data.superficie_m2) || 0,
    Number(data.dormitorios) || 0,
    Number(data.banos) || 0,
    Number(data.valor_referencia) || 0,
    Number(data.precio_unitario_promedio) || 0,
    typeof data.datos_entrada === 'string' ? data.datos_entrada : JSON.stringify(data.datos_entrada),
    typeof data.resultado_ia === 'string' ? data.resultado_ia : JSON.stringify(data.resultado_ia)
  ];

  const res = await pool.query(query, params);
  return { id: res.rows[0].id, ...data };
}

/**
 * Obtiene el historial de tasaciones filtrado por usuario (o todas si es admin)
 */
async function obtenerHistorial(usuarioId = null, esAdmin = false) {
  let query = `
    SELECT 
      id,
      usuario_id,
      fecha,
      comuna,
      tipo_inmueble,
      superficie_m2,
      dormitorios,
      banos,
      valor_referencia,
      precio_unitario_promedio,
      created_at
    FROM historial
  `;
  const params = [];

  if (!esAdmin && usuarioId) {
    query += ` WHERE usuario_id = $1 `;
    params.push(usuarioId);
  }

  query += ` ORDER BY id DESC `;

  const res = await pool.query(query, params);
  return res.rows;
}

/**
 * Obtiene una tasación completa por ID (incluyendo JSONs)
 */
async function obtenerTasacionPorId(id) {
  const query = `SELECT * FROM historial WHERE id = $1`;
  const res = await pool.query(query, [id]);
  const row = res.rows[0] || null;

  if (!row) {
    return null;
  }

  try {
    row.datos_entrada = JSON.parse(row.datos_entrada);
  } catch (e) {
    // mantener como string si falla
  }

  try {
    row.resultado_ia = JSON.parse(row.resultado_ia);
  } catch (e) {
    // mantener como string si falla
  }

  return row;
}

/**
 * Obtiene o crea un usuario autenticado mediante Google OAuth 2.0
 * Si el email es informatica.full@gmail.com, asegura siempre rol 'admin'.
 */
async function obtenerOCrearUsuarioGoogle({ email, nombre, picture }) {
  const emailNorm = email.toLowerCase().trim();
  const esAdmin = emailNorm === 'informatica.full@gmail.com';

  const querySelect = `SELECT * FROM usuarios WHERE email = $1`;
  const res = await pool.query(querySelect, [emailNorm]);
  const row = res.rows[0];

  if (row) {
    // Usuario ya existe: garantizar rol 'admin' si es el correo principal
    const nuevoRol = esAdmin ? 'admin' : (row.rol || 'user');
    const queryUpdate = `
      UPDATE usuarios 
      SET rol = $1,
          nombre = COALESCE($2, nombre),
          picture = COALESCE($3, picture)
      WHERE id = $4
      RETURNING id, email, rol, creditos, nombre, picture, rol_profesional, fecha_registro
    `;
    const updRes = await pool.query(queryUpdate, [nuevoRol, nombre || null, picture || null, row.id]);
    return updRes.rows[0];
  } else {
    // Usuario nuevo: registrarlo automáticamente con 0 créditos (o 9999 si es admin)
    const rolInicial = esAdmin ? 'admin' : 'user';
    const creditosInicial = esAdmin ? 9999 : 0;
    const passwordDummy = bcrypt.hashSync(`google_oauth_${Date.now()}_${Math.random()}`, 10);

    const queryInsert = `
      INSERT INTO usuarios (email, password, rol, creditos, nombre, picture, rol_profesional)
      VALUES ($1, $2, $3, $4, $5, $6, NULL)
      RETURNING id, email, rol, creditos, nombre, picture, rol_profesional, fecha_registro
    `;
    const insRes = await pool.query(queryInsert, [emailNorm, passwordDummy, rolInicial, creditosInicial, nombre || '', picture || '']);
    return insRes.rows[0];
  }
}

/**
 * Actualiza el rol profesional de un usuario ('Particular', 'Corredor de Propiedades', 'Tasador Certificado')
 */
async function actualizarRolProfesional(usuarioId, rolProfesional) {
  const query = `
    UPDATE usuarios 
    SET rol_profesional = $1 
    WHERE id = $2
  `;
  const res = await pool.query(query, [rolProfesional, usuarioId]);
  if (res.rowCount === 0) {
    throw new Error('Usuario no encontrado');
  }
  return await obtenerUsuarioPorId(usuarioId);
}

/**
 * Actualiza el rol profesional de un usuario según su correo electrónico (Solo Administrador)
 */
async function actualizarRolProfesionalPorEmail(email, rolProfesional) {
  const emailNorm = email.toLowerCase().trim();
  const query = `
    UPDATE usuarios 
    SET rol_profesional = $1 
    WHERE email = $2
  `;
  const res = await pool.query(query, [rolProfesional, emailNorm]);
  if (res.rowCount === 0) {
    throw new Error(`No se encontró ningún usuario con el correo ${emailNorm}`);
  }
  return await obtenerUsuarioPorEmail(emailNorm);
}

/**
 * Resetea el rol profesional a NULL para un usuario según su correo electrónico (Solo Administrador)
 */
async function resetearRolProfesional(email) {
  const emailNorm = email.toLowerCase().trim();
  const query = `
    UPDATE usuarios 
    SET rol_profesional = NULL 
    WHERE email = $1
  `;
  const res = await pool.query(query, [emailNorm]);
  if (res.rowCount === 0) {
    throw new Error(`No se encontró ningún usuario con el correo ${emailNorm}`);
  }
  return await obtenerUsuarioPorEmail(emailNorm);
}

/**
 * Lista todos los usuarios registrados (para panel de administración)
 */
async function listarUsuarios() {
  const query = `
    SELECT id, email, rol, creditos, nombre, picture, rol_profesional, ultimo_plan, fecha_registro
    FROM usuarios
    ORDER BY id DESC
  `;
  const res = await pool.query(query);
  return res.rows || [];
}

/**
 * Elimina permanentemente a un usuario y sus registros asociados por email (Solo Admin)
 */
async function eliminarUsuarioPorEmail(email) {
  const emailNorm = email.toLowerCase().trim();
  const usuario = await obtenerUsuarioPorEmail(emailNorm);
  if (!usuario) {
    return null;
  }

  // 1. Eliminar historial de tasaciones asociado al usuario
  try {
    await pool.query(`DELETE FROM historial WHERE usuario_id = $1`, [usuario.id]);
  } catch (errHist) {
    console.warn('[eliminarUsuario] Error no fatal al borrar historial:', errHist.message);
  }

  // 2. Eliminar el usuario
  const resUser = await pool.query(`DELETE FROM usuarios WHERE id = $1`, [usuario.id]);
  return { id: usuario.id, email: usuario.email, eliminados: resUser.rowCount };
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  initDB,
  crearUsuario,
  obtenerUsuarioPorEmail,
  obtenerUsuarioPorId,
  obtenerOCrearUsuarioGoogle,
  actualizarRolProfesional,
  actualizarRolProfesionalPorEmail,
  resetearRolProfesional,
  listarUsuarios,
  descontarCredito,
  modificarCreditosPorEmail,
  agregarCreditosPorEmail,
  eliminarUsuarioPorEmail,
  guardarTasacion,
  obtenerHistorial,
  obtenerTasacionPorId
};
