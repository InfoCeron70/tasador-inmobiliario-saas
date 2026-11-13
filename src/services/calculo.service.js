/**
 * Servicio de Cálculo Matemático para Tasación Inmobiliaria
 * Realiza los cálculos analíticos en el servidor (Node.js) con precisión matemática inmediata.
 * Incluye ajuste por entorno y plusvalía (Opción B) conforme a la metodología de mercado.
 */

const METODOLOGIA_Y_FUENTES = {
  metodologia: "Esta herramienta utiliza el Método Comparativo de Mercado, estándar en la industria inmobiliaria (basado en los lineamientos de la Norma Chilena NCh 2613). El cálculo se realiza de forma híbrida: nuestro sistema procesa matemáticamente los datos de los comparables ingresados, aplicando factores de ajuste por superficie, distancia y plusvalía del entorno. Posteriormente, un modelo de lenguaje (IA) redacta el informe final.",
  fuentes: "Los datos de los comparables son ingresados por el usuario (corredor o tasador). Los factores de ajuste y las fórmulas de homologación se basan en criterios técnicos de tasación estándar del mercado chileno. Los valores entregados son referenciales y no constituyen una tasación legal ni un avalúo fiscal."
};

const ADVERTENCIAS_ESTANDAR = [
  "Esta herramienta utiliza el Método Comparativo de Mercado, estándar en la industria inmobiliaria (basado en los lineamientos de la Norma Chilena NCh 2613).",
  "El cálculo se realiza de forma híbrida procesando matemáticamente factores de ajuste por superficie, distancia y plusvalía del entorno, complementado por redacción de IA.",
  "Los datos de los comparables son ingresados por el usuario. Los valores entregados son referenciales y no constituyen una tasación legal ni un avalúo fiscal."
];

/**
 * Realiza el cálculo matemático completo de la tasación
 * @param {Object} inmueble Datos del inmueble a valuar
 * @param {Array} comparables Lista de inmuebles comparables (2 a 5)
 * @param {Object} [configMotor] Parámetros personalizables (margen de error y factores de plusvalía)
 * @returns {Object} Cálculos matemáticos estructurados
 */
