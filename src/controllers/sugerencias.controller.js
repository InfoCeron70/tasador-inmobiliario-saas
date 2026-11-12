/**
 * Controlador: Sugerencia de Comparables con IA
 * POST /api/sugerir-comparables
 * Genera 3 comparables realistas usando DeepSeek para la comuna y tipo indicados.
 */

const { extractJSON, generarConclusionLocal } = require('../services/deepseek.service');

// -------------------------------------------------------
// Fallback: genera comparables de referencia sin IA
// -------------------------------------------------------
function generarComparablesFallback(tipo, superficie, comuna) {
  const precioBase = superficie * 2200000; // ~2.2M CLP/m² referencial
  return {
    comparables: [
      {
        superficie_m2: Math.round(superficie * 0.92),
        precio_clp: Math.round(precioBase * 0.9 / 100000) * 100000,
        distancia_km: 0.3,
        entorno: 'Mismo barrio / Condominio',
        diferencia_nota: `${tipo} similar en ${comuna}, sin remodelación reciente`
      },
      {
        superficie_m2: Math.round(superficie * 1.05),
        precio_clp: Math.round(precioBase * 1.05 / 100000) * 100000,
        distancia_km: 0.7,
        entorno: 'Zona de mayor plusvalía',
        diferencia_nota: 'Mejor terminaciones, sector consolidado'
      },
      {
        superficie_m2: Math.round(superficie * 0.98),
        precio_clp: Math.round(precioBase * 0.85 / 100000) * 100000,
        distancia_km: 1.2,
        entorno: 'Zona de menor plusvalía',
        diferencia_nota: 'Mayor distancia al eje comercial'
      }
    ]
  };
}

/**
 * POST /api/sugerir-comparables
 * Body: { comuna, tipo, superficie }
 */
async function sugerirComparables(req, res) {
  try {
    const { comuna, tipo, superficie } = req.body;

    if (!comuna || !tipo || !superficie) {
      return res.status(400).json({
        ok: false,
        error: 'Debes enviar comuna, tipo y superficie para generar sugerencias.'
      });
    }

    const sup = Number(superficie);
    if (!sup || sup <= 0) {
      return res.status(400).json({ ok: false, error: 'La superficie debe ser un número mayor a 0.' });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    const model  = process.env.DEEPSEEK_MODEL || 'deepseek-flash';

    // Si no hay API Key, retornar fallback inmediatamente
    if (!apiKey || apiKey.trim() === '' || apiKey.includes('tu_api_key')) {
      console.log('[Sugerir Comparables] Sin API Key, usando datos de referencia locales.');
      return res.json({ ok: true, ...generarComparablesFallback(tipo, sup, comuna), fuente: 'local' });
    }

    const prompt = `Eres un experto corredor de propiedades en Chile. El usuario busca comparables para un ${tipo} de ${sup} m² en la comuna de ${comuna}. Genera 3 propiedades comparables realistas (con superficie, precio en CLP, distancia aproximada en km y una nota corta como 'Mismo barrio' o 'A 5 min'). Devuelve estrictamente un JSON con un array llamado 'comparables' que contenga esos 3 objetos. No inventes datos irreales, usa precios coherentes al mercado actual de esa comuna.

Estructura estricta del JSON requerido:
{
  "comparables": [
    {
      "superficie_m2": <número>,
      "precio_clp": <número entero en CLP>,
      "distancia_km": <número en km, ej: 0.4>,
      "entorno": "<uno de: 'Mismo barrio / Condominio' | 'Zona de mayor plusvalía' | 'Zona de menor plusvalía' | 'Acceso difícil / Periférico'>",
      "diferencia_nota": "<nota corta, ej: 'Mismo barrio', 'A 5 min del metro', 'Sin bodega'>"
    }
  ]
}`;

    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey.trim()}`
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: 'Eres un experto inmobiliario chileno. Devuelve SOLO JSON válido, sin texto adicional, sin markdown, sin explicaciones.'
          },
          { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 600,
        temperature: 0.5
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.warn(`[Sugerir Comparables] Error API DeepSeek (${response.status}):`, errText);
      return res.json({ ok: true, ...generarComparablesFallback(tipo, sup, comuna), fuente: 'local' });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content;

    if (!rawContent) {
      return res.json({ ok: true, ...generarComparablesFallback(tipo, sup, comuna), fuente: 'local' });
    }

    const parsed = extractJSON(rawContent);

    if (!parsed?.comparables || !Array.isArray(parsed.comparables) || parsed.comparables.length === 0) {
      return res.json({ ok: true, ...generarComparablesFallback(tipo, sup, comuna), fuente: 'local' });
    }

    // Normalizar campos y asegurar tipos correctos
    const comparablesNormalizados = parsed.comparables.slice(0, 3).map((c, i) => ({
      superficie_m2: Number(c.superficie_m2) || Math.round(sup * (0.9 + i * 0.1)),
      precio_clp:    Math.round(Number(c.precio_clp) || 0),
      distancia_km:  Number(c.distancia_km) || (0.3 + i * 0.4),
      entorno:       c.entorno || 'Mismo barrio / Condominio',
      diferencia_nota: c.diferencia_nota || ''
    }));

    return res.json({ ok: true, comparables: comparablesNormalizados, fuente: 'ia' });

  } catch (err) {
    console.error('[Sugerir Comparables] Error inesperado:', err.message);
    // No fallar: devolver fallback
    const { tipo, superficie, comuna } = req.body;
    return res.json({
      ok: true,
      ...generarComparablesFallback(tipo || 'Departamento', Number(superficie) || 80, comuna || 'Santiago'),
      fuente: 'local'
    });
  }
}

module.exports = { sugerirComparables };
