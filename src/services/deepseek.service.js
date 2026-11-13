/**
 * Servicio de integración con DeepSeek IA (Solo Redacción de Conclusión Profesional)
 * En la arquitectura híbrida, los cálculos matemáticos se resuelven en Node.js
 * y DeepSeek redacta exclusivamente el dictamen y conclusión técnica considerando
 * el entorno y plusvalía de los comparables.
 */

const SYSTEM_PROMPT = `Eres un tasador experto chileno. Tu tarea consiste exclusivamente en redactar un párrafo de conclusión profesional (máximo 3 líneas) sustentado en los resultados matemáticos y en el análisis del entorno y plusvalía de los comparables (conforme al método comparativo NCh 2613). Devuelve estrictamente un JSON con esta estructura: { "conclusion": "texto de la conclusión" }.`;

/**
 * Limpia y extrae el objeto JSON entre la primera '{' y la última '}'
 */
function extractJSON(rawText) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('La respuesta de la IA está vacía o no es una cadena de texto.');
  }

  const firstBrace = rawText.indexOf('{');
  const lastBrace = rawText.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error('No se encontró una estructura JSON válida en la respuesta del modelo.');
  }

  const jsonString = rawText.substring(firstBrace, lastBrace + 1);
  return JSON.parse(jsonString);
}

/**
 * Genera una conclusión profesional citando metodología y entorno en caso de modo local
 */
function generarConclusionLocal(calculos, inmueble, comparables) {
  const countComp = comparables ? comparables.length : 3;
  const valorFmt = (calculos.valor_referencia || 0).toLocaleString('es-CL');
  const unitFmt = (calculos.precio_unitario_promedio || 0).toLocaleString('es-CL');
  const minFmt = (calculos.rango_referencia?.min || 0).toLocaleString('es-CL');
  const maxFmt = (calculos.rango_referencia?.max || 0).toLocaleString('es-CL');

  // Evaluar si hay comparables con entorno especial
  const tieneMayor = comparables && comparables.some(c => (c.entorno || '').includes('mayor plusvalía'));
  const tieneMenor = comparables && comparables.some(c => (c.entorno || '').includes('menor plusvalía'));
  let plusvaliaFrase = 'homologados por entorno y proximidad';
  if (tieneMayor) plusvaliaFrase = 'con ajustes al alza por sectores de mayor plusvalía';
  if (tieneMenor) plusvaliaFrase = 'con ponderaciones por variaciones en la plusvalía del entorno';

  const ubicacionTexto = inmueble.direccion ? `${inmueble.direccion}, ${inmueble.comuna}` : inmueble.comuna;
  const equipamientoTexto = [
    `Estacionamiento: ${inmueble.estacionamiento || 'No'}`,
    `Bodega: ${inmueble.bodega || 'No'}`,
    inmueble.piso ? `Piso: ${inmueble.piso}` : null,
    inmueble.ascensor ? `Ascensor: ${inmueble.ascensor}` : null,
    inmueble.amenidades ? `Amenidades: ${inmueble.amenidades}` : null
  ].filter(Boolean).join(', ');

  return {
    conclusion: `Conforme al Método Comparativo de Mercado (NCh 2613) sobre ${countComp} inmuebles del sector ${plusvaliaFrase}, la propiedad (${inmueble.tipo || 'Inmueble'} en ${ubicacionTexto}, ${inmueble.superficie_m2 || 0} m², estado ${inmueble.estado_conservacion || 'Bueno'}${equipamientoTexto ? '; ' + equipamientoTexto : ''}) presenta un valor comercial referencial de $${valorFmt} CLP ($${unitFmt}/m²), en un rango técnico estimado de $${minFmt} a $${maxFmt} CLP.`
  };
}

/**
 * Invoca la API de DeepSeek únicamente para redactar la conclusión técnica
 * @param {Object} calculos Resultados matemáticos calculados previamente en el servidor
 * @param {Object} inmueble Datos del inmueble a valuar
 * @param {Array} comparables Inmuebles comparables con su entorno
 * @returns {Promise<Object>} { conclusion: string }
 */
