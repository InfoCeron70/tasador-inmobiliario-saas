/**
 * Tasador Inmobiliario IA - Frontend Application Logic (SaaS con Autenticación y Créditos)
 */

// Estado global de la aplicación
const AppState = {
  token: localStorage.getItem('tasador_token') || null,
  usuario: JSON.parse(localStorage.getItem('tasador_usuario') || 'null'),
  googleClientId: null,
  googleConfigurado: false,
  packSeleccionado: { nombre: 'Pack Profesional (3 informes)', precio: '$45.000 CLP' },
  comparables: [],
  ultimaTasacion: null,
  ultimoInmueble: null,
  maxComparables: 5,
  minComparables: 2,
  adminUsuariosCache: [],
  modalInformeMaximizado: false,
  monedaActiva: 'CLP',      // 'CLP' | 'UF' | 'USD'
  indicadores: null,         // { uf, usd, fecha } una vez cargado
  configMotor: JSON.parse(localStorage.getItem('tasador_config_motor') || 'null') || {
    margenErrorRangoPct: 8,
    factorMayorPlusvaliaPct: 3,
    factorMenorPlusvaliaPct: -3,
    factorAccesoDificilPct: -5
  }
};

// Formateador de moneda en pesos chilenos
const formatearMoneda = (val) => {
  return '$ ' + Math.round(Number(val) || 0).toLocaleString('es-CL');
};

// Formateador de miles chileno para inputs numéricos (agrega puntos automáticamente: 175000000 -> 175.000.000)
const formatearMilesInput = (val) => {
  if (val === null || val === undefined || val === '') return '';
  const soloDigitos = val.toString().replace(/\D/g, '');
  if (!soloDigitos) return '';
  const numero = parseInt(soloDigitos, 10);
  if (isNaN(numero)) return '';
  return numero.toLocaleString('es-CL');
};

// Limpia los puntos de miles y retorna el número entero limpio para cálculos y envío al backend
const desformatearMiles = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Math.round(val);
  const soloDigitos = val.toString().replace(/\D/g, '');
  return soloDigitos ? parseInt(soloDigitos, 10) : 0;
};

// Datos de ejemplo para prueba rápida (Mercado de Las Condes, Santiago)
const EJEMPLO_DATOS = {
  inmueble: {
    tipo: 'Departamento',
    direccion: 'Av. Las Condes 1234, Depto 502',
    superficie_m2: 85,
    dormitorios: 3,
    banos: 2,
    antiguedad: 5,
    estado_conservacion: 'Bueno',
    comuna: 'Las Condes',
    precio_referencia: 185000000,
    estacionamiento: 'Sí',
    bodega: 'Sí',
    piso: 5,
    ascensor: 'Sí',
    amenidades: 'Piscina, quincho, gimnasio'
  },
  comparables: [
    {
      superficie_m2: 80,
      precio_clp: 178000000,
      distancia_km: 0.3,
      entorno: 'Mismo barrio / Condominio',
      diferencia_nota: 'Sin bodega, orientación poniente'
    },
    {
      superficie_m2: 90,
      precio_clp: 198000000,
      distancia_km: 0.6,
      entorno: 'Zona de mayor plusvalía',
      diferencia_nota: 'Remodelado completo, piso alto'
    },
    {
      superficie_m2: 85,
      precio_clp: 183000000,
      distancia_km: 0.4,
      entorno: 'Mismo barrio / Condominio',
      diferencia_nota: 'Edificio similar con estacionamiento'
    }
  ]
};

// Inicialización cuando carga el DOM
document.addEventListener('DOMContentLoaded', async () => {
  inicializarComparables();
  configurarEventos();
  actualizarVisibilidadPisoAscensor();
  await cargarConfiguracionAuth();
  await verificarEstadoSesion();
});

// ========================================================
// 1. GESTIÓN DE SESIÓN Y AUTENTICACIÓN (GOOGLE OAUTH 2.0)
// ========================================================

/**
 * Consulta la configuración pública de autenticación al backend (Google Client ID)
 * Revisa primero si el servidor inyectó las variables directamente en window.__ENV__ o data-attribute
 */
async function cargarConfiguracionAuth() {
  const noticeBox = document.getElementById('googleConfigNotice');

  // 1. Detección inmediata desde variables inyectadas por el servidor
  const envServer = window.__ENV__ || {};
  const serverId = (envServer.GOOGLE_CLIENT_ID || document.body?.dataset?.googleClientId || '').trim();
  const serverConfigurado = Boolean(envServer.GOOGLE_CONFIGURADO || (serverId && !serverId.includes('tu_google_client_id')));

  if (serverConfigurado && serverId) {
    AppState.googleClientId = serverId;
    AppState.googleConfigurado = true;
    if (noticeBox) noticeBox.classList.add('hidden');
    inicializarGoogleIdentityServices();
    return;
  }

  // 2. Consulta de respaldo vía API (/api/auth/config)
  try {
    const res = await fetch('/api/auth/config');
    const data = await res.json();
    AppState.googleClientId = (data.googleClientId || '').trim();
    AppState.googleConfigurado = Boolean(data.configurado && AppState.googleClientId);

    if (!AppState.googleConfigurado) {
      if (noticeBox) noticeBox.classList.remove('hidden');
    } else {
      if (noticeBox) noticeBox.classList.add('hidden');
      inicializarGoogleIdentityServices();
    }
  } catch (err) {
    console.warn('No se pudo verificar la configuración de Google OAuth:', err);
  }
}

/**
 * Inicializa el SDK de Google Identity Services (GIS)
 */
function inicializarGoogleIdentityServices() {
  if (!AppState.googleConfigurado || !AppState.googleClientId) return;

  if (!window.google?.accounts?.id) {
    // Si el script de Google aún no termina de cargar, reintentar en 250ms
    setTimeout(inicializarGoogleIdentityServices, 250);
    return;
  }

  try {
    window.google.accounts.id.initialize({
      client_id: AppState.googleClientId,
      callback: manejarRespuestaGoogle,
      auto_select: false,
      cancel_on_tap_outside: true
    });

    // Renderizar botón oficial de Google en contenedor
    const container = document.getElementById('googleGsiBtnContainer');
    if (container) {
      window.google.accounts.id.renderButton(container, {
        theme: 'outline',
        size: 'large',
        type: 'standard',
        shape: 'pill',
        text: 'continue_with',
        logo_alignment: 'left',
        width: 320
      });
    }
  } catch (err) {
    console.error('Error al inicializar Google Identity Services:', err);
  }
}

/**
 * Acción al presionar el botón "Continuar con Google"
 */
function ejecutarLoginGoogle() {
  const errorBox = document.getElementById('authErrorBox');
  if (errorBox) errorBox.classList.add('hidden');

  if (!AppState.googleConfigurado || !AppState.googleClientId) {
    mostrarErrorAuth('⚠️ GOOGLE_CLIENT_ID aún no configurado en el archivo .env. Por favor agrégalo o usa el acceso de desarrollo abajo.');
    return;
  }

  if (!window.google?.accounts?.id) {
    mostrarErrorAuth('Cargando servicios de Google... por favor espera un momento y vuelve a intentar.');
    return;
  }

  // Si el botón oficial de Google fue renderizado, simular click para abrir popup nativo
  const gsiBtn = document.querySelector('#googleGsiBtnContainer div[role="button"]');
  if (gsiBtn) {
    gsiBtn.click();
  } else {
    // Alternativa: invocar prompt
    window.google.accounts.id.prompt((notification) => {
      if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
        console.warn('Google One Tap no disponible, reintentando render');
        inicializarGoogleIdentityServices();
      }
    });
  }
}

/**
 * Procesa la respuesta de Google con el ID Token y solicita sesión al Backend
 */
async function manejarRespuestaGoogle(response) {
  const idToken = response.credential;
  if (!idToken) {
    mostrarErrorAuth('No se recibió la credencial de autenticación de Google.');
    return;
  }

  mostrarCargandoGoogle(true);

  try {
    const res = await fetch('/api/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Error al autenticar con Google.');
    }

    // Guardar sesión en localStorage y estado
    AppState.token = data.token;
    AppState.usuario = data.usuario;
    localStorage.setItem('tasador_token', data.token);
    localStorage.setItem('tasador_usuario', JSON.stringify(data.usuario));

    // Cambiar a la vista principal
    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('mainAppSection').classList.remove('hidden');

    actualizarHeaderUsuario();

    const tieneRol = usuarioTieneRol(data.usuario);
    if (!tieneRol) {
      bloquearFormularioPorRol(true);
    } else {
      bloquearFormularioPorRol(false);
      cargarHistorialContador();
    }

    // Si la URL actual es /admin o #admin, gestionar navegación según permisos
    const esAdmin = Boolean(data.usuario && (data.usuario.rol === 'admin' || data.usuario.email === 'informatica.full@gmail.com'));
    if (window.location.pathname === '/admin' || window.location.hash === '#admin') {
      if (esAdmin) {
        abrirVistaAdmin(false);
      } else {
        cerrarVistaAdmin(true);
      }
    }

  } catch (error) {
    mostrarErrorAuth(error.message);
  } finally {
    mostrarCargandoGoogle(false);
  }
}

/**
 * Controla el spinner de carga de autenticación con Google
 */
function mostrarCargandoGoogle(cargando) {
  const loading = document.getElementById('googleAuthLoading');
  const btnGoogle = document.getElementById('btnContinuarGoogle');
  if (loading) {
    if (cargando) loading.classList.remove('hidden');
    else loading.classList.add('hidden');
  }
  if (btnGoogle) {
    btnGoogle.disabled = cargando;
    btnGoogle.classList.toggle('opacity-75', cargando);
  }
}

/**
 * Acceso rápido de desarrollo para testing inmediato sin requerir ventana emergente
 */
async function ejecutarLoginRapido(email, password) {
  mostrarCargandoGoogle(true);
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error en login rápido.');

    AppState.token = data.token;
    AppState.usuario = data.usuario;
    localStorage.setItem('tasador_token', data.token);
    localStorage.setItem('tasador_usuario', JSON.stringify(data.usuario));

    document.getElementById('authSection').classList.add('hidden');
    document.getElementById('mainAppSection').classList.remove('hidden');

    actualizarHeaderUsuario();

    const tieneRol = usuarioTieneRol(data.usuario);
    if (!tieneRol) {
      bloquearFormularioPorRol(true);
    } else {
      bloquearFormularioPorRol(false);
      cargarHistorialContador();
    }

    // Si la URL actual es /admin o #admin, gestionar navegación según permisos
    const esAdmin = Boolean(data.usuario && (data.usuario.rol === 'admin' || data.usuario.email === 'informatica.full@gmail.com'));
    if (window.location.pathname === '/admin' || window.location.hash === '#admin') {
      if (esAdmin) {
        abrirVistaAdmin(false);
      } else {
        cerrarVistaAdmin(true);
      }
    }
  } catch (err) {
    mostrarErrorAuth(err.message);
  } finally {
    mostrarCargandoGoogle(false);
  }
}

/**
 * Verifica si hay una sesión activa con token válido
 */
async function verificarEstadoSesion() {
  const authSection = document.getElementById('authSection');
  const mainAppSection = document.getElementById('mainAppSection');

  if (!AppState.token) {
    authSection.classList.remove('hidden');
    mainAppSection.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch('/api/auth/perfil', {
      headers: {
        'Authorization': `Bearer ${AppState.token}`
      }
    });

    if (res.ok) {
      const data = await res.json();
      AppState.usuario = data.usuario;
      localStorage.setItem('tasador_usuario', JSON.stringify(data.usuario));

      // Mostrar interfaz de aplicación
      authSection.classList.add('hidden');
      mainAppSection.classList.remove('hidden');

      actualizarHeaderUsuario();

      const tieneRol = usuarioTieneRol(data.usuario);
      if (!tieneRol) {
        bloquearFormularioPorRol(true);
      } else {
        bloquearFormularioPorRol(false);
        cargarHistorialContador();
      }

      // Verificación de ruta /admin o #admin al iniciar la app
      const esAdmin = Boolean(data.usuario && (data.usuario.rol === 'admin' || data.usuario.email === 'informatica.full@gmail.com'));
      if (window.location.pathname === '/admin' || window.location.hash === '#admin') {
        if (esAdmin) {
          abrirVistaAdmin(false);
        } else {
          cerrarVistaAdmin(true);
        }
      }
    } else {
      // Token inválido o expirado
      cerrarSesion();
    }
  } catch (error) {
    console.warn('Error al verificar sesión:', error);
    if (AppState.usuario) {
      authSection.classList.add('hidden');
      mainAppSection.classList.remove('hidden');
      actualizarHeaderUsuario();
      const tieneRol = usuarioTieneRol(AppState.usuario);
      if (!tieneRol) {
        bloquearFormularioPorRol(true);
      } else {
        bloquearFormularioPorRol(false);
      }
      const esAdmin = Boolean(AppState.usuario && (AppState.usuario.rol === 'admin' || AppState.usuario.email === 'informatica.full@gmail.com'));
      if (window.location.pathname === '/admin' || window.location.hash === '#admin') {
        if (esAdmin) {
          abrirVistaAdmin(false);
        } else {
          cerrarVistaAdmin(true);
        }
      }
    } else {
      cerrarSesion();
    }
  }
}

/**
 * Actualiza la información del usuario en el Header (Avatar, Nombre/Email, Rol Profesional, Créditos, Admin)
 */
function actualizarHeaderUsuario() {
  if (!AppState.usuario) return;

  const emailDisplay = document.getElementById('userEmailDisplay');
  const avatarDisplay = document.getElementById('userAvatarDisplay');
  const creditsBadge = document.getElementById('userCreditsBadge');
  const creditsBanner = document.getElementById('userCreditsBanner');
  const btnAdmin = document.getElementById('btnOpenAdminModal');
  const btnBadgeRol = document.getElementById('btnBadgeRol');
  const badgeRolTexto = document.getElementById('badgeRolTexto');
  const badgeRolIcon = document.getElementById('badgeRolIcon');

  if (emailDisplay) {
    emailDisplay.textContent = AppState.usuario.nombre || AppState.usuario.email;
    emailDisplay.title = `${AppState.usuario.nombre ? AppState.usuario.nombre + ' (' + AppState.usuario.email + ')' : AppState.usuario.email}`;
  }

  if (avatarDisplay) {
    if (AppState.usuario.picture) {
      avatarDisplay.src = AppState.usuario.picture;
      avatarDisplay.classList.remove('hidden');
    } else {
      avatarDisplay.classList.add('hidden');
    }
  }

  if (creditsBadge) creditsBadge.textContent = AppState.usuario.creditos;
  if (creditsBanner) creditsBanner.textContent = AppState.usuario.creditos;

  // Badge de rol profesional en el Header
  if (btnBadgeRol && badgeRolTexto) {
    if (usuarioTieneRol(AppState.usuario)) {
      const iconos = {
        'Particular': '🏠',
        'Corredor de Propiedades': '💼',
        'Tasador Certificado': '📊'
      };
      badgeRolTexto.textContent = AppState.usuario.rol_profesional;
      if (badgeRolIcon) badgeRolIcon.textContent = iconos[AppState.usuario.rol_profesional] || '👤';
      btnBadgeRol.classList.remove('hidden');
    } else {
      btnBadgeRol.classList.add('hidden');
    }
  }

  // Si es administrador o informatica.full@gmail.com, mostrar botón Panel Admin
  const esAdmin = AppState.usuario.rol === 'admin' || AppState.usuario.email === 'informatica.full@gmail.com';
  if (btnAdmin) {
    if (esAdmin) {
      btnAdmin.classList.remove('hidden');
    } else {
      btnAdmin.classList.add('hidden');
    }
  }

  // Botón de configuración de motor: ÚNICAMENTE si rol_profesional es 'Tasador' / 'Tasador Certificado'
  // El Admin NO tiene bypass aquí: si cambia a 'Particular' o 'Corredor', este botón se oculta de inmediato.
  const rolProf = (AppState.usuario.rol_profesional || '').trim().toLowerCase();
  const esTasador = rolProf.includes('tasador');
  const btnConfigMotor = document.getElementById('btnConfigMotorHeader');
  if (btnConfigMotor) {
    if (esTasador) {
      btnConfigMotor.classList.remove('hidden');
    } else {
      btnConfigMotor.classList.add('hidden');
    }
  }

  // Actualizar permisos y visibilidad de funciones según el nivel del rol (Excel, Sugerir IA)
  actualizarPermisosSegunRol();
}

