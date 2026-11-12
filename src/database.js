const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');

const DB_PATH = path.resolve(__dirname, '..', 'tasaciones.db');

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('Error al conectar con SQLite:', err.message);
  } else {
    console.log('Conexión establecida con la base de datos SQLite:', DB_PATH);
  }
});

// Inicialización de tablas y usuario administrador
db.serialize(() => {
  // 1. Tabla de Usuarios
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      rol TEXT DEFAULT 'user',
      creditos INTEGER DEFAULT 0,
      rol_profesional TEXT DEFAULT NULL,
      ultimo_plan TEXT DEFAULT NULL,
      fecha_registro DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error al crear tabla usuarios:', err.message);
    } else {
      console.log('Tabla usuarios verificada/creada correctamente.');
      // Migración dinámica de columnas adicionales para Google OAuth, rol profesional y último plan si no existen
      db.run(`ALTER TABLE usuarios ADD COLUMN nombre TEXT`, () => {});
      db.run(`ALTER TABLE usuarios ADD COLUMN picture TEXT`, () => {});
      db.run(`ALTER TABLE usuarios ADD COLUMN rol_profesional TEXT DEFAULT NULL`, () => {});
      db.run(`ALTER TABLE usuarios ADD COLUMN ultimo_plan TEXT DEFAULT NULL`, () => {});
      // Auto-crear usuario administrador y usuario de prueba si no existen
      inicializarUsuarioAdmin();
      inicializarUsuarioPrueba();
    }
  });

  // 2. Tabla de Historial con usuario_id
  db.run(`
    CREATE TABLE IF NOT EXISTS historial (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario_id INTEGER,
      fecha TEXT NOT NULL,
      comuna TEXT NOT NULL,
      tipo_inmueble TEXT,
      superficie_m2 REAL,
      dormitorios INTEGER,
      banos INTEGER,
      valor_referencia REAL NOT NULL,
      precio_unitario_promedio REAL,
      datos_entrada TEXT NOT NULL,
      resultado_ia TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
    )
  `, (err) => {
    if (err) {
      console.error('Error al crear tabla historial:', err.message);
    } else {
      // Migración defensiva: asegurar que exista columna usuario_id si la tabla ya existía
      db.all("PRAGMA table_info(historial)", (pragmaErr, columns) => {
        if (!pragmaErr && columns) {
          const tieneUsuarioId = columns.some(c => c.name === 'usuario_id');
          if (!tieneUsuarioId) {
            db.run("ALTER TABLE historial ADD COLUMN usuario_id INTEGER", (alterErr) => {
              if (alterErr) {
                console.error('Error al agregar columna usuario_id a historial:', alterErr.message);
              } else {
                console.log('Columna usuario_id agregada con éxito a tabla historial.');
              }
            });
          }
        }
      });
      console.log('Tabla historial verificada/creada correctamente.');
    }
  });
});

/**
 * Inserta automáticamente al administrador inicial si no existe
 */
function inicializarUsuarioAdmin() {
  const adminEmail = 'informatica.full@gmail.com';
  const queryCheck = `SELECT id FROM usuarios WHERE email = ?`;

  db.get(queryCheck, [adminEmail], (err, row) => {
    if (err) {
      console.error('Error al verificar usuario admin:', err.message);
      return;
    }
    if (!row) {
      const passwordHash = bcrypt.hashSync('admin123', 10);
      const queryInsert = `
        INSERT INTO usuarios (email, password, rol, creditos)
        VALUES (?, ?, 'admin', 9999)
      `;
      db.run(queryInsert, [adminEmail, passwordHash], function (insErr) {
        if (insErr) {
          console.error('Error al inicializar admin:', insErr.message);
        } else {
          console.log(`Usuario Administrador inicial creado con éxito: ${adminEmail} (9999 créditos)`);
        }
      });
    }
  });
}

/**
 * Inserta automáticamente al usuario de prueba (cliente@correo.cl / 123456) con 5 créditos si no existe
 */
