/**
 * Indicadores Económicos - Controlador
 * Consume la API pública de mindicador.cl para obtener UF y USD del día.
 * No requiere API Key. Cache de 60 minutos para no sobrecargar la API externa.
 */

const https = require('https');

// Cache en memoria para no llamar a la API en cada request
let cacheIndicadores = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutos

/**
 * Hace un GET a la URL indicada y retorna el body parseado como JSON.
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 8000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('Error parseando JSON de mindicador.cl'));
        }
      });
    }).on('error', reject).on('timeout', () => reject(new Error('Timeout consultando mindicador.cl')));
  });
}

/**
 * GET /api/indicadores
 * Responde: { uf: 38500.00, usd: 980.50, fecha: "2024-11-10" }
 */
async function obtenerIndicadores(req, res) {
  try {
    const ahora = Date.now();

    // Servir desde cache si está vigente
    if (cacheIndicadores && (ahora - cacheTimestamp) < CACHE_TTL_MS) {
      return res.json({ ok: true, ...cacheIndicadores, cached: true });
    }

    // Consultar API de mindicador.cl
    const data = await fetchJson('https://mindicador.cl/api');

    const uf  = data?.uf?.valor  ?? null;
    const usd = data?.dolar?.valor ?? null;
    const fecha = data?.uf?.fecha
      ? new Date(data.uf.fecha).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    if (!uf || !usd) {
      return res.status(502).json({ ok: false, error: 'No se pudo obtener indicadores de mindicador.cl' });
    }

    cacheIndicadores = { uf, usd, fecha };
    cacheTimestamp = ahora;

    return res.json({ ok: true, uf, usd, fecha, cached: false });

  } catch (err) {
    console.error('[Indicadores] Error:', err.message);
    return res.status(502).json({ ok: false, error: 'Error al consultar indicadores económicos: ' + err.message });
  }
}

module.exports = { obtenerIndicadores };