/**
 * Controla la visibilidad y disponibilidad de funciones según el nivel de rol profesional:
 * - Nivel 1 (Particular): Solo PDF. Excel y Sugerir Comparables con IA ocultos.
 * - Nivel 2 (Corredor): PDF, Excel, Sugerir Comparables con IA e Historial.
 * - Nivel 3 (Tasador): Todo lo de Corredor + Motor de Tasación PRO.
 * - Administrador (informatica.full@gmail.com): Acceso total a todo (para pruebas).
 */
function actualizarPermisosSegunRol() {
  if (!AppState.usuario) return;

  const esAdmin = Boolean(AppState.usuario.rol === 'admin' || AppState.usuario.email === 'informatica.full@gmail.com');
  const rolProf = (AppState.usuario.rol_profesional || '').trim().toLowerCase();

  // El Administrador tiene acceso a todo para pruebas, sin importar el rol del badge
  // Corredor y Tasador tienen acceso a Excel y Sugerencia con IA
  const puedeExcel = esAdmin || rolProf.includes('corredor') || rolProf.includes('tasador');
  const puedeIA = esAdmin || rolProf.includes('corredor') || rolProf.includes('tasador');

  // 1. Botón "✨ Sugerir Comparables con IA"
  const btnSugerir = document.getElementById('btnSugerirComparables');
  if (btnSugerir) {
    if (puedeIA) {
      btnSugerir.classList.remove('hidden');
    } else {
      btnSugerir.classList.add('hidden');
    }
  }

  // 2. Botón Excel en la tarjeta rápida de resultados (#btnCompactoExcel)
  const btnCompactoExcel = document.getElementById('btnCompactoExcel');
  if (btnCompactoExcel) {
    if (puedeExcel) {
      btnCompactoExcel.classList.remove('hidden');
    } else {
      btnCompactoExcel.classList.add('hidden');
    }
  }

  // Ajustar la grilla de acciones rápidas (2 columnas si Excel está activo, 1 si solo está PDF)
  const gridAcciones = btnCompactoExcel?.parentElement;
  if (gridAcciones) {
    if (puedeExcel) {
      gridAcciones.className = 'pt-3 border-t border-slate-800 grid grid-cols-2 gap-2';
    } else {
      gridAcciones.className = 'pt-3 border-t border-slate-800 grid grid-cols-1 gap-2';
    }
  }

  // 3. Botón Excel en el Modal de Informe Completo (#btnModalExcel)
  const btnModalExcel = document.getElementById('btnModalExcel');
  if (btnModalExcel) {
    if (puedeExcel) {
      btnModalExcel.classList.remove('hidden');
    } else {
      btnModalExcel.classList.add('hidden');
    }
  }
}

/**
 * Cierra la sesión del usuario y regresa a la pantalla de Login
 */
function cerrarSesion() {
  AppState.token = null;
  AppState.usuario = null;
  localStorage.removeItem('tasador_token');
  localStorage.removeItem('tasador_usuario');

  document.getElementById('authSection').classList.remove('hidden');
  document.getElementById('mainAppSection').classList.add('hidden');
  document.getElementById('adminViewSection')?.classList.add('hidden');
  document.getElementById('modalAdmin')?.classList.add('hidden');
  document.getElementById('modalHistorial')?.classList.add('hidden');
  document.getElementById('modalInformeCompleto')?.classList.add('hidden');
  document.getElementById('modalAyudaComparables')?.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');

  if (window.location.pathname === '/admin') {
    history.replaceState({ vista: 'app' }, 'Tasador Inmobiliario IA', '/');
  }
  const modalRol = document.getElementById('modalOnboardingRol');
  if (modalRol) {
    modalRol.classList.add('hidden');
    modalRol.classList.remove('flex');
  }
  const modalBloqueado = document.getElementById('modalRolBloqueado');
  if (modalBloqueado) {
    modalBloqueado.classList.add('hidden');
    modalBloqueado.classList.remove('flex');
  }
  const modalMotor = document.getElementById('modalConfigMotor');
  if (modalMotor) {
    modalMotor.classList.add('hidden');
    modalMotor.classList.remove('flex');
  }
  const modalReset = document.getElementById('modalConfirmarResetRol');
  if (modalReset) {
    modalReset.classList.add('hidden');
    modalReset.classList.remove('flex');
  }
  const modalEliminar = document.getElementById('modalConfirmarEliminarUsuario');
  if (modalEliminar) {
    modalEliminar.classList.add('hidden');
    modalEliminar.classList.remove('flex');
  }
  const modalCambiarRol = document.getElementById('modalAdminCambiarRol');
  if (modalCambiarRol) {
    modalCambiarRol.classList.add('hidden');
    modalCambiarRol.classList.remove('flex');
  }
  const modalManual = document.getElementById('modalManualAdmin');
  if (modalManual) {
    modalManual.classList.add('hidden');
    modalManual.classList.remove('flex');
  }
  const modalGuia = document.getElementById('modalGuiaUsuario');
  if (modalGuia) {
    modalGuia.classList.add('hidden');
    modalGuia.classList.remove('flex');
  }

  // Restaurar estado base de bloqueo de formulario
  const contenido = document.getElementById('contenidoPrincipalTasacion');
  if (contenido) {
    contenido.classList.add('hidden');
    contenido.style.setProperty('display', 'none', 'important');
  }
  const banner = document.getElementById('bannerBloqueoRol');
  if (banner) {
    banner.classList.add('hidden');
    banner.classList.remove('flex');
    banner.style.setProperty('display', 'none', 'important');
  }
}

/**
 * ========================================================
 * LÓGICA DE ROL PROFESIONAL Y ONBOARDING
 * ========================================================
 */

/**
 * Verifica si un objeto usuario tiene un rol profesional válido asignado
 */
function usuarioTieneRol(usuario) {
  if (!usuario) return false;
  const rol = (usuario.rol_profesional || '').toString().trim();
  return Boolean(rol && rol !== 'null' && rol !== 'undefined');
}

/**
 * Bloquea u oculta el formulario de tasación mientras el usuario no tenga un rol profesional definido
 */
function bloquearFormularioPorRol(bloquear) {
  const contenido = document.getElementById('contenidoPrincipalTasacion');
  const banner = document.getElementById('bannerBloqueoRol');

  if (bloquear) {
    if (contenido) {
      contenido.classList.add('hidden');
      contenido.style.setProperty('display', 'none', 'important');
    }
    if (banner) {
      banner.classList.remove('hidden');
      banner.classList.add('flex');
      banner.style.removeProperty('display');
    }
    abrirModalRol(true);
  } else {
    if (contenido) {
      contenido.classList.remove('hidden');
      contenido.style.removeProperty('display');
    }
    if (banner) {
      banner.classList.add('hidden');
      banner.classList.remove('flex');
      banner.style.setProperty('display', 'none', 'important');
    }
  }
}

/**
 * Verifica si el usuario necesita completar el onboarding obligatorio de rol profesional
 */
function verificarOnboardingRol() {
  if (!AppState.usuario) return;
  const tieneRol = usuarioTieneRol(AppState.usuario);
  bloquearFormularioPorRol(!tieneRol);
}

/**
 * Abre el modal de selección de rol profesional
 * @param {boolean} obligatorio - Si es true, oculta el botón de cierre
 */