async function redactarConclusionConDeepSeek(calculos, inmueble, comparables) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-flash';

  // Si no hay API Key configurada o es de ejemplo, usar redacción técnica local
  if (!apiKey || apiKey.trim() === '' || apiKey.includes('tu_api_key')) {
    console.log('[DeepSeek Service] Modo local activo: redactando conclusión con plantilla técnica y entorno.');
    return generarConclusionLocal(calculos, inmueble, comparables);
  }

  const valorFmt = (calculos.valor_referencia || 0).toLocaleString('es-CL');
  const unitFmt = (calculos.precio_unitario_promedio || 0).toLocaleString('es-CL');
  const minFmt = (calculos.rango_referencia?.min || 0).toLocaleString('es-CL');
  const maxFmt = (calculos.rango_referencia?.max || 0).toLocaleString('es-CL');

  const detalleComparablesTexto = comparables.map((c, i) => {
    const entorno = c.entorno || 'Mismo barrio / Condominio';
    const nota = c.diferencia_nota ? `, Nota: "${c.diferencia_nota}"` : '';
    return `- Comparable ${i + 1}: ${c.superficie_m2} m², $${Number(c.precio_clp).toLocaleString('es-CL')} CLP, a ${c.distancia_km} km. Entorno: "${entorno}"${nota}`;
  }).join('\n');

  const userPrompt = `Eres un tasador experto chileno. Basado en los siguientes resultados matemáticos de valuación inmobiliaria:

DATOS DEL INMUEBLE A VALUAR:
- Inmueble: ${inmueble.tipo} ubicado en ${inmueble.direccion ? inmueble.direccion + ', ' : ''}${inmueble.comuna}
- Superficie: ${inmueble.superficie_m2} m² (${inmueble.dormitorios} dorm., ${inmueble.banos} baños, ${inmueble.antiguedad} años, estado: ${inmueble.estado_conservacion})
- Equipamiento: Estacionamiento: ${inmueble.estacionamiento || 'No'}, Bodega: ${inmueble.bodega || 'No'}${inmueble.piso ? ', Piso: ' + inmueble.piso : ''}${inmueble.ascensor ? ', Ascensor: ' + inmueble.ascensor : ''}${inmueble.amenidades ? ', Amenidades: ' + inmueble.amenidades : ''}
- Precio unitario promedio ajustado: $${unitFmt} CLP/m²
- Valor comercial de referencia: $${valorFmt} CLP
- Rango de referencia estimado (±8%): $${minFmt} CLP a $${maxFmt} CLP
- Cantidad de comparables de mercado: ${comparables.length}

COMPARABLES INGRESADOS Y SU ENTORNO:
${detalleComparablesTexto}

METODOLOGÍA:
Método Comparativo de Mercado (Norma Chilena NCh 2613) con homologación por superficie, distancia y plusvalía del entorno (Mismo barrio, Mayor plusvalía, Menor plusvalía o Acceso difícil).

INSTRUCCIÓN:
Redacta un párrafo de conclusión profesional (máximo 3 líneas) donde informes al cliente el valor comercial estimado e integres de forma realista el análisis del entorno de los comparables (ej. ajustes al alza o baja por plusvalía o acceso relativo en el sector de ${inmueble.comuna}). Devuelve estrictamente un JSON: { "conclusion": "texto" }.`;

  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 300,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[DeepSeek Service] Error API (${response.status}):`, errText);
      return generarConclusionLocal(calculos, inmueble, comparables);
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;

    if (!rawContent) {
      return generarConclusionLocal(calculos, inmueble, comparables);
    }

    const parsedJson = extractJSON(rawContent);

    if (!parsedJson.conclusion) {
      return generarConclusionLocal(calculos, inmueble, comparables);
    }

    return {
      conclusion: parsedJson.conclusion.trim()
    };
  } catch (error) {
    console.warn('[DeepSeek Service] Error de conexión con DeepSeek. Usando redacción alternativa:', error.message);
    return generarConclusionLocal(calculos, inmueble, comparables);
  }
}

module.exports = {
  redactarConclusionConDeepSeek,
  generarConclusionLocal,
  extractJSON
};