function inicializarUsuarioPrueba() {
  const testEmail = 'cliente@correo.cl';
  const queryCheck = `SELECT id, creditos FROM usuarios WHERE email = ?`;

  db.get(queryCheck, [testEmail], (err, row) => {
    if (err) {
      console.error('Error al verificar usuario de prueba:', err.message);
      return;
    }
    const passwordHash = bcrypt.hashSync('123456', 10);
    if (!row) {
      const queryInsert = `
        INSERT INTO usuarios (email, password, rol, creditos)
        VALUES (?, ?, 'user', 5)
      `;
      db.run(queryInsert, [testEmail, passwordHash], function (insErr) {
        if (insErr) {
          console.error('Error al inicializar usuario de prueba:', insErr.message);
        } else {
          console.log(`Usuario de prueba inicial creado con éxito: ${testEmail} (Password: 123456, 5 créditos)`);
        }
      });
    } else {
      // Asegurar que la contraseña sea 123456 y tenga al menos 5 créditos para pruebas
      const creditosAsignar = row.creditos < 5 ? 5 : row.creditos;
      db.run(`UPDATE usuarios SET password = ?, creditos = ? WHERE email = ?`, [passwordHash, creditosAsignar, testEmail], (updateErr) => {
        if (!updateErr) {
          console.log(`Usuario de prueba actualizado: ${testEmail} (Password: 123456, Créditos: ${creditosAsignar})`);
        }
      });
    }
  });
}

/**
 * Registra un nuevo usuario con 0 créditos y contraseña encriptada
 */
function crearUsuario({ email, password, rol = 'user', creditos = 0 }) {
  return new Promise((resolve, reject) => {
    const passwordHash = bcrypt.hashSync(password, 10);
    const query = `
      INSERT INTO usuarios (email, password, rol, creditos)
      VALUES (?, ?, ?, ?)
    `;

    db.run(query, [email.toLowerCase().trim(), passwordHash, rol, creditos], function (err) {
      if (err) {
        return reject(err);
      }
      resolve({
        id: this.lastID,
        email: email.toLowerCase().trim(),
        rol,
        creditos
      });
    });
  });
}

/**
 * Obtiene usuario por email
 */