function abrirModalRol(obligatorio = false) {
  const modal = document.getElementById('modalOnboardingRol');
  const btnCerrar = document.getElementById('btnCerrarModalRol');
  const alerta = document.getElementById('alertaRolModal');
  if (!modal) return;

  // Limpiar cualquier alerta previa de restricción
  if (alerta) alerta.classList.add('hidden');

  if (btnCerrar) {
    if (obligatorio) {
      btnCerrar.classList.add('hidden');
    } else {
      btnCerrar.classList.remove('hidden');
    }
  }

  // Título dinámico según contexto (Onboarding de bienvenida o cambio posterior)
  const titulo = document.getElementById('tituloModalRol');
  const subtitulo = document.getElementById('subtituloModalRol');
  if (titulo && subtitulo) {
    if (obligatorio) {
      titulo.textContent = '¡Bienvenido a Tasador IA!';
      subtitulo.textContent = 'Selecciona tu perfil profesional para calibrar tus herramientas e informes';
    } else {
      titulo.textContent = 'Jerarquía de Perfiles Profesionales';
      subtitulo.textContent = 'Selecciona tu nivel de acceso para personalizar tus herramientas e informes';
    }
  }

  const esAdmin = Boolean(AppState.usuario && (AppState.usuario.rol === 'admin' || AppState.usuario.email === 'informatica.full@gmail.com'));
  const rolActual = AppState.usuario?.rol_profesional;

  // Adaptar visualmente la tarjeta de Nivel 3: Tasador Certificado
  const btnTasador = document.getElementById('btnRolTasador');
  const iconoCandado = document.getElementById('iconoCandadoTasador');
  const badgeTasador = document.getElementById('badgeNivelTasador');

  if (btnTasador) {
    if (esAdmin) {
      btnTasador.classList.remove('opacity-60', 'bg-slate-100/90', 'border-slate-300');
      btnTasador.classList.add('cursor-pointer', 'border-slate-200');
      btnTasador.title = 'Nivel 3 desbloqueado para Administrador';
      if (iconoCandado) iconoCandado.classList.add('hidden');
      if (badgeTasador) {
        badgeTasador.textContent = 'PRO • Admin';
        badgeTasador.className = 'text-[10px] font-semibold uppercase tracking-wider text-purple-700 bg-purple-50 px-2.5 py-0.5 rounded-full border border-purple-200';
      }
    } else {
      btnTasador.classList.add('opacity-60', 'bg-slate-100/90', 'border-slate-300');
      btnTasador.title = '🔒 Rol bloqueado: Requiere validación del Administrador';
      if (iconoCandado) iconoCandado.classList.remove('hidden');
      if (badgeTasador) {
        badgeTasador.textContent = '🔒 Requiere Validación';
        badgeTasador.className = 'text-[10px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full border border-amber-300';
      }
    }
  }

  // Marcar visualmente la opción actualmente seleccionada si existe
  document.querySelectorAll('.btnOpcionRol').forEach(btn => {
    const rol = btn.dataset.rol;
    if (rolActual && rol === rolActual) {
      btn.classList.add('border-indigo-600', 'bg-indigo-50/70', 'ring-2', 'ring-indigo-300');
    } else {
      btn.classList.remove('border-indigo-600', 'bg-indigo-50/70', 'ring-2', 'ring-indigo-300');
    }
  });

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

/**
 * Abre el modal elegante de advertencia cuando un usuario sin permisos intenta acceder a Tasador PRO
 */
function abrirModalRolBloqueado() {
  const modal = document.getElementById('modalRolBloqueado');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

/**
 * Cierra el modal de rol bloqueado manteniendo al usuario en su rol previo
 */
function cerrarModalRolBloqueado() {
  const modal = document.getElementById('modalRolBloqueado');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

/**
 * Cierra el modal de rol profesional sólo si el usuario ya cuenta con un rol asignado
 */
function cerrarModalRol(forzar = false) {
  if (!forzar && !usuarioTieneRol(AppState.usuario)) return;
  const modal = document.getElementById('modalOnboardingRol');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

/**
 * Guarda el rol profesional seleccionado enviando petición POST a /api/auth/rol
 */
async function guardarRolProfesional(rol) {
  if (!AppState.token) return;

  const spinner = document.getElementById('rolGuardandoSpinner');
  if (spinner) spinner.classList.remove('hidden');

  try {
    const res = await fetch('/api/auth/rol', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify({ rol_profesional: rol })
    });

    const data = await res.json();
    if (!res.ok) {
      if (res.status === 403 || (data.error && data.error.includes('validación'))) {
        abrirModalRolBloqueado();
      } else {
        const alerta = document.getElementById('alertaRolModal');
        const alertaTexto = document.getElementById('alertaRolTexto');
        if (alerta && alertaTexto) {
          alertaTexto.innerHTML = data.error || 'No se pudo guardar el rol profesional.';
          alerta.classList.remove('hidden');
        }
      }
      return;
    }

    if (data.usuario) {
      AppState.usuario = {
        ...AppState.usuario,
        ...data.usuario,
        rol_profesional: rol,
        requiere_rol: false
      };
      localStorage.setItem('tasador_usuario', JSON.stringify(AppState.usuario));
    }

    // Desbloquear formulario, cerrar modal y actualizar vistas
    bloquearFormularioPorRol(false);
    cerrarModalRol(true);
    actualizarHeaderUsuario();
    cargarHistorialContador();

  } catch (error) {
    console.error('Error al guardar rol profesional:', error);
    const alerta = document.getElementById('alertaRolModal');
    const alertaTexto = document.getElementById('alertaRolTexto');
    if (alerta && alertaTexto) {
      alertaTexto.textContent = 'Error: ' + error.message;
      alerta.classList.remove('hidden');
    }
  } finally {
    if (spinner) spinner.classList.add('hidden');
  }
}

/**
 * ========================================================
 * CONFIGURACIÓN AVANZADA DEL MOTOR (EXCLUSIVO TASADOR CERTIFICADO)
 * ========================================================
 */

function abrirModalConfigMotor() {
  const rolProf = (AppState.usuario?.rol_profesional || '').trim().toLowerCase();
  const esTasador = rolProf.includes('tasador');
  if (!esTasador) return;

  const modal = document.getElementById('modalConfigMotor');
  if (!modal) return;

  const cfg = AppState.configMotor || {
    margenErrorRangoPct: 8,
    factorMayorPlusvaliaPct: 3,
    factorMenorPlusvaliaPct: -3,
    factorAccesoDificilPct: -5
  };

  const inputMargen = document.getElementById('cfgMargenError');
  const inputMayor = document.getElementById('cfgMayorPlusvalia');
  const inputMenor = document.getElementById('cfgMenorPlusvalia');
  const inputAcceso = document.getElementById('cfgAccesoDificil');

  if (inputMargen) inputMargen.value = cfg.margenErrorRangoPct ?? 8;
  if (inputMayor) inputMayor.value = cfg.factorMayorPlusvaliaPct ?? 3;
  if (inputMenor) inputMenor.value = cfg.factorMenorPlusvaliaPct ?? -3;
  if (inputAcceso) inputAcceso.value = cfg.factorAccesoDificilPct ?? -5;

  const msgExito = document.getElementById('msgExitoConfigMotor');
  if (msgExito) msgExito.classList.add('hidden');

  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function cerrarModalConfigMotor() {
  const modal = document.getElementById('modalConfigMotor');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function guardarConfigMotor() {
  const margen = parseFloat(document.getElementById('cfgMargenError')?.value);
  const mayor = parseFloat(document.getElementById('cfgMayorPlusvalia')?.value);
  const menor = parseFloat(document.getElementById('cfgMenorPlusvalia')?.value);
  const acceso = parseFloat(document.getElementById('cfgAccesoDificil')?.value);

  AppState.configMotor = {
    margenErrorRangoPct: isNaN(margen) ? 8 : margen,
    factorMayorPlusvaliaPct: isNaN(mayor) ? 3 : mayor,
    factorMenorPlusvaliaPct: isNaN(menor) ? -3 : menor,
    factorAccesoDificilPct: isNaN(acceso) ? -5 : acceso
  };

  localStorage.setItem('tasador_config_motor', JSON.stringify(AppState.configMotor));

  const msgExito = document.getElementById('msgExitoConfigMotor');
  if (msgExito) {
    msgExito.classList.remove('hidden');
    setTimeout(() => {
      msgExito.classList.add('hidden');
      cerrarModalConfigMotor();
    }, 900);
  } else {
    cerrarModalConfigMotor();
  }
}

function resetearConfigMotor() {
  const inputMargen = document.getElementById('cfgMargenError');
  const inputMayor = document.getElementById('cfgMayorPlusvalia');
  const inputMenor = document.getElementById('cfgMenorPlusvalia');
  const inputAcceso = document.getElementById('cfgAccesoDificil');

  if (inputMargen) inputMargen.value = 8;
  if (inputMayor) inputMayor.value = 3;
  if (inputMenor) inputMenor.value = -3;
  if (inputAcceso) inputAcceso.value = -5;
}

function mostrarErrorAuth(mensaje) {
  const errorBox = document.getElementById('authErrorBox');
  const errorMsg = document.getElementById('authErrorMsg');
  if (errorBox && errorMsg) {
    errorMsg.textContent = mensaje;
    errorBox.classList.remove('hidden');
  }
}

// ========================================================
// 2. GESTIÓN DE COMPARABLES DINÁMICOS
// ========================================================

/**
 * Inicializa la lista de comparables con 3 tarjetas vacías
 */
function inicializarComparables() {
  AppState.comparables = [
    { superficie_m2: '', precio_clp: '', distancia_km: '', entorno: 'Mismo barrio / Condominio', diferencia_nota: '' },
    { superficie_m2: '', precio_clp: '', distancia_km: '', entorno: 'Mismo barrio / Condominio', diferencia_nota: '' },
    { superficie_m2: '', precio_clp: '', distancia_km: '', entorno: 'Mismo barrio / Condominio', diferencia_nota: '' }
  ];
  renderizarComparables();
}

/**
 * Renderiza dinámicamente las tarjetas de comparables en el DOM
 */
function renderizarComparables() {
  const contenedor = document.getElementById('contenedorComparables');
  const countSpan = document.getElementById('countComparables');
  const btnAgregar = document.getElementById('btnAgregarComparable');

  if (!contenedor) return;

  const count = AppState.comparables.length;
  const max = AppState.maxComparables;
  const esMaximo = count >= max;

  if (btnAgregar) {
    btnAgregar.disabled = esMaximo;
    const btnTexto = document.getElementById('btnAgregarTexto');
    const badge = document.getElementById('badgeComparables');
    const icon = document.getElementById('iconAgregarComparable');

    if (esMaximo) {
      btnAgregar.classList.remove('bg-blue-600', 'hover:bg-blue-500');
      btnAgregar.classList.add('bg-slate-700', 'text-slate-400', 'opacity-60', 'cursor-not-allowed');
      if (btnTexto) btnTexto.textContent = 'Máximo de comparables';
      if (badge) {
        badge.className = 'inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-bold font-mono bg-slate-800 text-slate-300 border border-slate-600';
        badge.innerHTML = `<span id="countComparables">${count}</span>/${max}`;
      }
      if (icon) icon.classList.add('hidden');
    } else {
      btnAgregar.classList.remove('bg-slate-700', 'text-slate-400', 'opacity-60', 'cursor-not-allowed');
      btnAgregar.classList.add('bg-blue-600', 'hover:bg-blue-500');
      if (btnTexto) btnTexto.textContent = 'Agregar Comparable';
      if (badge) {
        badge.className = 'inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-bold font-mono bg-blue-800/80 text-blue-100 border border-blue-400/40';
        badge.innerHTML = `<span id="countComparables">${count}</span>/${max}`;
      }
      if (icon) icon.classList.remove('hidden');
    }
  }

  contenedor.innerHTML = '';

  AppState.comparables.forEach((comp, idx) => {
    const card = document.createElement('div');
    card.className = 'bg-slate-800/90 border border-slate-700/80 rounded-xl p-3.5 sm:p-4 transition duration-150';

    const puedeEliminar = AppState.comparables.length > AppState.minComparables;
    const entornoActual = comp.entorno || 'Mismo barrio / Condominio';

    card.innerHTML = `
      <div class="flex items-center justify-between pb-2 mb-3 border-b border-slate-700/60">
        <span class="text-xs sm:text-sm font-bold uppercase tracking-wider text-white flex items-center gap-2">
          <span class="w-6 h-6 rounded-full bg-blue-600 text-white shadow-sm flex items-center justify-center text-xs font-black shrink-0">
            ${idx + 1}
          </span>
          Comparable ${idx + 1}
        </span>
        ${
          puedeEliminar
            ? `<button type="button" class="btnEliminarComp text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 transition p-0.5" data-index="${idx}">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                </svg>
                Quitar
              </button>`
            : '<span class="text-[11px] text-slate-500">Mínimo 2 requeridos</span>'
        }
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3 mb-2.5 sm:mb-3">
        <div>
          <label class="block text-[11px] font-medium text-slate-300 mb-1">Superficie (m²) *</label>
          <input type="number" step="0.5" min="1" placeholder="Ej: 80" required value="${comp.superficie_m2}" data-field="superficie_m2" data-index="${idx}" class="inputComparable w-full bg-white text-slate-900 placeholder:text-slate-400 placeholder-slate-400 text-xs rounded-lg px-2.5 py-1.5 border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium">
        </div>

        <div>
          <label class="block text-[11px] font-medium text-slate-300 mb-1">Precio CLP ($) *</label>
          <input type="text" inputmode="numeric" placeholder="Ej: 175.000.000" required value="${formatearMilesInput(comp.precio_clp)}" data-field="precio_clp" data-index="${idx}" class="inputComparable w-full bg-white text-slate-900 placeholder:text-slate-400 placeholder-slate-400 text-xs rounded-lg px-2.5 py-1.5 border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium font-mono-numbers">
        </div>

        <div>
          <label class="block text-[11px] font-medium text-slate-300 mb-1">Distancia (km) *</label>
          <input type="number" step="0.1" min="0" placeholder="Ej: 0.5" required value="${comp.distancia_km}" data-field="distancia_km" data-index="${idx}" class="inputComparable w-full bg-white text-slate-900 placeholder:text-slate-400 placeholder-slate-400 text-xs rounded-lg px-2.5 py-1.5 border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium">
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
        <div>
          <label class="block text-[11px] font-medium text-slate-300 mb-1 flex items-center justify-between">
            <span class="text-slate-200">Entorno del Comparable *</span>
            <span class="text-xs font-bold text-amber-400 tracking-wide flex items-center gap-1">
              <span>✦</span> Ajuste plusvalía
            </span>
          </label>
          <select data-field="entorno" data-index="${idx}" class="inputComparable w-full bg-white text-slate-900 text-xs rounded-lg px-2.5 py-1.5 border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400 font-medium">
            <option value="Mismo barrio / Condominio" ${entornoActual === 'Mismo barrio / Condominio' ? 'selected' : ''}>Mismo barrio / Condominio</option>
            <option value="Zona de mayor plusvalía" ${entornoActual === 'Zona de mayor plusvalía' ? 'selected' : ''}>Zona de mayor plusvalía</option>
            <option value="Zona de menor plusvalía" ${entornoActual === 'Zona de menor plusvalía' ? 'selected' : ''}>Zona de menor plusvalía</option>
            <option value="Acceso difícil / Periférico" ${entornoActual === 'Acceso difícil / Periférico' ? 'selected' : ''}>Acceso difícil / Periférico</option>
          </select>
        </div>

        <div>
          <label class="block text-[11px] font-medium text-slate-300 mb-1">Diferencia / Nota relevante (opcional)</label>
          <input type="text" placeholder="Ej: Sin estacionamiento, vista despejada..." value="${comp.diferencia_nota || ''}" data-field="diferencia_nota" data-index="${idx}" class="inputComparable w-full bg-white text-slate-900 placeholder:text-slate-400 placeholder-slate-400 text-xs rounded-lg px-2.5 py-1.5 border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-400">
        </div>
      </div>
    `;

    contenedor.appendChild(card);
  });

  // Listeners a inputs y selects de comparables
  document.querySelectorAll('.inputComparable').forEach(input => {
    const handleUpdate = (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      const field = e.target.dataset.field;
      if (AppState.comparables[idx]) {
        if (field === 'precio_clp') {
          const valLimpio = e.target.value.replace(/\D/g, '');
          if (!valLimpio) {
            e.target.value = '';
            AppState.comparables[idx][field] = '';
          } else {
            const formateado = formatearMilesInput(valLimpio);
            e.target.value = formateado;
            AppState.comparables[idx][field] = parseInt(valLimpio, 10);
          }
        } else {
          AppState.comparables[idx][field] = e.target.value;
        }
      }
    };
    input.addEventListener('input', handleUpdate);
    input.addEventListener('change', handleUpdate);
  });

  // Listeners a botones de eliminar
  document.querySelectorAll('.btnEliminarComp').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetBtn = e.target.closest('button');
      const idx = parseInt(targetBtn.dataset.index, 10);
      if (AppState.comparables.length > AppState.minComparables) {
        AppState.comparables.splice(idx, 1);
        renderizarComparables();
      }
    });
  });
}

/**
 * Sugerir 3 comparables realistas con IA basados en comuna, tipo y superficie
 */
async function sugerirComparablesConIA() {
  // Validación de permisos según rol
  const esAdmin = AppState.usuario && (AppState.usuario.rol === 'admin' || AppState.usuario.email === 'informatica.full@gmail.com');
  const rolProf = (AppState.usuario?.rol_profesional || '').toLowerCase();
  const puedeIA = esAdmin || rolProf.includes('corredor') || rolProf.includes('tasador');

  if (!puedeIA) {
    alert('🔒 Función disponible para Corredores: La sugerencia automática de comparables con IA está reservada para Corredores de Propiedades y Tasadores Certificados.');
    return;
  }

  const comunaInput = document.getElementById('comuna');
  const superficieInput = document.getElementById('superficieM2');
  const tipoInput = document.getElementById('tipoInmueble');

  const comuna = comunaInput ? comunaInput.value.trim() : '';
  const superficie = superficieInput ? parseFloat(superficieInput.value) : NaN;
  const tipo = tipoInput ? tipoInput.value : 'Departamento';

  // Validación: Comuna y Superficie requeridas
  if (!comuna || isNaN(superficie) || superficie <= 0) {
    alert('Por favor, completa la comuna y la superficie antes de pedir sugerencias.');
    if (!comuna && comunaInput) comunaInput.focus();
    else if (superficieInput) superficieInput.focus();
    return;
  }

  const btn = document.getElementById('btnSugerirComparables');
  const btnTexto = document.getElementById('btnSugerirTexto');
  const spinner = document.getElementById('spinnerSugerir');
  const toast = document.getElementById('toastSugerencias');

  // Estado de carga en el botón
  if (btn) {
    btn.disabled = true;
    btn.classList.add('opacity-75', 'cursor-wait');
  }
  if (spinner) spinner.classList.remove('hidden');
  if (btnTexto) btnTexto.textContent = 'Analizando mercado con IA...';
  if (toast) toast.classList.add('hidden');

  try {
    const res = await fetch('/api/sugerir-comparables', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token || ''}`
      },
      body: JSON.stringify({
        comuna,
        tipo,
        superficie
      })
    });

    const data = await res.json();

    if (!res.ok || !data.ok || !data.comparables) {
      throw new Error(data.error || 'No se pudieron generar sugerencias.');
    }

    // Actualizar estado con los 3 comparables sugeridos
    AppState.comparables = data.comparables.map(c => ({
      superficie_m2: c.superficie_m2,
      precio_clp: c.precio_clp,
      distancia_km: c.distancia_km,
      entorno: c.entorno || 'Mismo barrio / Condominio',
      diferencia_nota: c.diferencia_nota || ''
    }));

    // Re-renderizar filas de comparables
    renderizarComparables();

    // Mostrar aviso legal / UX en color ámbar
    const avisoLegal = document.getElementById('avisoLegalSugerencias');
    if (avisoLegal) {
      avisoLegal.classList.remove('hidden');
    }

    // Feedback visual al usuario
    if (toast) {
      const fuenteMsg = data.fuente === 'ia' ? 'Sugerencias generadas con DeepSeek IA' : 'Sugerencias referenciales aplicadas';
      toast.className = 'mb-3 px-3.5 py-2.5 rounded-xl text-xs font-medium border bg-emerald-950/80 border-emerald-800 text-emerald-300 flex items-center justify-between animate-fade-in';
      toast.innerHTML = `
        <div class="flex items-center gap-2">
          <svg class="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
          </svg>
          <span><strong>¡3 comparables autocompletados!</strong> ${fuenteMsg} para ${comuna}. Puedes editar cualquier valor libremente.</span>
        </div>
      `;
      toast.classList.remove('hidden');
      setTimeout(() => {
        toast.classList.add('hidden');
      }, 7000);
    }

  } catch (error) {
    console.error('Error al sugerir comparables:', error);
    alert('Error al sugerir comparables: ' + error.message);
  } finally {
    // Restaurar estado del botón
    if (btn) {
      btn.disabled = false;
      btn.classList.remove('opacity-75', 'cursor-wait');
    }
    if (spinner) spinner.classList.add('hidden');
    if (btnTexto) btnTexto.textContent = '✨ Sugerir Comparables con IA';
  }
}

// ========================================================
// 3. CONFIGURACIÓN DE EVENTOS
// ========================================================

function configurarEventos() {
  // Botón Principal de Google OAuth
  document.getElementById('btnContinuarGoogle')?.addEventListener('click', ejecutarLoginGoogle);

  // Accesos rápidos de desarrollo (Testing local)
  document.getElementById('btnQuickLoginAdmin')?.addEventListener('click', () => {
    ejecutarLoginRapido('informatica.full@gmail.com', 'admin123');
  });

  document.getElementById('btnQuickLoginDemo')?.addEventListener('click', () => {
    ejecutarLoginRapido('cliente@correo.cl', '123456');
  });

  // Cerrar Sesión
  document.getElementById('btnLogout')?.addEventListener('click', cerrarSesion);

  // Agregar Comparable
  document.getElementById('btnAgregarComparable')?.addEventListener('click', () => {
    if (AppState.comparables.length < AppState.maxComparables) {
      AppState.comparables.push({ superficie_m2: '', precio_clp: '', distancia_km: '', diferencia_nota: '' });
      renderizarComparables();
    }
  });

  // Sugerir Comparables con IA
  document.getElementById('btnSugerirComparables')?.addEventListener('click', sugerirComparablesConIA);

  // Modal de Ayuda / Guía de Comparables
  document.getElementById('btnAyudaComparables')?.addEventListener('click', abrirModalAyudaComparables);
  document.getElementById('btnCerrarAyuda')?.addEventListener('click', cerrarModalAyudaComparables);
  document.getElementById('btnEntendidoAyuda')?.addEventListener('click', cerrarModalAyudaComparables);

  // Cargar Ejemplo
  document.getElementById('btnEjemplo')?.addEventListener('click', cargarDatosEjemplo);

  // Cambio de Tipo de Inmueble (mostrar/ocultar Piso y Ascensor si es Departamento)
  document.getElementById('tipoInmueble')?.addEventListener('change', actualizarVisibilidadPisoAscensor);

  // Botón Ver en Google Maps (Formulario y Modal)
  document.getElementById('btnVerEnMapa')?.addEventListener('click', abrirMapaInmueble);
  document.getElementById('modalBtnVerMapaInmueble')?.addEventListener('click', abrirMapaInmueble);

  // Formateador de miles en tiempo real para Precio de Referencia (CLP)
  const inputPrecioRef = document.getElementById('precioReferencia');
  if (inputPrecioRef) {
    inputPrecioRef.addEventListener('input', (e) => {
      const valLimpio = e.target.value.replace(/\D/g, '');
      e.target.value = valLimpio ? formatearMilesInput(valLimpio) : '';
    });
  }

  // Enviar Formulario de Tasación
  document.getElementById('formTasacion')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await procesarTasacion();
  });

  // Abrir Modal de Informe Completo
  document.getElementById('btnAbrirInformeModal')?.addEventListener('click', abrirModalInforme);

  // Cerrar Modal de Informe Completo
  document.getElementById('btnCerrarModalInforme')?.addEventListener('click', cerrarModalInforme);
  document.getElementById('btnCerrarModalInformeDesktop')?.addEventListener('click', cerrarModalInforme);
  document.getElementById('btnCerrarModalInformePie')?.addEventListener('click', cerrarModalInforme);

  // Maximizar / Restaurar Pantalla Completa en Modal de Informe
  document.getElementById('btnMaximizarModalInforme')?.addEventListener('click', toggleMaximizarModalInforme);

  // Toggle de Moneda (CLP / UF / USD)
  document.querySelectorAll('.moneda-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.monedaActiva = btn.dataset.moneda;
      actualizarDisplayMoneda();
    });
  });

  // Botones de Descargar PDF
  document.getElementById('btnCompactoPdf')?.addEventListener('click', async () => await exportarDocumento('pdf'));
  document.getElementById('btnModalPdf')?.addEventListener('click', async () => await exportarDocumento('pdf'));

  // Botones de Descargar Excel
  document.getElementById('btnCompactoExcel')?.addEventListener('click', async () => await exportarDocumento('excel'));
  document.getElementById('btnModalExcel')?.addEventListener('click', async () => await exportarDocumento('excel'));

  // Abrir y Cerrar Modal de Historial
  document.getElementById('btnVerHistorial')?.addEventListener('click', abrirModalHistorial);
  document.getElementById('btnCerrarHistorial')?.addEventListener('click', cerrarModalHistorial);
  document.getElementById('btnRefrescarHistorial')?.addEventListener('click', cargarHistorial);

  // Scroll a Metodología y Fuentes
  document.getElementById('btnVerMetodologiaHeader')?.addEventListener('click', () => {
    document.getElementById('seccionMetodologiaFuentes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  // Panel de Control Administrador (Vista Completa / Backoffice)
  document.getElementById('btnOpenAdminModal')?.addEventListener('click', () => abrirVistaAdmin(true));
  document.getElementById('btnVolverAppDesdeAdmin')?.addEventListener('click', () => cerrarVistaAdmin(true));
  document.getElementById('btnCloseAdminModal')?.addEventListener('click', () => cerrarVistaAdmin(true));
  document.getElementById('formAdminCreditos')?.addEventListener('submit', procesarAgregarCreditosAdmin);
  document.getElementById('adminSearchUserInput')?.addEventListener('input', filtrarUsuariosAdmin);
  document.getElementById('btnAdminRefreshUsers')?.addEventListener('click', cargarUsuariosAdmin);

  // Soporte para botón Atrás / Adelante del navegador entre / y /admin
  window.addEventListener('popstate', (e) => {
    if (window.location.pathname === '/admin' || (e.state && e.state.vista === 'admin')) {
      abrirVistaAdmin(false);
    } else {
      cerrarVistaAdmin(false);
    }
  });

  // Selector de Acción en Panel Administrador (Sumar / Restar / Establecer)
  document.getElementById('btnAccionSumar')?.addEventListener('click', () => cambiarAccionAdmin('sumar'));
  document.getElementById('btnAccionRestar')?.addEventListener('click', () => cambiarAccionAdmin('restar'));
  document.getElementById('btnAccionEstablecer')?.addEventListener('click', () => cambiarAccionAdmin('establecer'));

  // Cambio dinámico de pack en Modal Administrador
  document.getElementById('adminPackSelect')?.addEventListener('change', (e) => {
    const selectedOption = e.target.selectedOptions?.[0];
    const cr = selectedOption?.dataset.creditos;
    if (cr) {
      const inputCred = document.getElementById('adminCreditosCantidad');
      if (inputCred) inputCred.value = cr;
    }
  });

  // Abrir y Cerrar Modal de Recarga (Monetización / WhatsApp)
  document.getElementById('btnHeaderRecargar')?.addEventListener('click', abrirModalRecarga);
  document.getElementById('btnBannerRecargar')?.addEventListener('click', abrirModalRecarga);
  document.getElementById('btnCloseSinCreditos')?.addEventListener('click', cerrarModalRecarga);
  document.getElementById('btnCerrarModalRecargaPie')?.addEventListener('click', cerrarModalRecarga);

  // Selección de Pack (Paso 1 -> Paso 2)
  document.querySelectorAll('.btnComprarWhatsapp').forEach(btn => {
    btn.addEventListener('click', manejarSeleccionPack);
  });

  // Botón Volver a Packs (Paso 2 -> Paso 1)
  document.getElementById('btnVolverAPacks')?.addEventListener('click', volverASeleccionPacks);

  // Botón Final WhatsApp (Paso 2)
  document.getElementById('btnAvisarWhatsappFinal')?.addEventListener('click', manejarAvisoWhatsappFinal);

  // Botón Copiar Todos los Datos Bancarios
  document.getElementById('btnCopiarTodosDatos')?.addEventListener('click', copiarTodosLosDatosBancarios);

  // Botones Copiar Dato Individual
  document.querySelectorAll('.btnCopiarDato').forEach(btn => {
    btn.addEventListener('click', manejarCopiarDatoIndividual);
  });

  // Modal Selección de Rol Profesional
  document.getElementById('btnBadgeRol')?.addEventListener('click', () => {
    abrirModalRol(false);
  });

  document.getElementById('btnReabrirModalRol')?.addEventListener('click', () => {
    abrirModalRol(true);
  });

  document.getElementById('btnCerrarModalRol')?.addEventListener('click', () => {
    cerrarModalRol();
  });

  document.querySelectorAll('.btnOpcionRol').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rol = btn.dataset.rol;
      if (!rol) return;

      const esAdmin = Boolean(AppState.usuario && (AppState.usuario.rol === 'admin' || AppState.usuario.email === 'informatica.full@gmail.com'));

      // Restricción: Si el usuario intenta seleccionar Nivel 3 (Tasador) y no es el Admin
      if (rol.toLowerCase().includes('tasador') && !esAdmin) {
        abrirModalRolBloqueado();
        return;
      }

      await guardarRolProfesional(rol);
    });
  });

  // Modal Rol Bloqueado / Acceso Restringido PRO
  document.getElementById('btnCerrarRolBloqueado')?.addEventListener('click', cerrarModalRolBloqueado);

  // Modal Configuración del Motor de Tasación (Tasador / Admin)
  document.getElementById('btnConfigMotorHeader')?.addEventListener('click', abrirModalConfigMotor);
  document.getElementById('btnCerrarConfigMotor')?.addEventListener('click', cerrarModalConfigMotor);
  document.getElementById('btnCancelarConfigMotor')?.addEventListener('click', cerrarModalConfigMotor);
  document.getElementById('btnGuardarConfigMotor')?.addEventListener('click', guardarConfigMotor);
  document.getElementById('btnResetConfigMotor')?.addEventListener('click', resetearConfigMotor);
  document.getElementById('formConfigMotor')?.addEventListener('submit', (e) => {
    e.preventDefault();
    guardarConfigMotor();
  });

  // Modal Confirmación Borrado de Rol (Admin)
  document.getElementById('btnCancelarResetRolModal')?.addEventListener('click', cerrarModalConfirmarResetRol);
  document.getElementById('btnConfirmarResetRolModal')?.addEventListener('click', async () => {
    await procesarResetRolConfirmado();
  });
  document.getElementById('modalConfirmarResetRol')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalConfirmarResetRol') cerrarModalConfirmarResetRol();
  });

  // Modal Confirmación Eliminar Usuario (Admin)
  document.getElementById('btnCancelarEliminarUsuarioModal')?.addEventListener('click', cerrarModalConfirmarEliminarUsuario);
  document.getElementById('btnConfirmarEliminarUsuarioModal')?.addEventListener('click', async () => {
    await procesarEliminarUsuarioConfirmado();
  });
  document.getElementById('modalConfirmarEliminarUsuario')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalConfirmarEliminarUsuario') cerrarModalConfirmarEliminarUsuario();
  });

  // Modal Cambiar Rol de Usuario (Admin)
  document.getElementById('btnCerrarModalCambiarRolX')?.addEventListener('click', cerrarModalCambiarRol);
  document.getElementById('btnCancelarCambiarRolModal')?.addEventListener('click', cerrarModalCambiarRol);
  document.getElementById('modalAdminCambiarRol')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalAdminCambiarRol') cerrarModalCambiarRol();
  });
  document.querySelectorAll('.btnAdminOpcionRol').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rol = btn.dataset.rol;
      if (rol) {
        await procesarCambiarRol(rol);
      }
    });
  });

  // Modal Manual de Operaciones (Admin)
  document.getElementById('btnAbrirManualAdmin')?.addEventListener('click', abrirModalManualAdmin);
  document.getElementById('btnCerrarManualAdminX')?.addEventListener('click', cerrarModalManualAdmin);
  document.getElementById('btnCerrarManualAdminPie')?.addEventListener('click', cerrarModalManualAdmin);
  document.getElementById('btnDescargarManualPdf')?.addEventListener('click', imprimirManualAdmin);
  document.getElementById('btnDescargarManualPdfPie')?.addEventListener('click', imprimirManualAdmin);
  document.getElementById('btnImprimirManualAdmin')?.addEventListener('click', imprimirManualAdmin);
  document.getElementById('btnImprimirManualAdminPie')?.addEventListener('click', imprimirManualAdmin);
  document.getElementById('modalManualAdmin')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalManualAdmin') cerrarModalManualAdmin();
  });

  // Modal Guía Rápida / Manual del Usuario (Flujo de Compra)
  document.getElementById('btnAbrirGuiaUsuario')?.addEventListener('click', abrirModalGuiaUsuario);
  document.getElementById('btnCerrarGuiaUsuarioX')?.addEventListener('click', cerrarModalGuiaUsuario);
  document.getElementById('btnCerrarGuiaUsuarioPie')?.addEventListener('click', cerrarModalGuiaUsuario);
  document.getElementById('modalGuiaUsuario')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalGuiaUsuario') cerrarModalGuiaUsuario();
  });

  // Tecla Escape y Clic Fuera
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modalGuia = document.getElementById('modalGuiaUsuario');
      if (modalGuia && !modalGuia.classList.contains('hidden')) {
        cerrarModalGuiaUsuario();
        return;
      }
      const modalManual = document.getElementById('modalManualAdmin');
      if (modalManual && !modalManual.classList.contains('hidden')) {
        cerrarModalManualAdmin();
        return;
      }
      const modalCambiarRol = document.getElementById('modalAdminCambiarRol');
      if (modalCambiarRol && !modalCambiarRol.classList.contains('hidden')) {
        cerrarModalCambiarRol();
        return;
      }
      const modalEliminar = document.getElementById('modalConfirmarEliminarUsuario');
      if (modalEliminar && !modalEliminar.classList.contains('hidden')) {
        cerrarModalConfirmarEliminarUsuario();
        return;
      }
      const modalReset = document.getElementById('modalConfirmarResetRol');
      if (modalReset && !modalReset.classList.contains('hidden')) {
        cerrarModalConfirmarResetRol();
        return;
      }
      cerrarModalHistorial();
      cerrarModalInforme();
      cerrarModalRecarga();
      cerrarModalAyudaComparables();
      cerrarModalConfigMotor();
      cerrarModalRolBloqueado();
      if (usuarioTieneRol(AppState.usuario)) {
        cerrarModalRol();
      }
    }
  });

  document.getElementById('modalHistorial')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalHistorial') cerrarModalHistorial();
  });

  document.getElementById('modalInformeCompleto')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalInformeCompleto') cerrarModalInforme();
  });

  document.getElementById('modalSinCreditos')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalSinCreditos') cerrarModalRecarga();
  });

  document.getElementById('modalAyudaComparables')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalAyudaComparables') cerrarModalAyudaComparables();
  });

  document.getElementById('modalOnboardingRol')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalOnboardingRol' && usuarioTieneRol(AppState.usuario)) {
      cerrarModalRol();
    }
  });

  document.getElementById('modalRolBloqueado')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalRolBloqueado') {
      cerrarModalRolBloqueado();
    }
  });

  document.getElementById('modalConfigMotor')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalConfigMotor') cerrarModalConfigMotor();
  });
}

// ========================================================
// 4. PANEL DE CONTROL ADMINISTRATIVO (VISTA INDEPENDIENTE BACKOFFICE)
// ========================================================

/**
 * Abre la vista independiente a pantalla completa del Panel de Administración (/admin)
 * Protegida: Solo disponible para el usuario administrador
 * @param {boolean} actualizarHistorial - Si debe actualizar el historial del navegador con /admin
 */
async function abrirVistaAdmin(actualizarHistorial = true) {
  const esAdmin = Boolean(AppState.usuario && (AppState.usuario.rol === 'admin' || AppState.usuario.email === 'informatica.full@gmail.com'));
  
  // Protección estricta de ruta: Si no es administrador, redirigir a la aplicación principal
  if (!esAdmin) {
    cerrarVistaAdmin(actualizarHistorial);
    return;
  }

  const adminView = document.getElementById('adminViewSection');
  const mainApp = document.getElementById('mainAppSection');
  const authSection = document.getElementById('authSection');

  if (authSection) authSection.classList.add('hidden');
  if (mainApp) mainApp.classList.add('hidden');
  
  if (adminView) {
    adminView.classList.remove('hidden');
    document.body.classList.remove('overflow-hidden');
    document.getElementById('adminAlertBox')?.classList.add('hidden');
    const searchInput = document.getElementById('adminSearchUserInput');
    if (searchInput) searchInput.value = '';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    await cargarUsuariosAdmin();
  }

  if (actualizarHistorial && window.location.pathname !== '/admin') {
    history.pushState({ vista: 'admin' }, 'Panel de Administración', '/admin');
  }
}

/**
 * Cierra la vista de administración y regresa al formulario principal de tasación
 * Conserva la sesión activa sin pérdida de datos
 * @param {boolean} actualizarHistorial - Si debe actualizar el historial del navegador a /
 */
function cerrarVistaAdmin(actualizarHistorial = true) {
  cerrarModalConfirmarResetRol();
  cerrarModalConfirmarEliminarUsuario();
  cerrarModalCambiarRol();
  cerrarModalManualAdmin();

  const adminView = document.getElementById('adminViewSection');
  const mainApp = document.getElementById('mainAppSection');
  const authSection = document.getElementById('authSection');

  if (adminView) {
    adminView.classList.add('hidden');
  }

  if (AppState.token) {
    if (mainApp) mainApp.classList.remove('hidden');
    if (authSection) authSection.classList.add('hidden');
  } else {
    if (authSection) authSection.classList.remove('hidden');
    if (mainApp) mainApp.classList.add('hidden');
  }

  if (actualizarHistorial && window.location.pathname === '/admin') {
    history.pushState({ vista: 'app' }, 'Tasador Inmobiliario IA', '/');
  }
}

// Aliases para máxima compatibilidad con código existente
const abrirModalAdmin = (act = true) => abrirVistaAdmin(act);
const cerrarModalAdmin = (act = true) => cerrarVistaAdmin(act);

/**
 * Consulta la lista de usuarios al backend y la almacena en caché
 */
async function cargarUsuariosAdmin() {
  const container = document.getElementById('adminUsersListContainer');
  if (!container || !AppState.token) return;

  container.innerHTML = '<div class="text-slate-400 text-center py-6 text-xs sm:text-sm">Cargando usuarios...</div>';

  try {
    const res = await fetch('/api/admin/usuarios', {
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Error al obtener usuarios');
    }

    AppState.adminUsuariosCache = data.usuarios || [];
    
    // Actualizar contador total de usuarios en el badge
    const totalBadge = document.getElementById('adminTotalUsuariosBadge');
    if (totalBadge) totalBadge.textContent = AppState.adminUsuariosCache.length;

    renderizarListaUsuariosAdmin(AppState.adminUsuariosCache);
  } catch (err) {
    console.error('Error al listar usuarios:', err);
    container.innerHTML = `<div class="text-rose-400 text-center py-4 text-xs">Error: ${err.message}</div>`;
  }
}

/**
 * Filtra usuarios dinámicamente en tiempo real
 */
function filtrarUsuariosAdmin(e) {
  const query = (e.target.value || '').trim().toLowerCase();
  const totalBadge = document.getElementById('adminTotalUsuariosBadge');
  if (!query) {
    if (totalBadge) totalBadge.textContent = AppState.adminUsuariosCache.length;
    renderizarListaUsuariosAdmin(AppState.adminUsuariosCache);
    return;
  }
  const filtrados = AppState.adminUsuariosCache.filter(u => 
    u.email.toLowerCase().includes(query) || 
    (u.nombre && u.nombre.toLowerCase().includes(query)) ||
    (u.rol_profesional && u.rol_profesional.toLowerCase().includes(query)) ||
    (u.ultimo_plan && u.ultimo_plan.toLowerCase().includes(query)) ||
    String(u.id).includes(query)
  );
  if (totalBadge) totalBadge.textContent = `${filtrados.length} / ${AppState.adminUsuariosCache.length}`;
  renderizarListaUsuariosAdmin(filtrados);
}

/**
 * Renderiza la lista de usuarios dentro del panel de administración
 */
function renderizarListaUsuariosAdmin(usuarios) {
  const container = document.getElementById('adminUsersListContainer');
  if (!container) return;

  if (!usuarios || usuarios.length === 0) {
    container.innerHTML = '<div class="text-slate-400 text-center py-4 text-xs italic">No se encontraron usuarios coincidentes.</div>';
    return;
  }

  container.innerHTML = '';
  usuarios.forEach(u => {
    const div = document.createElement('div');
    // Responsive: flex-col en móvil, md:flex-row en PC
    div.className = 'flex flex-col md:flex-row md:items-center justify-between gap-2.5 md:gap-4 p-3 sm:p-3.5 md:px-4 md:py-3.5 rounded-2xl bg-slate-900/90 hover:bg-slate-800/80 border border-slate-800 hover:border-purple-500/60 transition cursor-pointer group shadow-sm';
    
    const esAdmin = u.rol === 'admin';
    const rolBadge = esAdmin
      ? '<span class="text-[9px] md:text-[10px] font-black px-1.5 md:px-2 py-0.5 rounded-md bg-purple-950 text-purple-300 border border-purple-800 tracking-wider shrink-0">ADMIN</span>'
      : '<span class="text-[9px] md:text-[10px] font-semibold px-1.5 md:px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 shrink-0">USER</span>';

    // Badge de Rol Profesional con icono
    let rolProfBadge = '';
    const rolProf = (u.rol_profesional || '').trim();
    if (rolProf) {
      if (rolProf.toLowerCase().includes('tasador')) {
        rolProfBadge = `<span class="text-[10px] md:text-xs font-semibold px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg bg-purple-950/90 text-purple-300 border border-purple-700/60 flex items-center gap-1 shrink-0" title="Rol: ${rolProf}">📊 Tasador</span>`;
      } else if (rolProf.toLowerCase().includes('corredor')) {
        rolProfBadge = `<span class="text-[10px] md:text-xs font-semibold px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg bg-blue-950/90 text-blue-300 border border-blue-700/60 flex items-center gap-1 shrink-0" title="Rol: ${rolProf}">💼 Corredor</span>`;
      } else {
        rolProfBadge = `<span class="text-[10px] md:text-xs font-semibold px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg bg-emerald-950/90 text-emerald-300 border border-emerald-700/60 flex items-center gap-1 shrink-0" title="Rol: ${rolProf}">🏠 Particular</span>`;
      }
    } else {
      rolProfBadge = `<span class="text-[10px] md:text-xs font-medium px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg bg-amber-950/80 text-amber-300 border border-amber-600/50 flex items-center gap-1 shrink-0" title="Sin rol asignado">⚠️ Sin rol</span>`;
    }

    // Badge de Plan Adquirido (o Sin Pack)
    let planBadge = '';
    const plan = (u.ultimo_plan || '').trim();
    if (plan) {
      planBadge = `<span class="text-[10px] md:text-xs font-semibold px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 flex items-center gap-1 shrink-0" title="Último plan comprado: ${plan}">📦 ${plan}</span>`;
    } else {
      planBadge = `<span class="text-[10px] md:text-xs font-medium px-2 md:px-2.5 py-0.5 md:py-1 rounded-lg bg-slate-800 text-slate-400 border border-slate-700/50 flex items-center gap-1 shrink-0" title="Sin pack adquirido">📦 Sin Pack</span>`;
    }

    const tieneNombre = Boolean(u.nombre && u.nombre.trim() && u.nombre.trim().toLowerCase() !== u.email.trim().toLowerCase());

    // El admin principal no puede ser eliminado ni cambiar su rol desde aquí
    const esAdminPrincipal = u.email.toLowerCase() === 'informatica.full@gmail.com' || u.rol === 'admin';
    const btnEliminarHtml = esAdminPrincipal ? '' : `
      <button type="button" class="btnAdminEliminarUsuario px-2.5 py-1 md:px-3 md:py-1.5 rounded-xl text-[11px] md:text-xs font-bold bg-slate-800/90 hover:bg-rose-950 text-slate-300 hover:text-rose-200 border border-slate-700 hover:border-rose-600 transition flex items-center gap-1 shadow-sm cursor-pointer shrink-0" title="Eliminar permanentemente la cuenta de ${u.email}">
        <span class="text-xs">🗑️</span>
        <span class="hidden sm:inline">Eliminar</span>
      </button>
    `;

    // Botón para cambiar rol profesional (Solo para usuarios normales)
    const btnEditarRolHtml = esAdminPrincipal ? '' : `
      <button type="button" class="btnAdminEditarRol px-2 py-0.5 md:px-2.5 md:py-1 rounded-lg text-[10px] md:text-xs font-semibold bg-slate-800/90 hover:bg-purple-950 text-purple-300 hover:text-purple-100 border border-slate-700 hover:border-purple-600 transition flex items-center gap-1 shadow-sm cursor-pointer shrink-0" title="Cambiar rol profesional de ${u.email}">
        <span>✏️</span>
        <span class="hidden sm:inline">Editar Rol</span>
      </button>
    `;

    div.innerHTML = `
      <!-- Fila Superior (Móvil) / Lado Izquierdo (PC): ID, Email, Roles, Plan y Nombre -->
      <div class="flex items-start md:items-center gap-2.5 md:gap-3 min-w-0 flex-1">
        <span class="w-6 h-6 md:w-7 md:h-7 rounded-lg bg-purple-950/90 text-purple-300 flex items-center justify-center text-[10px] md:text-xs font-mono font-bold shrink-0 border border-purple-700/50 shadow-inner mt-0.5 md:mt-0">#${u.id}</span>
        
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5 md:gap-2 flex-wrap">
            <span class="text-xs sm:text-sm md:text-base font-bold text-white group-hover:text-purple-300 transition truncate max-w-full" title="${u.email}">${u.email}</span>
            <div class="flex items-center gap-1 shrink-0 flex-wrap">
              ${rolBadge}
              ${rolProfBadge}
              ${btnEditarRolHtml}
              ${planBadge}
            </div>
          </div>
          ${tieneNombre ? `<span class="text-[11px] md:text-xs text-slate-400 font-medium truncate block mt-0.5">${u.nombre}</span>` : ''}
        </div>
      </div>

      <!-- Fila Inferior (Móvil) / Lado Derecho (PC): Créditos, Botón Reset Rol y Botón Eliminar -->
      <div class="flex items-center justify-between md:justify-end gap-2 md:gap-3 pt-2 md:pt-0 border-t border-slate-800/80 md:border-t-0 shrink-0">
        <!-- Badge de Créditos -->
        <div class="flex items-center gap-1 sm:gap-1.5 px-2.5 py-1 md:px-3 md:py-1.5 rounded-xl bg-emerald-100 text-emerald-950 border border-emerald-300 shadow-sm shrink-0" title="Saldo disponible: ${u.creditos} créditos">
          <span class="text-sm md:text-base font-black font-mono leading-none">${u.creditos}</span>
          <span class="text-[9px] md:text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Créditos</span>
        </div>

        <div class="flex items-center gap-1.5 shrink-0">
          <!-- Botón Reset Rol -->
          <button type="button" class="btnAdminResetRol px-2.5 py-1 md:px-3 md:py-1.5 rounded-xl text-[11px] md:text-xs font-bold bg-rose-950/80 hover:bg-rose-900 text-rose-200 border-2 border-rose-600/90 hover:border-rose-500 transition flex items-center gap-1 md:gap-1.5 shadow-sm cursor-pointer shrink-0" title="Borrar rol profesional de ${u.email}">
            <svg class="w-3.5 h-3.5 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span>Reset Rol</span>
          </button>

          <!-- Botón Eliminar Usuario (🗑️) -->
          ${btnEliminarHtml}
        </div>
      </div>
    `;

    // Botón para editar / cambiar rol profesional
    const btnEditarRol = div.querySelector('.btnAdminEditarRol');
    if (btnEditarRol) {
      btnEditarRol.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirModalCambiarRol(u.email, u.rol_profesional);
      });
    }

    // Botón para resetear rol profesional (Abre modal de confirmación premium)
    const btnReset = div.querySelector('.btnAdminResetRol');
    if (btnReset) {
      btnReset.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirModalConfirmarResetRol(u.email);
      });
    }

    // Botón para eliminar usuario permanentemente (Abre modal de confirmación de eliminación)
    const btnEliminar = div.querySelector('.btnAdminEliminarUsuario');
    if (btnEliminar) {
      btnEliminar.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirModalConfirmarEliminarUsuario(u.email);
      });
    }

    // Clic en la fila para autocompletar el formulario de créditos
    div.addEventListener('click', (e) => {
      if (e.target.closest('.btnAdminResetRol') || e.target.closest('.btnAdminEliminarUsuario') || e.target.closest('.btnAdminEditarRol')) return;
      const emailInput = document.getElementById('adminUserEmail');
      const saldoBox = document.getElementById('adminUserCurrentSaldoBox');
      const saldoVal = document.getElementById('adminUserCurrentSaldoVal');
      if (emailInput) {
        emailInput.value = u.email;
        emailInput.focus();
      }
      if (saldoBox && saldoVal) {
        saldoVal.textContent = `${u.creditos} créditos`;
        saldoBox.classList.remove('hidden');
      }
    });

    container.appendChild(div);
  });
}

/**
 * Variable para recordar el correo del usuario cuyo rol se va a cambiar
 */
let emailPendienteCambiarRol = null;

/**
 * Abre el modal para cambiar el rol profesional de un usuario desde el Panel Admin
 */
function abrirModalCambiarRol(email, rolActual) {
  if (!email) return;
  emailPendienteCambiarRol = email;

  const emailEl = document.getElementById('adminCambiarRolEmail');
  if (emailEl) emailEl.textContent = email;

  const badgeActual = document.getElementById('adminCambiarRolBadgeActual');
  if (badgeActual) {
    if (rolActual) {
      badgeActual.innerHTML = `<span class="px-2 py-0.5 rounded-md bg-purple-950/80 text-purple-300 border border-purple-800 font-semibold">Actual: ${rolActual}</span>`;
    } else {
      badgeActual.innerHTML = `<span class="px-2 py-0.5 rounded-md bg-amber-950/80 text-amber-300 border border-amber-800 font-semibold">Sin rol</span>`;
    }
  }

  const modal = document.getElementById('modalAdminCambiarRol');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

/**
 * Cierra el modal de cambiar rol
 */
function cerrarModalCambiarRol() {
  emailPendienteCambiarRol = null;
  const modal = document.getElementById('modalAdminCambiarRol');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

/**
 * Procesa la asignación del nuevo rol enviando la petición al backend
 */
async function procesarCambiarRol(nuevoRol) {
  if (!emailPendienteCambiarRol || !nuevoRol || !AppState.token) return;

  const email = emailPendienteCambiarRol;
  const spinner = document.getElementById('spinnerCambiarRol');
  const botones = document.querySelectorAll('.btnAdminOpcionRol');

  botones.forEach(b => b.disabled = true);
  if (spinner) spinner.classList.remove('hidden');

  try {
    const res = await fetch('/api/admin/cambiar-rol', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify({ email, nuevo_rol: nuevoRol })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Error al cambiar rol del usuario');
    }

    // Actualizar usuario en el caché local de administración
    const uCache = AppState.adminUsuariosCache.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (uCache) {
      uCache.rol_profesional = data.usuario?.rol_profesional || nuevoRol;
    }

    // Si el usuario modificado es la sesión activa actual del admin (ej. pruebas)
    if (AppState.usuario && AppState.usuario.email.toLowerCase() === email.toLowerCase()) {
      AppState.usuario.rol_profesional = data.usuario?.rol_profesional || nuevoRol;
      localStorage.setItem('tasador_usuario', JSON.stringify(AppState.usuario));
      actualizarHeaderUsuario();
    }

    // Re-renderizar lista en tiempo real sin recargar la página
    renderizarListaUsuariosAdmin(AppState.adminUsuariosCache);

    // Feedback visual verde en el panel
    mostrarAlertaAdmin(`Rol de ${email} actualizado a ${nuevoRol}`, 'success');

    cerrarModalCambiarRol();
  } catch (err) {
    console.error('Error al cambiar rol:', err);
    alert('Error al cambiar rol: ' + err.message);
  } finally {
    botones.forEach(b => b.disabled = false);
    if (spinner) spinner.classList.add('hidden');
  }
}

/**
 * Abre el modal del Manual de Operaciones para el Administrador
 */
function abrirModalManualAdmin() {
  const modal = document.getElementById('modalManualAdmin');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    document.body.classList.add('overflow-hidden');
  }
}

/**
 * Cierra el modal del Manual de Operaciones
 */
function cerrarModalManualAdmin() {
  const modal = document.getElementById('modalManualAdmin');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    document.body.classList.remove('overflow-hidden');
  }
}

/**
 * Imprime el manual o abre el diálogo para guardarlo en PDF
 */
function imprimirManualAdmin() {
  window.print();
}

/**
 * Variable para recordar el correo del usuario que se va a resetear
 */
let emailPendienteResetRol = null;

/**
 * Abre el modal de confirmación premium para resetear el rol de un usuario
 */
function abrirModalConfirmarResetRol(email) {
  if (!email) return;
  emailPendienteResetRol = email;

  const span = document.getElementById('confirmResetRolEmail');
  if (span) span.textContent = email;

  const modal = document.getElementById('modalConfirmarResetRol');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

/**
 * Cierra el modal de confirmación de reseteo de rol
 */
function cerrarModalConfirmarResetRol() {
  emailPendienteResetRol = null;
  const modal = document.getElementById('modalConfirmarResetRol');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

/**
 * Procesa la acción confirmada de borrar el rol desde el modal
 */
async function procesarResetRolConfirmado() {
  if (!emailPendienteResetRol || !AppState.token) {
    cerrarModalConfirmarResetRol();
    return;
  }

  const email = emailPendienteResetRol;
  const btn = document.getElementById('btnConfirmarResetRolModal');
  const txt = document.getElementById('txtBtnConfirmarResetRol');
  const spinner = document.getElementById('spinnerBtnConfirmarResetRol');

  if (btn) btn.disabled = true;
  if (txt) txt.textContent = 'Borrando...';
  if (spinner) spinner.classList.remove('hidden');

  try {
    await ejecutarResetearRolAdmin(email);
  } finally {
    if (btn) btn.disabled = false;
    if (txt) txt.textContent = 'Sí, borrar rol';
    if (spinner) spinner.classList.add('hidden');
    cerrarModalConfirmarResetRol();
  }
}

/**
 * Muestra alertas en la cabecera del Panel de Administración
 */
function mostrarAlertaAdmin(mensaje, tipo = 'success') {
  const alertBox = document.getElementById('adminAlertBox');
  const alertMsg = document.getElementById('adminAlertMsg');
  if (!alertBox || !alertMsg) return;

  if (tipo === 'success') {
    alertBox.className = 'mb-4 p-3 rounded-xl text-xs flex items-center gap-2 bg-emerald-950/80 border border-emerald-800 text-emerald-200';
  } else {
    alertBox.className = 'mb-4 p-3 rounded-xl text-xs flex items-center gap-2 bg-red-950/80 border border-red-800 text-red-200';
  }
  alertMsg.textContent = mensaje;
  alertBox.classList.remove('hidden');
}

/**
 * Resetea el rol profesional de un usuario a NULL enviando petición al backend
 */
async function ejecutarResetearRolAdmin(email) {
  if (!email || !AppState.token) return;

  try {
    const res = await fetch('/api/admin/resetear-rol', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify({ email })
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'No se pudo resetear el rol.');
    }

    mostrarAlertaAdmin(data.message, 'success');

    // Si el usuario reseteado es la sesión activa actual del admin
    if (AppState.usuario && AppState.usuario.email.toLowerCase() === email.toLowerCase()) {
      AppState.usuario.rol_profesional = null;
      AppState.usuario.requiere_rol = true;
      localStorage.setItem('tasador_usuario', JSON.stringify(AppState.usuario));
      actualizarHeaderUsuario();
    }

    // Refrescar listado en vivo
    await cargarUsuariosAdmin();

  } catch (err) {
    console.error('Error al resetear rol:', err);
    mostrarAlertaAdmin('Error: ' + err.message, 'error');
  }
}

/**
 * Variable para recordar el correo del usuario que se va a eliminar
 */
let emailPendienteEliminarUsuario = null;

/**
 * Abre el modal de confirmación premium para eliminar permanentemente a un usuario
 */
function abrirModalConfirmarEliminarUsuario(email) {
  if (!email) return;
  emailPendienteEliminarUsuario = email;

  const span = document.getElementById('confirmEliminarUsuarioEmail');
  if (span) span.textContent = email;

  const modal = document.getElementById('modalConfirmarEliminarUsuario');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

/**
 * Cierra el modal de confirmación de eliminación de usuario
 */
function cerrarModalConfirmarEliminarUsuario() {
  emailPendienteEliminarUsuario = null;
  const modal = document.getElementById('modalConfirmarEliminarUsuario');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

/**
 * Procesa la acción confirmada de eliminar permanentemente al usuario
 */
async function procesarEliminarUsuarioConfirmado() {
  if (!emailPendienteEliminarUsuario || !AppState.token) {
    cerrarModalConfirmarEliminarUsuario();
    return;
  }

  const email = emailPendienteEliminarUsuario;
  const btn = document.getElementById('btnConfirmarEliminarUsuarioModal');
  const txt = document.getElementById('txtBtnConfirmarEliminarUsuario');
  const spinner = document.getElementById('spinnerBtnConfirmarEliminarUsuario');

  if (btn) btn.disabled = true;
  if (txt) txt.textContent = 'Eliminando...';
  if (spinner) spinner.classList.remove('hidden');

  try {
    await ejecutarEliminarUsuarioAdmin(email);
  } finally {
    if (btn) btn.disabled = false;
    if (txt) txt.textContent = 'Sí, eliminar cuenta';
    if (spinner) spinner.classList.add('hidden');
    cerrarModalConfirmarEliminarUsuario();
  }
}

/**
 * Ejecuta la llamada DELETE /api/admin/usuarios/:email para borrar la cuenta
 */
async function ejecutarEliminarUsuarioAdmin(email) {
  if (!email || !AppState.token) return;

  try {
    const res = await fetch(`/api/admin/usuarios/${encodeURIComponent(email)}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${AppState.token}`
      }
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'No se pudo eliminar el usuario.');
    }

    mostrarAlertaAdmin(data.message, 'success');

    // Refrescar lista de usuarios en vivo
    await cargarUsuariosAdmin();

  } catch (err) {
    console.error('Error al eliminar usuario:', err);
    mostrarAlertaAdmin('Error: ' + err.message, 'error');
  }
}

/**
 * Cambia la acción a realizar en el Panel de Administración: 'sumar', 'restar', 'establecer'
 */
function cambiarAccionAdmin(accion) {
  const inputAccion = document.getElementById('adminAccionInput');
  if (inputAccion) inputAccion.value = accion;

  const btnSumar = document.getElementById('btnAccionSumar');
  const btnRestar = document.getElementById('btnAccionRestar');
  const btnEstablecer = document.getElementById('btnAccionEstablecer');

  const packContainer = document.getElementById('adminPackContainer');
  const labelCreditos = document.getElementById('adminCreditosLabel');
  const inputCreditos = document.getElementById('adminCreditosCantidad');
  const helpCreditos = document.getElementById('adminCreditosHelp');
  const btnSubmit = document.getElementById('btnAdminSubmit');
  const btnSubmitText = document.getElementById('btnAdminSubmitText');

  // Reset de botones
  const baseClass = 'adminAccionBtn py-2 px-2 rounded-lg transition flex items-center justify-center gap-1';
  const inactiveClass = `${baseClass} font-semibold text-slate-400 hover:text-white bg-transparent`;

  if (btnSumar) btnSumar.className = inactiveClass;
  if (btnRestar) btnRestar.className = inactiveClass;
  if (btnEstablecer) btnEstablecer.className = inactiveClass;

  if (accion === 'sumar') {
    if (btnSumar) btnSumar.className = `${baseClass} font-bold bg-emerald-600 text-white shadow-sm`;
    if (packContainer) packContainer.classList.remove('hidden');
    if (labelCreditos) labelCreditos.textContent = 'Cantidad de Créditos a Sumar *';
    if (helpCreditos) helpCreditos.textContent = 'Se sumará esta cantidad al saldo existente del usuario.';
    if (inputCreditos) {
      inputCreditos.min = '1';
      if (!inputCreditos.value || inputCreditos.value === '0') inputCreditos.value = '3';
    }
    if (btnSubmit) {
      btnSubmit.className = 'w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-emerald-600/30 transition flex items-center justify-center gap-2 text-sm';
    }
    if (btnSubmitText) btnSubmitText.textContent = 'Sumar Créditos al Usuario';

  } else if (accion === 'restar') {
    if (btnRestar) btnRestar.className = `${baseClass} font-bold bg-rose-600 text-white shadow-sm`;
    if (packContainer) packContainer.classList.add('hidden');
    if (labelCreditos) labelCreditos.textContent = 'Cantidad de Créditos a Restar *';
    if (helpCreditos) helpCreditos.textContent = 'Se restará esta cantidad al saldo del usuario (sin bajar de 0).';
    if (inputCreditos) {
      inputCreditos.min = '1';
      if (!inputCreditos.value || inputCreditos.value === '0') inputCreditos.value = '1';
    }
    if (btnSubmit) {
      btnSubmit.className = 'w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-rose-600/30 transition flex items-center justify-center gap-2 text-sm';
    }
    if (btnSubmitText) btnSubmitText.textContent = 'Restar Créditos al Usuario';

  } else if (accion === 'establecer') {
    if (btnEstablecer) btnEstablecer.className = `${baseClass} font-bold bg-purple-600 text-white shadow-sm`;
    if (packContainer) packContainer.classList.add('hidden');
    if (labelCreditos) labelCreditos.textContent = 'Nuevo Saldo Exacto de Créditos *';
    if (helpCreditos) helpCreditos.textContent = 'El saldo del usuario quedará fijado en este valor exacto (permite 0).';
    if (inputCreditos) {
      inputCreditos.min = '0';
      inputCreditos.value = '0';
    }
    if (btnSubmit) {
      btnSubmit.className = 'w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-purple-600/30 transition flex items-center justify-center gap-2 text-sm';
    }
    if (btnSubmitText) btnSubmitText.textContent = 'Establecer Saldo Exacto';
  }
}

async function procesarAgregarCreditosAdmin(e) {
  e.preventDefault();
  const emailInput = document.getElementById('adminUserEmail');
  const creditosInput = document.getElementById('adminCreditosCantidad');
  const accionInput = document.getElementById('adminAccionInput');
  const packSelect = document.getElementById('adminPackSelect');
  const alertBox = document.getElementById('adminAlertBox');
  const alertMsg = document.getElementById('adminAlertMsg');
  const btnSubmit = document.getElementById('btnAdminSubmit');

  const email = emailInput.value.trim();
  const accion = accionInput?.value || 'sumar';
  const creditos = parseInt(creditosInput.value, 10);
  const selectedOption = packSelect?.selectedOptions?.[0];
  const packNombre = packSelect?.value || 'Pack Profesional (3 informes)';
  const packMonto = selectedOption?.dataset.monto || '';

  if (!email) {
    alert('Por favor selecciona o ingresa un correo electrónico.');
    return;
  }

  if (isNaN(creditos) || creditos < 0) {
    alert('Por favor ingresa una cantidad de créditos válida mayor o igual a 0.');
    return;
  }

  if (accion !== 'establecer' && creditos <= 0) {
    alert('Para sumar o restar, la cantidad debe ser mayor a 0.');
    return;
  }

  btnSubmit.disabled = true;
  btnSubmit.classList.add('opacity-75');

  try {
    const res = await fetch('/api/admin/agregar-creditos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify({ email, creditos, accion, packNombre, packMonto })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'No se pudo actualizar los créditos.');
    }

    let detalleEmail = '';
    if (data.notificacion_email && data.notificacion_email.enviado) {
      detalleEmail = ' 📧 Correos enviados exitosamente al cliente y administrador.';
    }

    alertBox.className = 'mb-4 p-3 rounded-xl text-xs flex items-center gap-2 bg-emerald-950/80 border border-emerald-800 text-emerald-200';
    alertMsg.textContent = `${data.message}${detalleEmail}`;
    alertBox.classList.remove('hidden');

    // Actualizar indicador de saldo actual si sigue seleccionado el mismo email
    const saldoVal = document.getElementById('adminUserCurrentSaldoVal');
    if (saldoVal) {
      saldoVal.textContent = `${data.usuario.creditos} cr`;
    }

    // Si el usuario recargado es el mismo logueado (ej: admin a sí mismo), actualizar UI
    if (AppState.usuario && AppState.usuario.email.toLowerCase() === email.toLowerCase()) {
      AppState.usuario.creditos = data.usuario.creditos;
      localStorage.setItem('tasador_usuario', JSON.stringify(AppState.usuario));
      actualizarHeaderUsuario();
    }

    // Refrescar listado de usuarios de inmediato
    await cargarUsuariosAdmin();

  } catch (error) {
    alertBox.className = 'mb-4 p-3 rounded-xl text-xs flex items-center gap-2 bg-red-950/80 border border-red-800 text-red-200';
    alertMsg.textContent = error.message;
    alertBox.classList.remove('hidden');
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.classList.remove('opacity-75');
  }
}

// ========================================================
// 4.1 MONETIZACIÓN Y RECARGA VÍA WHATSAPP (FLUJO DE 2 PASOS)
// ========================================================

function abrirModalRecarga() {
  const modal = document.getElementById('modalSinCreditos');
  if (modal) {
    volverASeleccionPacks(); // Siempre inicia en el Paso 1 (selección de pack)
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }
}

function cerrarModalRecarga() {
  cerrarModalGuiaUsuario();
  const modal = document.getElementById('modalSinCreditos');
  if (modal) {
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    volverASeleccionPacks();
  }
}

/**
 * Abre el modal del Manual del Usuario / Guía Rápida de Compra
 */
function abrirModalGuiaUsuario() {
  const modal = document.getElementById('modalGuiaUsuario');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

/**
 * Cierra el modal del Manual del Usuario y regresa a la vista de pago
 */
function cerrarModalGuiaUsuario() {
  const modal = document.getElementById('modalGuiaUsuario');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

/**
 * Paso 1 -> Paso 2: El usuario hace clic en "Comprar vía WhatsApp" en un pack
 * Guarda el pack seleccionado y muestra la pantalla con los datos bancarios y botón final
 */
function manejarSeleccionPack(e) {
  const btn = e.currentTarget;
  const pack = btn.dataset.pack || 'Pack Profesional (3 informes)';
  const precio = btn.dataset.precio || '$45.000 CLP';

  AppState.packSeleccionado = { nombre: pack, precio: precio };

  mostrarPasoPagoTransferencia(pack, precio);
}

/**
 * Muestra el recuadro con los datos de transferencia y el botón final de WhatsApp
 */
function mostrarPasoPagoTransferencia(pack, precio) {
  const vistaPacks = document.getElementById('vistaPacksRecarga');
  const vistaPago = document.getElementById('vistaDetallePago');
  const modalContainer = document.getElementById('modalRecargaContainer');
  const pagoNombre = document.getElementById('pagoPackNombre');
  const pagoPrecio = document.getElementById('pagoPackPrecio');

  if (pagoNombre) pagoNombre.textContent = pack;
  if (pagoPrecio) pagoPrecio.innerHTML = `${precio} <span class="text-xs font-normal text-slate-400 font-sans">CLP</span>`;

  if (vistaPacks) vistaPacks.classList.add('hidden');
  if (vistaPago) {
    vistaPago.classList.remove('hidden');
    vistaPago.classList.add('flex');
  }

  // Ajustar ancho del modal a un tamaño más compacto y enfocado para la vista de pago
  if (modalContainer) {
    modalContainer.classList.remove('max-w-4xl');
    modalContainer.classList.add('max-w-2xl');
  }
}

/**
 * Permite al usuario regresar a la cuadrícula de packs si desea cambiar su elección
 */
function volverASeleccionPacks() {
  const vistaPacks = document.getElementById('vistaPacksRecarga');
  const vistaPago = document.getElementById('vistaDetallePago');
  const modalContainer = document.getElementById('modalRecargaContainer');

  if (vistaPago) {
    vistaPago.classList.add('hidden');
    vistaPago.classList.remove('flex');
  }
  if (vistaPacks) vistaPacks.classList.remove('hidden');

  if (modalContainer) {
    modalContainer.classList.remove('max-w-2xl');
    modalContainer.classList.add('max-w-4xl');
  }
}

/**
 * Copia todos los datos bancarios formateados en un solo clic
 */
function copiarTodosLosDatosBancarios() {
  const pack = AppState.packSeleccionado?.nombre || 'Pack Profesional (3 informes)';
  const precio = AppState.packSeleccionado?.precio || '$45.000 CLP';

  const textoCopiar = `DATOS PARA TRANSFERENCIA BANCARIA:
Nombre: Carlos Chávez F.
Banco: Cuenta RUT
Número de Cuenta: 9345141
RUT: 9345141-4
Correo: informatica.full@gmail.com
Pack: ${pack}
Monto: ${precio}`;

  navigator.clipboard.writeText(textoCopiar).then(() => {
    const btnTexto = document.getElementById('btnCopiarTodosTexto');
    if (btnTexto) {
      const orig = btnTexto.textContent;
      btnTexto.textContent = '¡Copiado!';
      setTimeout(() => { btnTexto.textContent = orig; }, 2000);
    }
  }).catch(err => {
    console.warn('Error al copiar al portapapeles:', err);
  });
}

/**
 * Copia un dato individual (Cuenta, RUT o Correo)
 */
function manejarCopiarDatoIndividual(e) {
  const btn = e.currentTarget;
  const valor = btn.dataset.valor;
  if (valor) {
    navigator.clipboard.writeText(valor).then(() => {
      const orig = btn.textContent;
      btn.textContent = '¡Copiado!';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }).catch(err => {
      console.warn('Error al copiar dato:', err);
    });
  }
}

/**
 * Botón Final de WhatsApp (Paso 2):
 * "Ya realicé la transferencia, avisar por WhatsApp"
 * Abre la URL de WhatsApp con el mensaje prellenado incluyendo el email y el pack
 */
function manejarAvisoWhatsappFinal() {
  const pack = AppState.packSeleccionado?.nombre || 'Pack Profesional (3 informes)';
  const precio = AppState.packSeleccionado?.precio || '$45.000 CLP';
  const userEmail = AppState.usuario?.email || 'cliente@correo.cl';

  // Mensaje prellenado establecido
  const mensaje = `Hola Carlos, acabo de transferir por el ${pack} (${precio}). Adjunto mi comprobante. Mi correo es ${userEmail}`;
  const waUrl = `https://wa.me/56988160607?text=${encodeURIComponent(mensaje)}`;

  window.open(waUrl, '_blank');
}

// ========================================================
// 5. PROCESAMIENTO DE TASACIÓN (CONSUME 1 CRÉDITO)
// ========================================================

/**
 * Alterna la visibilidad de los campos Piso y Ascensor (solo aplican a Departamento)
 */
function actualizarVisibilidadPisoAscensor() {
  const tipo = document.getElementById('tipoInmueble')?.value || 'Departamento';
  const seccion = document.getElementById('seccionPisoAscensor');
  if (!seccion) return;

  if (tipo === 'Departamento') {
    seccion.classList.remove('hidden');
  } else {
    seccion.classList.add('hidden');
  }
}

/**
 * Abre Google Maps con la dirección y/o comuna ingresada
 */
function abrirMapaInmueble() {
  const dir = (document.getElementById('direccionInmueble')?.value || AppState.ultimoInmueble?.direccion || '').trim();
  const com = (document.getElementById('comuna')?.value || AppState.ultimoInmueble?.comuna || '').trim();

  if (!dir && !com) {
    alert('📍 Por favor ingresa una Dirección o selecciona una Comuna para ver la ubicación en el mapa.');
    return;
  }

  const queryParts = [];
  if (dir) queryParts.push(dir);
  if (com) queryParts.push(com);
  queryParts.push('Chile');

  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryParts.join(', '))}`;
  window.open(mapsUrl, '_blank');
}

function cargarDatosEjemplo() {
  document.getElementById('tipoInmueble').value = EJEMPLO_DATOS.inmueble.tipo;
  if (document.getElementById('direccionInmueble')) document.getElementById('direccionInmueble').value = EJEMPLO_DATOS.inmueble.direccion || '';
  document.getElementById('superficieM2').value = EJEMPLO_DATOS.inmueble.superficie_m2;
  document.getElementById('dormitorios').value = EJEMPLO_DATOS.inmueble.dormitorios;
  document.getElementById('banos').value = EJEMPLO_DATOS.inmueble.banos;
  document.getElementById('antiguedad').value = EJEMPLO_DATOS.inmueble.antiguedad;
  document.getElementById('estadoConservacion').value = EJEMPLO_DATOS.inmueble.estado_conservacion;
  document.getElementById('comuna').value = EJEMPLO_DATOS.inmueble.comuna;
  document.getElementById('precioReferencia').value = formatearMilesInput(EJEMPLO_DATOS.inmueble.precio_referencia);
  if (document.getElementById('estacionamiento')) document.getElementById('estacionamiento').value = EJEMPLO_DATOS.inmueble.estacionamiento || 'Sí';
  if (document.getElementById('bodega')) document.getElementById('bodega').value = EJEMPLO_DATOS.inmueble.bodega || 'Sí';
  if (document.getElementById('piso')) document.getElementById('piso').value = EJEMPLO_DATOS.inmueble.piso || 5;
  if (document.getElementById('ascensor')) document.getElementById('ascensor').value = EJEMPLO_DATOS.inmueble.ascensor || 'Sí';
  if (document.getElementById('amenidades')) document.getElementById('amenidades').value = EJEMPLO_DATOS.inmueble.amenidades || '';

  actualizarVisibilidadPisoAscensor();

  AppState.comparables = JSON.parse(JSON.stringify(EJEMPLO_DATOS.comparables));
  renderizarComparables();
  document.getElementById('avisoLegalSugerencias')?.classList.add('hidden');
}

async function procesarTasacion() {
  const btnSubmit = document.getElementById('btnGenerarAnalisis');
  const btnSubmitText = document.getElementById('btnSubmitText');
  const iconSubmit = document.getElementById('iconSubmit');

  // Recolectar datos del inmueble
  const inmueble = {
    tipo: document.getElementById('tipoInmueble').value,
    direccion: document.getElementById('direccionInmueble')?.value.trim() || '',
    superficie_m2: parseFloat(document.getElementById('superficieM2').value),
    dormitorios: parseInt(document.getElementById('dormitorios').value, 10),
    banos: parseInt(document.getElementById('banos').value, 10),
    antiguedad: parseInt(document.getElementById('antiguedad').value, 10),
    estado_conservacion: document.getElementById('estadoConservacion').value,
    comuna: document.getElementById('comuna').value.trim(),
    estacionamiento: document.getElementById('estacionamiento')?.value || 'No',
    bodega: document.getElementById('bodega')?.value || 'No',
    piso: document.getElementById('piso')?.value ? parseInt(document.getElementById('piso').value, 10) : null,
    ascensor: document.getElementById('ascensor')?.value || 'No',
    amenidades: document.getElementById('amenidades')?.value.trim() || '',
    precio_referencia: document.getElementById('precioReferencia').value
      ? desformatearMiles(document.getElementById('precioReferencia').value)
      : null
  };

  // Validaciones
  if (!inmueble.tipo || isNaN(inmueble.superficie_m2) || inmueble.superficie_m2 <= 0 ||
      isNaN(inmueble.dormitorios) || isNaN(inmueble.banos) || isNaN(inmueble.antiguedad) ||
      !inmueble.estado_conservacion || !inmueble.comuna) {
    alert('Por favor complete todos los campos obligatorios del inmueble a valuar.');
    return;
  }

  // Validar comparables
  const comparablesValidos = [];
  for (let i = 0; i < AppState.comparables.length; i++) {
    const c = AppState.comparables[i];
    const sup = parseFloat(c.superficie_m2);
    const precio = desformatearMiles(c.precio_clp);
    const dist = parseFloat(c.distancia_km);

    if (isNaN(sup) || sup <= 0 || isNaN(precio) || precio <= 0 || isNaN(dist) || dist < 0) {
      alert(`Por favor revise los valores numéricos del Comparable #${i + 1}.`);
      return;
    }

    comparablesValidos.push({
      superficie_m2: sup,
      precio_clp: precio,
      distancia_km: dist,
      entorno: c.entorno || 'Mismo barrio / Condominio',
      diferencia_nota: c.diferencia_nota?.trim() || ''
    });
  }

  if (comparablesValidos.length < AppState.minComparables || comparablesValidos.length > AppState.maxComparables) {
    alert(`Debe ingresar entre ${AppState.minComparables} y ${AppState.maxComparables} comparables.`);
    return;
  }

  // Activar estado de carga en el botón
  btnSubmit.disabled = true;
  btnSubmit.classList.add('opacity-75', 'cursor-wait');
  btnSubmitText.textContent = 'Analizando con IA DeepSeek...';
  iconSubmit.classList.add('animate-spin');

  try {
    const response = await fetch('/api/tasacion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify({
        inmueble,
        comparables: comparablesValidos,
        configMotor: AppState.configMotor
      })
    });

    const data = await response.json();

    // 403: Sin créditos suficientes
    if (response.status === 403) {
      abrirModalRecarga();
      return;
    }

    // 401: Sesión expirada
    if (response.status === 401) {
      alert('Tu sesión ha expirado. Por favor inicia sesión nuevamente.');
      cerrarSesion();
      return;
    }

    if (!response.ok) {
      throw new Error(data.error || 'Ocurrió un error en el servidor al procesar la tasación.');
    }

    // Actualizar créditos en estado local
    if (typeof data.creditos_restantes === 'number' && AppState.usuario) {
      AppState.usuario.creditos = data.creditos_restantes;
      localStorage.setItem('tasador_usuario', JSON.stringify(AppState.usuario));
      actualizarHeaderUsuario();
    }

    // Guardar estado
    AppState.ultimaTasacion = data.tasacion;
    AppState.ultimoInmueble = inmueble;
    AppState.comparables = comparablesValidos;

    // Renderizar resultados en tarjeta compacta y preparar modal
    mostrarResultados(data.tasacion, inmueble, data.fecha);

    // Actualizar contador del historial
    cargarHistorialContador();

    // Scroll suave hacia la tarjeta compacta de resultados
    document.getElementById('panelResumenCompacto')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch (error) {
    console.error('Error al generar tasación:', error);
    alert('Error: ' + error.message);
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.classList.remove('opacity-75', 'cursor-wait');
    btnSubmitText.textContent = 'Generar Análisis (Consume 1 Crédito)';
    iconSubmit.classList.remove('animate-spin');
  }
}