function calcularTasacion(inmueble, comparables, configMotor = {}) {
  const supInmueble = Number(inmueble.superficie_m2) || 1;

  // Parámetros configurables del motor de tasación
  const margenErrorPct = (configMotor && configMotor.margenErrorRangoPct !== undefined && configMotor.margenErrorRangoPct !== null && !isNaN(Number(configMotor.margenErrorRangoPct)))
    ? Number(configMotor.margenErrorRangoPct)
    : 8; // por defecto ±8%

  const factorMayorPlusvaliaPct = (configMotor && configMotor.factorMayorPlusvaliaPct !== undefined && configMotor.factorMayorPlusvaliaPct !== null && !isNaN(Number(configMotor.factorMayorPlusvaliaPct)))
    ? Number(configMotor.factorMayorPlusvaliaPct)
    : 3; // por defecto +3%

  const factorMenorPlusvaliaPct = (configMotor && configMotor.factorMenorPlusvaliaPct !== undefined && configMotor.factorMenorPlusvaliaPct !== null && !isNaN(Number(configMotor.factorMenorPlusvaliaPct)))
    ? Number(configMotor.factorMenorPlusvaliaPct)
    : -3; // por defecto -3%

  const factorAccesoDificilPct = (configMotor && configMotor.factorAccesoDificilPct !== undefined && configMotor.factorAccesoDificilPct !== null && !isNaN(Number(configMotor.factorAccesoDificilPct)))
    ? Number(configMotor.factorAccesoDificilPct)
    : -5; // por defecto -5%

  // Multiplicadores correspondientes
  const multMayorPlusvalia = Math.round((1 + factorMayorPlusvaliaPct / 100) * 1000) / 1000;
  const multMenorPlusvalia = Math.round((1 + factorMenorPlusvaliaPct / 100) * 1000) / 1000;
  const multAccesoDificil = Math.round((1 + factorAccesoDificilPct / 100) * 1000) / 1000;

  // 1. Análisis y ajuste matemático de cada comparable
  const comparables_analisis = comparables.map((comp, idx) => {
    const compSup = Number(comp.superficie_m2) || supInmueble;
    const compPrecio = Number(comp.precio_clp) || 0;
    const compDist = Number(comp.distancia_km) || 0;
    const compNota = (comp.diferencia_nota || '').trim();
    const entorno = (comp.entorno || 'Mismo barrio / Condominio').trim();

    // 1.1 Precio por m² original (Precio total / Superficie)
    const precioUnitOriginal = Math.round(compPrecio / compSup);

    // 1.2 Factor de ajuste por superficie (diferencia de escala)
    const diffSupPct = (compSup - supInmueble) / supInmueble;
    let factorSup = 1.0;
    let detalleSup = 'superficie equivalente';

    if (diffSupPct >= 0.10) {
      factorSup = 0.98; // -2% por mayor escala/superficie
      detalleSup = 'mayor metraje (-2%)';
    } else if (diffSupPct <= -0.10) {
      factorSup = 1.02; // +2% por menor metraje
      detalleSup = 'menor metraje (+2%)';
    } else if (diffSupPct >= 0.03) {
      factorSup = 0.99; // -1%
      detalleSup = 'superficie ligeramente mayor (-1%)';
    } else if (diffSupPct <= -0.03) {
      factorSup = 1.01; // +1%
      detalleSup = 'superficie ligeramente menor (+1%)';
    }

    // 1.3 Factor de ajuste por distancia
    let factorDist = 1.0;
    let detalleDist = `${compDist} km`;
    if (compDist >= 1.0) {
      factorDist = 0.98; // -2% si está a más de 1 km
      detalleDist += ' (-2% radio)';
    } else if (compDist >= 0.4) {
      factorDist = 0.99; // -1% si está entre 0.4 y 1 km
      detalleDist += ' (-1% radio)';
    } else {
      detalleDist += ' (inmediato)';
    }

    // 1.4 Factor de ajuste por Entorno / Plusvalía (Parámetros Dinámicos)
    let factorEntorno = 1.00;
    let detalleEntorno = 'Mismo barrio (1.00)';

    const signoMayor = factorMayorPlusvaliaPct >= 0 ? '+' : '';
    const signoMenor = factorMenorPlusvaliaPct >= 0 ? '+' : '';
    const signoAcceso = factorAccesoDificilPct >= 0 ? '+' : '';

    if (entorno.toLowerCase().includes('mayor plusvalía') || entorno.toLowerCase().includes('mayor plusvalia')) {
      factorEntorno = multMayorPlusvalia;
      detalleEntorno = `Zona de mayor plusvalía (${signoMayor}${factorMayorPlusvaliaPct}%)`;
    } else if (entorno.toLowerCase().includes('menor plusvalía') || entorno.toLowerCase().includes('menor plusvalia')) {
      factorEntorno = multMenorPlusvalia;
      detalleEntorno = `Zona de menor plusvalía (${signoMenor}${factorMenorPlusvaliaPct}%)`;
    } else if (entorno.toLowerCase().includes('acceso difícil') || entorno.toLowerCase().includes('acceso dificil') || entorno.toLowerCase().includes('periférico') || entorno.toLowerCase().includes('periferico')) {
      factorEntorno = multAccesoDificil;
      detalleEntorno = `Acceso difícil / Periférico (${signoAcceso}${factorAccesoDificilPct}%)`;
    } else {
      factorEntorno = 1.00;
      detalleEntorno = 'Mismo barrio / Condominio (1.00)';
    }

    // 1.5 Factor por notas o diferencias particulares (ej: sin estacionamiento, remodelado)
    let factorNota = 1.0;
    const notaLower = compNota.toLowerCase();
    if (notaLower.includes('sin estacionamiento') || notaLower.includes('sin bodega') || notaLower.includes('sin estacionam')) {
      factorNota = 1.02; // +2% para homologar hacia propiedad estándar con estacionamiento
    } else if (notaLower.includes('remodelado') || notaLower.includes('nuevo') || notaLower.includes('piso alto')) {
      factorNota = 0.98; // -2% para homologar estándar
    }

    // Multiplicador total: superficie * distancia * entorno * nota
    let factorTotal = factorSup * factorDist * factorEntorno * factorNota;
    factorTotal = Math.max(0.70, Math.min(1.30, Math.round(factorTotal * 1000) / 1000));

    // 1.6 Precio unitario ajustado
    const precioUnitAjustado = Math.round(precioUnitOriginal * factorTotal);

    // Justificación técnica detallada
    const diffPctTotal = Math.round((factorTotal - 1) * 1000) / 10;
    const signo = diffPctTotal >= 0 ? '+' : '';
    let justificacion = `Ajuste ${signo}${diffPctTotal}% por ${detalleSup}, distancia de ${detalleDist} y entorno: ${detalleEntorno}.`;
    if (compNota) {
      justificacion += ` Nota: "${compNota}".`;
    }

    return {
      index: idx + 1,
      nombre: `Comparable ${idx + 1} (${entorno})`,
      entorno: entorno,
      precio_unitario_original: precioUnitOriginal,
      factor_ajuste: factorTotal,
      precio_unitario_ajustado: precioUnitAjustado,
      justificacion
    };
  });

  // 1.7 Promedio de los precios ajustados
  const sumaUnitAjustados = comparables_analisis.reduce((acc, c) => acc + c.precio_unitario_ajustado, 0);
  const precio_unitario_promedio = Math.round(sumaUnitAjustados / comparables_analisis.length);

  // 1.8 Ajuste por equipamiento y estado del inmueble objetivo
  let factorEquipamiento = 1.0;
  const tieneEstacionamiento = String(inmueble.estacionamiento || '').toLowerCase().includes('s');
  const tieneBodega = String(inmueble.bodega || '').toLowerCase().includes('s');
  const tieneAscensor = String(inmueble.ascensor || '').toLowerCase().includes('s');
  const tipoLower = String(inmueble.tipo || '').toLowerCase();
  const esDeptoOOficina = tipoLower.includes('depto') || tipoLower.includes('departamento') || tipoLower.includes('oficina');
  const pisoNum = Number(inmueble.piso) || 1;

  const notasEquipamiento = [];

  if (tieneEstacionamiento) {
    factorEquipamiento += 0.02; // +2% por contar con estacionamiento
    notasEquipamiento.push('estacionamiento (+2%)');
  }

  if (tieneBodega) {
    factorEquipamiento += 0.01; // +1% por bodega
    notasEquipamiento.push('bodega (+1%)');
  }

  if (esDeptoOOficina) {
    if (tieneAscensor) {
      factorEquipamiento += 0.01; // +1% ascensor en edificio
      notasEquipamiento.push('ascensor (+1%)');
    } else if (pisoNum >= 3) {
      factorEquipamiento -= 0.02; // -2% piso alto sin ascensor
      notasEquipamiento.push(`piso ${pisoNum} sin ascensor (-2%)`);
    }
  }

  // Ajuste por estado de conservación del inmueble objetivo
  const estadoConservacion = String(inmueble.estado_conservacion || inmueble.estadoConservacion || inmueble.estado || '').toLowerCase();
  if (estadoConservacion.includes('excelente')) {
    factorEquipamiento += 0.02; // +2% excelente estado
    notasEquipamiento.push('estado excelente (+2%)');
  } else if (estadoConservacion.includes('muy bueno')) {
    factorEquipamiento += 0.01; // +1% muy buen estado
    notasEquipamiento.push('estado muy bueno (+1%)');
  }

  // Ajuste por amenidades (3 o más amenidades seleccionadas)
  const amenidadesStr = String(inmueble.amenidades || '').trim();
  const cantAmenidades = amenidadesStr ? amenidadesStr.split(',').map(a => a.trim()).filter(Boolean).length : 0;
  if (cantAmenidades >= 3) {
    factorEquipamiento += 0.01; // +1% equipamiento integral (3+ amenidades)
    notasEquipamiento.push(`${cantAmenidades} amenidades (+1%)`);
  }

  // 1.9 Multiplicar por superficie del inmueble y factor de equipamiento para obtener valor_referencia
  const valor_referencia = Math.round(precio_unitario_promedio * supInmueble * factorEquipamiento);

  // 1.10 Calcular el rango de referencia dinámico (valor ± margenErrorPct%)
  const ratioMargen = Math.max(0.01, Math.min(0.50, Math.abs(margenErrorPct) / 100));
  const rango_referencia = {
    min: Math.round(valor_referencia * (1 - ratioMargen)),
    max: Math.round(valor_referencia * (1 + ratioMargen)),
    margen_pct: margenErrorPct
  };

  const advertencias = [...ADVERTENCIAS_ESTANDAR];
  if (notasEquipamiento.length > 0) {
    const diffPct = Math.round((factorEquipamiento - 1) * 100);
    const signo = diffPct >= 0 ? '+' : '';
    advertencias.unshift(`Ajuste de equipamiento y conservación del inmueble: Ponderación de ${signo}${diffPct}% por ${notasEquipamiento.join(', ')}.`);
  }

  return {
    comparables_analisis,
    precio_unitario_promedio,
    valor_referencia,
    rango_referencia,
    advertencias,
    metodologia_y_fuentes: METODOLOGIA_Y_FUENTES
  };
}

module.exports = {
  calcularTasacion,
  METODOLOGIA_Y_FUENTES,
  ADVERTENCIAS_ESTANDAR
};