function obtenerUsuarioPorEmail(email) {
  return new Promise((resolve, reject) => {
    const query = `SELECT * FROM usuarios WHERE email = ?`;
    db.get(query, [email.toLowerCase().trim()], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

/**
 * Obtiene usuario por ID (sin contraseña)
 */
function obtenerUsuarioPorId(id) {
  return new Promise((resolve, reject) => {
    const query = `SELECT id, email, rol, creditos, nombre, picture, rol_profesional, fecha_registro FROM usuarios WHERE id = ?`;
    db.get(query, [id], (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

/**
 * Descuenta 1 crédito al usuario de forma atómica si tiene creditos > 0
 */
function descontarCredito(usuarioId) {
  return new Promise((resolve, reject) => {
    const query = `
      UPDATE usuarios 
      SET creditos = creditos - 1 
      WHERE id = ? AND creditos > 0
    `;
    db.run(query, [usuarioId], function (err) {
      if (err) return reject(err);
      resolve(this.changes > 0);
    });
  });
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
function modificarCreditosPorEmail(email, cantidad, accion = 'sumar', packNombre = null) {
  return new Promise(async (resolve, reject) => {
    try {
      const emailNorm = email.toLowerCase().trim();
      const cant = parseInt(cantidad, 10);
      if (isNaN(cant) || cant < 0) {
        return reject(new Error('La cantidad de créditos debe ser un número entero mayor o igual a 0.'));
      }

      const usuario = await obtenerUsuarioPorEmail(emailNorm);
      if (!usuario) {
        return resolve(null); // Usuario no encontrado
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

      let queryUpdate = `UPDATE usuarios SET creditos = ? WHERE id = ?`;
      let params = [nuevoSaldo, usuario.id];

      // Si la acción es 'sumar' y se indicó un pack, guardar en ultimo_plan
      let planGuardado = usuario.ultimo_plan;
      if (accion === 'sumar' && packNombre && packNombre.trim()) {
        const planLimpio = limpiarNombrePack(packNombre);
        queryUpdate = `UPDATE usuarios SET creditos = ?, ultimo_plan = ? WHERE id = ?`;
        params = [nuevoSaldo, planLimpio, usuario.id];
        planGuardado = planLimpio;
      }

      db.run(queryUpdate, params, function (err) {
        if (err) return reject(err);
        resolve({
          id: usuario.id,
          email: usuario.email,
          rol: usuario.rol,
          creditos: nuevoSaldo,
          saldoAnterior,
          accion,
          ultimo_plan: planGuardado,
          diferencia: nuevoSaldo - saldoAnterior
        });
      });
    } catch (e) {
      reject(e);
    }
  });
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
function guardarTasacion(data) {
  return new Promise((resolve, reject) => {
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
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    db.run(query, params, function (err) {
      if (err) {
        return reject(err);
      }
      resolve({ id: this.lastID, ...data });
    });
  });
}

/**
 * Obtiene el historial de tasaciones filtrado por usuario (o todas si es admin)
 */
function obtenerHistorial(usuarioId = null, esAdmin = false) {
  return new Promise((resolve, reject) => {
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
      query += ` WHERE usuario_id = ? `;
      params.push(usuarioId);
    }

    query += ` ORDER BY id DESC `;

    db.all(query, params, (err, rows) => {
      if (err) {
        return reject(err);
      }
      resolve(rows);
    });
  });
}

/**
 * Obtiene una tasación completa por ID (incluyendo JSONs)
 */
function obtenerTasacionPorId(id) {
  return new Promise((resolve, reject) => {
    const query = `SELECT * FROM historial WHERE id = ?`;

    db.get(query, [id], (err, row) => {
      if (err) {
        return reject(err);
      }
      if (!row) {
        return resolve(null);
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

      resolve(row);
    });
  });
}

/**
 * Obtiene o crea un usuario autenticado mediante Google OAuth 2.0
 * Si el email es informatica.full@gmail.com, asegura siempre rol 'admin'.
 */
function obtenerOCrearUsuarioGoogle({ email, nombre, picture }) {
  return new Promise((resolve, reject) => {
    const emailNorm = email.toLowerCase().trim();
    const esAdmin = emailNorm === 'informatica.full@gmail.com';

    const querySelect = `SELECT * FROM usuarios WHERE email = ?`;
    db.get(querySelect, [emailNorm], (err, row) => {
      if (err) return reject(err);

      if (row) {
        // Usuario ya existe: garantizar rol 'admin' si es el correo principal
        const nuevoRol = esAdmin ? 'admin' : (row.rol || 'user');
        const queryUpdate = `
          UPDATE usuarios 
          SET rol = ?,
              nombre = COALESCE(?, nombre),
              picture = COALESCE(?, picture)
          WHERE id = ?
        `;
        db.run(queryUpdate, [nuevoRol, nombre || null, picture || null, row.id], function (updErr) {
          if (updErr) return reject(updErr);
          resolve({
            id: row.id,
            email: emailNorm,
            rol: nuevoRol,
            creditos: row.creditos,
            nombre: nombre || row.nombre || '',
            picture: picture || row.picture || '',
            rol_profesional: row.rol_profesional || null,
            fecha_registro: row.fecha_registro
          });
        });
      } else {
        // Usuario nuevo: registrarlo automáticamente con 0 créditos (o 9999 si es admin)
        const rolInicial = esAdmin ? 'admin' : 'user';
        const creditosInicial = esAdmin ? 9999 : 0;
        const passwordDummy = bcrypt.hashSync(`google_oauth_${Date.now()}_${Math.random()}`, 10);

        const queryInsert = `
          INSERT INTO usuarios (email, password, rol, creditos, nombre, picture, rol_profesional)
          VALUES (?, ?, ?, ?, ?, ?, NULL)
        `;
        db.run(queryInsert, [emailNorm, passwordDummy, rolInicial, creditosInicial, nombre || '', picture || ''], function (insErr) {
          if (insErr) return reject(insErr);
          resolve({
            id: this.lastID,
            email: emailNorm,
            rol: rolInicial,
            creditos: creditosInicial,
            nombre: nombre || '',
            picture: picture || '',
            rol_profesional: null,
            fecha_registro: new Date().toISOString()
          });
        });
      }
    });
  });
}

/**
 * Actualiza el rol profesional de un usuario ('Particular', 'Corredor de Propiedades', 'Tasador Certificado')
 */
function actualizarRolProfesional(usuarioId, rolProfesional) {
  return new Promise((resolve, reject) => {
    const query = `
      UPDATE usuarios 
      SET rol_profesional = ? 
      WHERE id = ?
    `;
    db.run(query, [rolProfesional, usuarioId], function (err) {
      if (err) return reject(err);
      if (this.changes === 0) {
        return reject(new Error('Usuario no encontrado'));
      }
      obtenerUsuarioPorId(usuarioId).then(resolve).catch(reject);
    });
  });
}

/**
 * Actualiza el rol profesional de un usuario según su correo electrónico (Solo Administrador)
 */
function actualizarRolProfesionalPorEmail(email, rolProfesional) {
  return new Promise((resolve, reject) => {
    const emailNorm = email.toLowerCase().trim();
    const query = `
      UPDATE usuarios 
      SET rol_profesional = ? 
      WHERE email = ?
    `;
    db.run(query, [rolProfesional, emailNorm], function (err) {
      if (err) return reject(err);
      if (this.changes === 0) {
        return reject(new Error(`No se encontró ningún usuario con el correo ${emailNorm}`));
      }
      obtenerUsuarioPorEmail(emailNorm).then(resolve).catch(reject);
    });
  });
}

/**
 * Resetea el rol profesional a NULL para un usuario según su correo electrónico (Solo Administrador)
 */
function resetearRolProfesional(email) {
  return new Promise((resolve, reject) => {
    const emailNorm = email.toLowerCase().trim();
    const query = `
      UPDATE usuarios 
      SET rol_profesional = NULL 
      WHERE email = ?
    `;
    db.run(query, [emailNorm], function (err) {
      if (err) return reject(err);
      if (this.changes === 0) {
        return reject(new Error(`No se encontró ningún usuario con el correo ${emailNorm}`));
      }
      obtenerUsuarioPorEmail(emailNorm).then(resolve).catch(reject);
    });
  });
}

/**
 * Lista todos los usuarios registrados (para panel de administración)
 */
function listarUsuarios() {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT id, email, rol, creditos, nombre, picture, rol_profesional, ultimo_plan, fecha_registro
      FROM usuarios
      ORDER BY id DESC
    `;
    db.all(query, [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

/**
 * Elimina permanentemente a un usuario y sus registros asociados por email (Solo Admin)
 */
function eliminarUsuarioPorEmail(email) {
  return new Promise(async (resolve, reject) => {
    try {
      const emailNorm = email.toLowerCase().trim();
      const usuario = await obtenerUsuarioPorEmail(emailNorm);
      if (!usuario) {
        return resolve(null);
      }

      // 1. Eliminar historial de tasaciones asociado al usuario
      db.run(`DELETE FROM historial WHERE usuario_id = ?`, [usuario.id], (errHist) => {
        if (errHist) console.warn('[eliminarUsuario] Error no fatal al borrar historial:', errHist.message);

        // 2. Eliminar el usuario
        db.run(`DELETE FROM usuarios WHERE id = ?`, [usuario.id], function (errUser) {
          if (errUser) return reject(errUser);
          resolve({ id: usuario.id, email: usuario.email, eliminados: this.changes });
        });
      });
    } catch (e) {
      reject(e);
    }
  });
}

module.exports = {
  db,
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