// ========================================================
// 6. RESULTADOS E INFORMES
// ========================================================

function abrirModalAyudaComparables() {
  const modal = document.getElementById('modalAyudaComparables');
  if (modal) {
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }
}

function cerrarModalAyudaComparables() {
  const modal = document.getElementById('modalAyudaComparables');
  if (modal) {
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }
}

function abrirModalInforme() {
  const modal = document.getElementById('modalInformeCompleto');
  if (modal) {
    // Si por alguna razón quedó maximizado, asegurar que inicie en tamaño normal
    if (AppState.modalInformeMaximizado) {
      toggleMaximizarModalInforme();
    }
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');

    // Cargar indicadores si aún no se han cargado (o si se quiere refrescar)
    if (!AppState.indicadores) {
      cargarIndicadores();
    }

    // Asegurar que los botones de exportación reflejen los permisos del rol
    actualizarPermisosSegunRol();
  }
}

function cerrarModalInforme() {
  const modal = document.getElementById('modalInformeCompleto');
  if (modal) {
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');

    // Al cerrar el modal, si estaba maximizado, se restaura a su tamaño original
    if (AppState.modalInformeMaximizado) {
      toggleMaximizarModalInforme();
    }
  }
}

function toggleMaximizarModalInforme() {
  const modal = document.getElementById('modalInformeCompleto');
  const btnTexto = document.getElementById('btnMaximizarTexto');
  const btnIcono = document.getElementById('btnMaximizarIcono');
  const btn = document.getElementById('btnMaximizarModalInforme');

  if (!modal) return;

  AppState.modalInformeMaximizado = !AppState.modalInformeMaximizado;

  if (AppState.modalInformeMaximizado) {
    modal.classList.add('modal-informe-maximized');
    if (btnTexto) btnTexto.textContent = 'Restaurar';
    if (btn) btn.setAttribute('title', 'Restaurar tamaño normal');
    if (btnIcono) {
      btnIcono.innerHTML = `
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 14h6m0 0v6m0-6L3 21m17-7h-6m0 0v6m0-6l7 7M10 10V4m0 6H4m6 0L3 3m10 7V4m0 6h6m-6 0l7-7"/>
        </svg>
      `;
    }
  } else {
    modal.classList.remove('modal-informe-maximized');
    if (btnTexto) btnTexto.textContent = 'Maximizar';
    if (btn) btn.setAttribute('title', 'Maximizar a Pantalla Completa');
    if (btnIcono) {
      btnIcono.innerHTML = `
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/>
        </svg>
      `;
    }
  }
}

