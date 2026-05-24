/**
 * /api/eu.js
 *
 * Estructura real confirmada de topicDetails JSON:
 *   json.TopicDetails.title          → string
 *   json.TopicDetails.identifier     → string
 *   json.TopicDetails.callTitle      → string
 *   json.TopicDetails.frameworkProgramme → string
 *   json.TopicDetails.description    → string (HTML)
 *   json.TopicDetails.keywords       → array
 *   json.TopicDetails.actions[]      → array con:
 *     .status.id                     → 31094501 | 31094502 | 31094503
 *     .status.abbreviation           → "Open" | "Forthcoming" | "Closed"
 *     .deadlineDates[]               → timestamps en MILISEGUNDOS
 *     .plannedOpeningDate            → timestamp en milisegundos
 *   json.TopicDetails.budgetOverviewJSONItem
 *     .budgetTopicActionMap[key][].budgetYearMap → { "2026": "1234567" }
 *
 * Estrategia para obtener IDs activos:
 *   Usar el endpoint de Grant Updates (type=6) de la Search API que SÍ devuelve
 *   identificadores de convocatorias recientes, luego consultar cada topicDetails.
 */

const SEARCH_URL  = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***';
const DETAIL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const NOW         = new Date();

// Buscar actualizaciones recientes (type=6) → contienen identifiers de tópicos activos
const QUERY_UPDATES = JSON.stringify({
  bool: {
    must: [
      { terms: { type: ['6'] } },
    ],
  },
});

function buildSearchBody(pageNumber = 1, pageSize = 50) {
  const fd = new URLSearchParams();
  fd.append('query',      QUERY_UPDATES);
  fd.append('languages',  '["en"]');
  fd.append('pageNumber', String(pageNumber));
  fd.append('pageSize',   String(pageSize));
  fd.append('sortBy',     'esDA_IngestDate');
  fd.append('orderBy',    'DESC'); // más recientes primero
  return fd.toString();
}

const HEADERS_JSON = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept':       'application/json',
  'User-Agent':   'Mozilla/5.0 (compatible; FinanciApp/2.0)',
};

const HEADERS_DETAIL = {
  'User-Agent': 'Mozilla/5.0 (compatible; FinanciApp/2.0)',
  'Accept':     'application/json',
  'Referer':    'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#\d]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function fmtImporte(ms) {
  if (!ms) return null;
  const n = parseFloat(String(ms).replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n === 0) return null;
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `€${Math.round(n / 1_000)}K`;
  return `€${Math.round(n).toLocaleString('es-ES')}`;
}

function tsToDate(ts) {
  if (!ts) return null;
  try {
    const d = new Date(Number(ts));
    return isNaN(d) ? null : d.toISOString();
  } catch { return null; }
}