// ========================================================
// INDICADORES ECONÓMICOS (UF / USD) Y TOGGLE DE MONEDA
// ========================================================

/**
 * Carga UF y USD desde el backend (que a su vez consulta mindicador.cl).
 * Actualiza el display de indicadores del día en el modal.
 */
async function cargarIndicadores() {
  try {
    const res = await fetch('/api/indicadores');
    const data = await res.json();

    if (!data.ok) throw new Error(data.error || 'Error desconocido');

    AppState.indicadores = { uf: data.uf, usd: data.usd, fecha: data.fecha };

    // Actualizar display de indicadores del día
    const ufFormateado  = '$ ' + Math.round(data.uf).toLocaleString('es-CL');
    const usdFormateado = '$ ' + Math.round(data.usd).toLocaleString('es-CL');

    const elUf    = document.getElementById('indicadorUfVal');
    const elUsd   = document.getElementById('indicadorUsdVal');
    const elFecha = document.getElementById('indicadorFecha');
    const elPie   = document.getElementById('pieTasasCambio');

    if (elUf)    elUf.textContent    = `${ufFormateado} CLP`;
    if (elUsd)   elUsd.textContent   = `${usdFormateado} CLP`;
    if (elFecha) elFecha.textContent = `(${data.fecha})`;
    if (elPie)   elPie.classList.remove('hidden');

  } catch (err) {
    console.warn('[Indicadores] No se pudieron cargar:', err.message);
    const elUf  = document.getElementById('indicadorUfVal');
    const elUsd = document.getElementById('indicadorUsdVal');
    if (elUf)  elUf.textContent  = 'no disponible';
    if (elUsd) elUsd.textContent = 'no disponible';
  }
}

/**
 * Convierte un valor CLP a la moneda activa y lo formatea.
 * @param {number} clp   - Valor en CLP
 * @param {string} tipo  - 'valor' | 'unitario'
 * @returns {string}     - Texto formateado con unidad
 */
function convertirYFormatear(clp, tipo = 'valor') {
  const moneda = AppState.monedaActiva;
  const ind    = AppState.indicadores;
  const unidad = tipo === 'unitario' ? ' / m²' : '';

  if (moneda === 'UF' && ind?.uf) {
    const ufVal = clp / ind.uf;
    return `UF ${ufVal.toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unidad}`;
  }
  if (moneda === 'USD' && ind?.usd) {
    const usdVal = clp / ind.usd;
    return `USD $ ${usdVal.toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}${unidad}`;
  }
  // CLP (default)
  return `${formatearMoneda(clp)} CLP${unidad}`;
}

/**
 * Actualiza todos los valores monetarios del modal según la moneda activa.
 * Se llama al hacer clic en los botones del toggle.
 */
function actualizarDisplayMoneda() {
  const tasacion = AppState.ultimaTasacion;
  if (!tasacion) return;

  // Valor de Referencia
  const elRef = document.getElementById('resValorReferencia');
  if (elRef) elRef.textContent = convertirYFormatear(tasacion.valor_referencia);

  // Precio Unitario
  const elUnit = document.getElementById('resPrecioUnitario');
  if (elUnit) elUnit.textContent = convertirYFormatear(tasacion.precio_unitario_promedio, 'unitario');

  // Rango
  const elRango = document.getElementById('resRangoReferencia');
  if (elRango) {
    const rangoMin = tasacion.rango_referencia?.min ?? 0;
    const rangoMax = tasacion.rango_referencia?.max ?? 0;
    const moneda   = AppState.monedaActiva;
    const ind      = AppState.indicadores;

    let minTxt, maxTxt, sufijo;

    if (moneda === 'UF' && ind?.uf) {
      minTxt = (rangoMin / ind.uf).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      maxTxt = (rangoMax / ind.uf).toLocaleString('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      sufijo = 'UF';
      elRango.textContent = `UF ${minTxt} - UF ${maxTxt}`;
    } else if (moneda === 'USD' && ind?.usd) {
      minTxt = Math.round(rangoMin / ind.usd).toLocaleString('es-CL');
      maxTxt = Math.round(rangoMax / ind.usd).toLocaleString('es-CL');
      elRango.textContent = `USD $ ${minTxt} - $ ${maxTxt}`;
    } else {
      elRango.textContent = `${formatearMoneda(rangoMin)} - ${formatearMoneda(rangoMax)} CLP`;
    }
  }

  // Label de la tarjeta de referencia
  const elLabel = document.getElementById('resValorReferenciaLabel');
  if (elLabel) {
    const labels = {
      CLP: 'Valor Comercial de Referencia (Mercado Inmobiliario Chileno)',
      UF:  'Valor Comercial de Referencia en Unidades de Fomento (UF)',
      USD: 'Valor Comercial de Referencia en Dólares Americanos (USD)'
    };
    elLabel.textContent = labels[AppState.monedaActiva] || labels.CLP;
  }

  // Actualizar estado visual de los botones del toggle
  document.querySelectorAll('.moneda-btn').forEach(btn => {
    const activo = btn.dataset.moneda === AppState.monedaActiva;
    btn.classList.toggle('bg-blue-600', activo);
    btn.classList.toggle('text-white', activo);
    btn.classList.toggle('shadow-sm', activo);
    btn.classList.toggle('border-transparent', activo);
    btn.classList.toggle('bg-transparent', !activo);
    btn.classList.toggle('text-slate-300', !activo);
    btn.classList.toggle('border-slate-600', !activo);
  });
}

function mostrarResultados(tasacion, inmueble, fecha) {
  const panelBienvenida = document.getElementById('panelBienvenida');
  const panelResumenCompacto = document.getElementById('panelResumenCompacto');

  if (panelBienvenida) panelBienvenida.classList.add('hidden');
  if (panelResumenCompacto) panelResumenCompacto.classList.remove('hidden');

  const fechaTexto = fecha || new Date().toISOString().slice(0, 10);

  // 1. Llenar Tarjeta Compacta
  const dirCompacto = inmueble.direccion ? `${inmueble.direccion}, ` : '';
  document.getElementById('resCompactoTitulo').textContent = `${dirCompacto}${inmueble.comuna} (${inmueble.tipo}) • ${inmueble.superficie_m2} m²`;
  document.getElementById('resCompactoFecha').textContent = `Emisión: ${fechaTexto}`;
  document.getElementById('resCompactoValor').textContent = `${formatearMoneda(tasacion.valor_referencia)} CLP`;
  document.getElementById('resCompactoUnitario').textContent = `${formatearMoneda(tasacion.precio_unitario_promedio)} / m²`;

  // 2. Llenar Modal de Informe Completo
  document.getElementById('modalTituloComuna').textContent = `Tasación en ${inmueble.comuna} (${inmueble.tipo})`;
  document.getElementById('modalFechaEmision').textContent = `Fecha de cálculo: ${fechaTexto}`;

  // 2.1 Llenar Ficha Técnica del Inmueble en el Modal
  if (document.getElementById('modalInmuebleTipoComuna')) {
    document.getElementById('modalInmuebleTipoComuna').textContent = `${inmueble.tipo || '-'} • ${inmueble.comuna || '-'}`;
  }
  if (document.getElementById('modalInmuebleSuperficie')) {
    document.getElementById('modalInmuebleSuperficie').textContent = `${inmueble.superficie_m2 || 0} m²`;
  }
  if (document.getElementById('modalInmuebleDormBanos')) {
    document.getElementById('modalInmuebleDormBanos').textContent = `${inmueble.dormitorios || 0}D / ${inmueble.banos || 0}B`;
  }
  if (document.getElementById('modalInmuebleAntiguedadEstado')) {
    document.getElementById('modalInmuebleAntiguedadEstado').textContent = `${inmueble.antiguedad || 0}a • ${inmueble.estado_conservacion || '-'}`;
  }
  if (document.getElementById('modalInmuebleEstacBodega')) {
    document.getElementById('modalInmuebleEstacBodega').textContent = `Estac: ${inmueble.estacionamiento || 'No'} • Bod: ${inmueble.bodega || 'No'}`;
  }
  const boxPisoAsc = document.getElementById('modalInmuebleBoxPisoAscensor');
  if (boxPisoAsc) {
    if (inmueble.tipo === 'Departamento') {
      boxPisoAsc.classList.remove('hidden');
      if (document.getElementById('modalInmueblePisoAscensor')) {
        document.getElementById('modalInmueblePisoAscensor').textContent = `Piso ${inmueble.piso || '-'} • Ascensor: ${inmueble.ascensor || 'No'}`;
      }
    } else {
      boxPisoAsc.classList.add('hidden');
    }
  }
  if (document.getElementById('modalInmuebleDireccion')) {
    document.getElementById('modalInmuebleDireccion').textContent = inmueble.direccion ? inmueble.direccion : `Sector ${inmueble.comuna || '-'}`;
  }
  if (document.getElementById('modalInmuebleAmenidades')) {
    document.getElementById('modalInmuebleAmenidades').textContent = inmueble.amenidades ? inmueble.amenidades : 'Sin amenidades especificadas';
  }

  // Resetear moneda a CLP cada vez que se carga un nuevo informe
  AppState.monedaActiva = 'CLP';

  // Actualizar display de valores (CLP por defecto; toggle aplicará conversión si se cambia)
  actualizarDisplayMoneda();

  const listaComparables = tasacion.comparables_analisis || [];

  // 3. Renderizar Vista Móvil (Tarjetas)
  const contenedorMobile = document.getElementById('listaFactoresCardsMobile');
  if (contenedorMobile) {
    contenedorMobile.innerHTML = '';
    listaComparables.forEach((item, idx) => {
      const factor = Number(item.factor_ajuste) || 1;
      let factorBadgeClass = 'bg-slate-700 text-slate-300';
      if (factor > 1.0) {
        factorBadgeClass = 'bg-emerald-950/90 text-emerald-300 border border-emerald-800';
      } else if (factor < 1.0) {
        factorBadgeClass = 'bg-amber-950/90 text-amber-300 border border-amber-800';
      }

      const nombreComp = item.nombre || `Comparable ${item.index || idx + 1} - Superficie y Ubicación`;

      const cardMob = document.createElement('div');
      cardMob.className = 'bg-slate-800/90 rounded-xl p-3.5 border border-slate-700 space-y-2.5 shadow-sm';
      cardMob.innerHTML = `
        <div class="flex items-center justify-between gap-2 pb-2 border-b border-slate-700/60">
          <span class="font-bold text-white text-xs">${nombreComp}</span>
          <span class="inline-block px-2 py-0.5 rounded text-xs font-bold font-mono-numbers ${factorBadgeClass}">
            Factor: ${factor.toFixed(3)}
          </span>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs bg-slate-900/70 p-2.5 rounded-lg border border-slate-700/50">
          <div>
            <span class="text-slate-400 text-[10px] block font-medium">P. Unit. Original</span>
            <span class="font-bold text-slate-200 font-mono-numbers text-[11px] sm:text-xs">
              ${formatearMoneda(item.precio_unitario_original)}/m²
            </span>
          </div>
          <div>
            <span class="text-slate-400 text-[10px] block font-medium">P. Unit. Ajustado</span>
            <span class="font-bold text-emerald-400 font-mono-numbers text-[11px] sm:text-xs">
              ${formatearMoneda(item.precio_unitario_ajustado)}/m²
            </span>
          </div>
        </div>

        <div class="text-[11px] text-slate-300 leading-snug pt-0.5">
          <span class="text-slate-400 font-semibold block mb-0.5 text-[10px] uppercase tracking-wider">Justificación Técnica:</span>
          <span>${item.justificacion || 'Ajuste de mercado'}</span>
        </div>
      `;
      contenedorMobile.appendChild(cardMob);
    });
  }

  // 4. Renderizar Vista Desktop (Tabla)
  const tbody = document.getElementById('tablaFactoresBody');
  if (tbody) {
    tbody.innerHTML = '';
    listaComparables.forEach((item, idx) => {
      const tr = document.createElement('tr');
      tr.className = 'hover:bg-slate-800/80 transition';

      const factor = Number(item.factor_ajuste) || 1;
      let factorBadgeClass = 'bg-slate-700 text-slate-300';
      if (factor > 1.0) {
        factorBadgeClass = 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60';
      } else if (factor < 1.0) {
        factorBadgeClass = 'bg-amber-950/80 text-amber-400 border border-amber-800/60';
      }

      const nombreComp = item.nombre || `Comparable ${item.index || idx + 1} - Superficie y Ubicación`;

      tr.innerHTML = `
        <td class="py-3 px-3.5">
          <div class="font-bold text-white text-xs sm:text-sm">${nombreComp}</div>
        </td>
        <td class="py-3 px-3 text-right font-mono-numbers text-slate-300">
          ${formatearMoneda(item.precio_unitario_original)}
        </td>
        <td class="py-3 px-3 text-right">
          <span class="inline-block px-2 py-0.5 rounded text-xs font-bold font-mono-numbers ${factorBadgeClass}">
            ${factor.toFixed(3)}
          </span>
        </td>
        <td class="py-3 px-3.5 text-right font-mono-numbers font-bold text-emerald-400 text-xs sm:text-sm">
          ${formatearMoneda(item.precio_unitario_ajustado)}
        </td>
        <td class="py-3 px-3.5 text-slate-300 text-[11px] leading-tight max-w-[240px]">
          ${item.justificacion || 'Ajuste de mercado'}
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  // Conclusión
  document.getElementById('resConclusion').textContent = tasacion.conclusion || 'Análisis completado exitosamente.';

  // Advertencias
  const listaAdv = document.getElementById('listaAdvertencias');
  listaAdv.innerHTML = '';

  if (tasacion.advertencias && tasacion.advertencias.length > 0) {
    tasacion.advertencias.forEach(adv => {
      const li = document.createElement('li');
      li.textContent = adv;
      listaAdv.appendChild(li);
    });
  } else {
    const li = document.createElement('li');
    li.textContent = 'Valuación efectuada conforme a metodologías de comparación de mercado estandarizadas.';
    listaAdv.appendChild(li);
  }

  // Asegurar que los botones de acciones rápidas y exportación reflejen los permisos del rol
  actualizarPermisosSegunRol();
}

/**
 * Exporta el informe en PDF o Excel
 */
async function exportarDocumento(tipo) {
  if (!AppState.ultimaTasacion || !AppState.ultimoInmueble) {
    alert('Primero debes generar un análisis de tasación para poder exportarlo.');
    return;
  }

  // Validación preventiva en frontend para Excel
  if (tipo === 'excel') {
    const esAdmin = AppState.usuario && (AppState.usuario.rol === 'admin' || AppState.usuario.email === 'informatica.full@gmail.com');
    const rolProf = (AppState.usuario?.rol_profesional || '').toLowerCase();
    const puedeExcel = esAdmin || rolProf.includes('corredor') || rolProf.includes('tasador');

    if (!puedeExcel) {
      alert('🔒 Función disponible para Corredores: La exportación en Excel está reservada para Corredores de Propiedades y Tasadores Certificados.');
      return;
    }
  }

  const endpoint = tipo === 'pdf' ? '/api/exportar/pdf' : '/api/exportar/excel';
  const extension = tipo === 'pdf' ? 'pdf' : 'xlsx';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify({
        inmueble: AppState.ultimoInmueble,
        tasacion: AppState.ultimaTasacion,
        comparables: AppState.comparables,
        usuario: AppState.usuario
      })
    });

    if (!response.ok) {
      if (response.status === 403) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || 'Función disponible para Corredores de Propiedades y Tasadores Certificados.');
      }
      throw new Error(`Error en el servidor al generar ${tipo.toUpperCase()}`);
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;

    const comunaSafe = (AppState.ultimoInmueble.comuna || 'chile')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-');
    const fecha = new Date().toISOString().slice(0, 10);
    a.download = `tasacion-${comunaSafe}-${fecha}.${extension}`;

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);

  } catch (error) {
    console.error(`Error al exportar ${tipo}:`, error);
    alert(`No se pudo descargar el archivo ${tipo.toUpperCase()}: ` + error.message);
  }
}

// ========================================================
// 7. HISTORIAL (FILTRADO POR USUARIO)
// ========================================================

async function cargarHistorialContador() {
  if (!AppState.token) return;
  try {
    const response = await fetch('/api/tasaciones', {
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });
    const data = await response.json();
    if (data.success && typeof data.count === 'number') {
      const badge = document.getElementById('badgeHistorialCount');
      if (badge) {
        badge.textContent = data.count;
        if (data.count > 0) {
          badge.classList.remove('hidden');
        }
      }
    }
  } catch (e) {
    console.warn('No se pudo cargar el contador de historial:', e);
  }
}

function abrirModalHistorial() {
  const modal = document.getElementById('modalHistorial');
  if (modal) {
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }
  cargarHistorial();
}

function cerrarModalHistorial() {
  const modal = document.getElementById('modalHistorial');
  if (modal) {
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }
}

async function cargarHistorial() {
  if (!AppState.token) return;
  const lista = document.getElementById('listaHistorial');
  const vacia = document.getElementById('listaHistorialVacia');
  const txtTotal = document.getElementById('txtTotalHistorial');

  if (!lista) return;

  lista.innerHTML = '<div class="text-center py-6 text-slate-500 text-sm">Cargando registros...</div>';

  try {
    const response = await fetch('/api/tasaciones', {
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });
    const result = await response.json();

    if (!result.success || !Array.isArray(result.data) || result.data.length === 0) {
      lista.innerHTML = '';
      if (vacia) vacia.classList.remove('hidden');
      if (txtTotal) txtTotal.textContent = '0 tasaciones registradas';
      return;
    }

    if (vacia) vacia.classList.add('hidden');
    if (txtTotal) txtTotal.textContent = `${result.data.length} tasación(es) registrada(s)`;

    lista.innerHTML = '';

    result.data.forEach(item => {
      const div = document.createElement('div');
      div.className = 'border border-slate-200 rounded-xl p-3.5 sm:p-4 hover:border-slate-300 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white shadow-sm';

      div.innerHTML = `
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-800">
              ${item.tipo_inmueble || 'Inmueble'}
            </span>
            <h4 class="text-sm font-bold text-slate-900">${item.comuna}</h4>
            <span class="text-xs text-slate-400">• ${item.fecha}</span>
          </div>
          <div class="text-xs text-slate-600 mt-1 flex flex-wrap gap-x-4 gap-y-1">
            <span><strong>Superficie:</strong> ${item.superficie_m2} m²</span>
            <span><strong>Dorm:</strong> ${item.dormitorios}</span>
            <span><strong>Baños:</strong> ${item.banos}</span>
            <span><strong>P. Unitario:</strong> ${formatearMoneda(item.precio_unitario_promedio)}/m²</span>
          </div>
          <div class="text-sm font-extrabold text-emerald-600 mt-1.5 font-mono-numbers">
            ${formatearMoneda(item.valor_referencia)} CLP
          </div>
        </div>

        <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
          <button type="button" class="btnCargarId text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white transition flex items-center gap-1 shadow-sm" data-id="${item.id}">
            Ver Detalle
          </button>
        </div>
      `;

      lista.appendChild(div);
    });

    document.querySelectorAll('.btnCargarId').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.target.closest('button').dataset.id;
        await cargarTasacionPorId(id);
      });
    });

  } catch (error) {
    console.error('Error al cargar historial:', error);
    lista.innerHTML = `<div class="text-center py-6 text-red-500 text-sm">Error al cargar historial: ${error.message}</div>`;
  }
}

async function cargarTasacionPorId(id) {
  try {
    const response = await fetch(`/api/tasaciones/${id}`, {
      headers: { 'Authorization': `Bearer ${AppState.token}` }
    });
    const data = await response.json();

    if (!data.success || !data.data) {
      alert('No se encontró el registro solicitado.');
      return;
    }

    const reg = data.data;
    const entrada = reg.datos_entrada || {};
    const inmueble = entrada.inmueble || {
      tipo: reg.tipo_inmueble,
      superficie_m2: reg.superficie_m2,
      dormitorios: reg.dormitorios,
      banos: reg.banos,
      antiguedad: 0,
      estado_conservacion: 'Bueno',
      comuna: reg.comuna
    };

    const comparables = entrada.comparables || [];
    const tasacion = reg.resultado_ia;

    document.getElementById('tipoInmueble').value = inmueble.tipo || 'Departamento';
    if (document.getElementById('direccionInmueble')) document.getElementById('direccionInmueble').value = inmueble.direccion || '';
    document.getElementById('superficieM2').value = inmueble.superficie_m2 || '';
    document.getElementById('dormitorios').value = inmueble.dormitorios || '';
    document.getElementById('banos').value = inmueble.banos || '';
    document.getElementById('antiguedad').value = inmueble.antiguedad || 0;
    document.getElementById('estadoConservacion').value = inmueble.estado_conservacion || 'Bueno';
    document.getElementById('comuna').value = inmueble.comuna || '';
    document.getElementById('precioReferencia').value = inmueble.precio_referencia ? formatearMilesInput(inmueble.precio_referencia) : '';
    if (document.getElementById('estacionamiento')) document.getElementById('estacionamiento').value = inmueble.estacionamiento || 'No';
    if (document.getElementById('bodega')) document.getElementById('bodega').value = inmueble.bodega || 'No';
    if (document.getElementById('piso')) document.getElementById('piso').value = inmueble.piso || '';
    if (document.getElementById('ascensor')) document.getElementById('ascensor').value = inmueble.ascensor || 'No';
    if (document.getElementById('amenidades')) document.getElementById('amenidades').value = inmueble.amenidades || '';

    actualizarVisibilidadPisoAscensor();

    if (comparables.length >= AppState.minComparables) {
      AppState.comparables = comparables;
      renderizarComparables();
    }

    AppState.ultimoInmueble = inmueble;
    AppState.ultimaTasacion = tasacion;
    AppState.comparables = comparables;

    mostrarResultados(tasacion, inmueble, reg.fecha);

    cerrarModalHistorial();
    abrirModalInforme();

  } catch (error) {
    console.error('Error al cargar tasación por id:', error);
    alert('Error al recuperar registro: ' + error.message);
  }
}