function inferirBenef(keywords, title) {
  const t = ([...(Array.isArray(keywords) ? keywords : []), title || '']).join(' ').toLowerCase();
  if (t.includes('sme') || t.includes('enterprise') || t.includes('startup'))       return 'Empresa';
  if (t.includes('ngo') || t.includes('civil society') || t.includes('non-profit')) return 'ONG / Tercer sector';
  if (t.includes('research') || t.includes('university') || t.includes('academic')) return 'Universidad / Investigación';
  if (t.includes('public') || t.includes('authority'))                              return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

function mapTopicDetail(json) {
  const td = json?.TopicDetails;
  if (!td) return null;

  // Estado y deadline vienen de actions[]
  const actions = td.actions || [];
  if (!actions.length) return null;

  // Buscar la action más relevante (la que tiene deadline más próximo en el futuro, o forthcoming)
  let estado    = null;
  let deadline  = null;
  let openingTs = null;

  for (const action of actions) {
    const statusId   = action?.status?.id;
    const statusAbbr = (action?.status?.abbreviation || '').toLowerCase();

    if (statusId === 31094503 || statusAbbr === 'closed') continue; // ignorar cerradas

    // Deadline: primer valor de deadlineDates[] (timestamps en ms)
    const dl = action?.deadlineDates?.[0] ? tsToDate(action.deadlineDates[0]) : null;

    if (statusId === 31094502 || statusAbbr === 'forthcoming') {
      estado    = 'Próxima';
      deadline  = dl;
      openingTs = action?.plannedOpeningDate ? tsToDate(action.plannedOpeningDate) : null;
      break;
    }

    if (statusId === 31094501 || statusAbbr === 'open') {
      // Verificar que el deadline no haya pasado
      if (dl) {
        try { if (new Date(dl) < NOW) continue; } catch {}
      }
      estado   = 'Abierta';
      deadline = dl;
      break;
    }
  }

  if (!estado) return null; // todas las actions están cerradas

  // Presupuesto desde budgetOverviewJSONItem
  let budget = null;
  try {
    const bmap = td.budgetOverviewJSONItem?.budgetTopicActionMap || {};
    const firstKey = Object.keys(bmap)[0];
    if (firstKey) {
      const byMap = bmap[firstKey][0]?.budgetYearMap || {};
      const total = Object.values(byMap).reduce((acc, v) => acc + parseFloat(v || 0), 0);
      budget = fmtImporte(total);
    }
  } catch {}

  return {
    id:               'eu-' + td.identifier,
    titulo:           (td.title || '').slice(0, 200),
    organismo:        td.frameworkProgramme
                        ? `Comisión Europea — ${td.frameworkProgramme}`
                        : td.callTitle
                          ? `Comisión Europea — ${td.callTitle}`
                          : 'Comisión Europea',
    ambito:           'eu',
    fuente:           'eu',
    estado,
    beneficiario:     inferirBenef(td.keywords, td.title),
    importe:          budget,
    cierre:           deadline,
    descripcion:      stripHtml(td.description || '').slice(0, 500),
    enlace:           PORTAL_BASE + td.identifier.toLowerCase(),
    fechaPublicacion: openingTs,
    referencia:       td.identifier?.toUpperCase() || null,
  };
}

async function fetchTopicDetail(id) {
  const url  = DETAIL_BASE + id.toLowerCase() + '.json';
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { headers: HEADERS_DETAIL, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    clearTimeout(t);
    return null;
  }
}

// Obtener IDs de tópicos recientes desde Grant Updates
async function getRecentTopicIds(pageSize = 100) {
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(SEARCH_URL, {
      method:  'POST',
      headers: HEADERS_JSON,
      body:    buildSearchBody(1, pageSize),
      signal:  ctrl.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) return [];
    const json    = await r.json();
    const results = json.results || [];

    // Extraer identificadores de tópicos desde los campos metadata
    const ids = new Set();
    results.forEach(item => {
      const md = item.metadata || {};
      // identifier puede estar directamente o en callIdentifier
      const id1 = Array.isArray(md.identifier)    ? md.identifier[0]    : md.identifier;
      const id2 = Array.isArray(md.callIdentifier) ? md.callIdentifier[0] : md.callIdentifier;
      if (id1 && typeof id1 === 'string') ids.add(id1);
      if (id2 && typeof id2 === 'string') ids.add(id2);
      // También puede haber IDs en content (texto libre)
      if (item.content && typeof item.content === 'string') {
        const matches = item.content.match(/HORIZON-[\w-]+/g) || [];
        matches.forEach(m => ids.add(m));
      }
    });

    return [...ids].filter(id => id.length > 5 && id.includes('-'));
  } catch (e) {
    clearTimeout(timeout);
    console.warn('getRecentTopicIds error:', e.message);
    return [];
  }
}

async function processBatch(ids, concurrency = 10) {
  const results = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch   = ids.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async id => {
        const json = await fetchTopicDetail(id);
        if (!json) return null;
        return mapTopicDetail(json);
      })
    );
    results.push(
      ...settled.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean)
    );
  }
  return results;
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  try {
    // Paso 1: obtener IDs recientes desde Grant Updates
    const recentIds = await getRecentTopicIds(100);

    if (!recentIds.length) {
      return res.status(200).json({
        ok: false,
        error: 'No se pudieron obtener IDs de tópicos recientes',
      });
    }

    // Paso 2: obtener detalles y filtrar activos (máx 60 dentro del timeout)
    const idsToProcess = recentIds.slice(0, 60);
    const data         = await processBatch(idsToProcess, 10);

    // Ordenar: Abiertas primero por deadline ASC, luego Próximas
    data.sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'Abierta' ? -1 : 1;
      if (!a.cierre && !b.cierre) return 0;
      if (!a.cierre) return 1;
      if (!b.cierre) return -1;
      return new Date(a.cierre) - new Date(b.cierre);
    });

    return res.status(200).json({
      ok:             true,
      fuente:         'eu',
      via:            'grant-updates → topicDetails',
      ids_obtenidos:  recentIds.length,
      ids_procesados: idsToProcess.length,
      total:          data.length,
      data,
    });

  } catch (err) {
    console.error('EU error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
