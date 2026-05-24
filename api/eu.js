/**
 * /api/eu.js
 *
 * Usa la API interna del portal EU Funding & Tenders que alimenta
 * el buscador oficial. Es la misma llamada que hace el navegador
 * cuando filtras por "Open for submission" + "Forthcoming".
 *
 * Endpoint: POST https://api.tech.ec.europa.eu/search-api/prod/rest/search
 *
 * Devuelve las 746 convocatorias activas (443 open + 303 forthcoming)
 * igual que muestra la página oficial.
 */

const SEARCH_ENDPOINT = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';
const PORTAL_BASE     = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';

// Cabeceras que replica el navegador al usar el portal
const HEADERS = {
  'Content-Type':    'application/json',
  'Accept':          'application/json, text/plain, */*',
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Origin':          'https://ec.europa.eu',
  'Referer':         'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
};

const NOW = new Date();

// ─── Query Elasticsearch exacta del portal ───────────────────────────────────
// type 1 = Calls for proposals (grants)
// type 2 = Prizes
// type 8 = Innovation procurement
// status 31094501 = Open for submission
// status 31094502 = Forthcoming
function buildQuery(pageNumber = 1, pageSize = 50) {
  return {
    apiKey:     'SEDIA',
    text:       '',
    pageSize:   String(pageSize),
    pageNumber: String(pageNumber),
    sortBy:     'deadlineDate',
    orderBy:    'ASC',
    query: JSON.stringify({
      bool: {
        must: [
          {
            terms: {
              type: ['1', '2', '8'],
            },
          },
          {
            terms: {
              status: ['31094501', '31094502'],
            },
          },
        ],
      },
    }),
  };
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#\d]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function fmtImporte(val) {
  if (!val) return null;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n === 0) return null;
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `€${Math.round(n / 1_000)}K`;
  return `€${Math.round(n).toLocaleString('es-ES')}`;
}

function inferirBenef(tags, title) {
  const t = ([...(Array.isArray(tags) ? tags : []), title || '']).join(' ').toLowerCase();
  if (t.includes('sme') || t.includes('enterprise') || t.includes('startup') || t.includes('industry')) return 'Empresa';
  if (t.includes('ngo') || t.includes('civil society') || t.includes('non-profit')) return 'ONG / Tercer sector';
  if (t.includes('research') || t.includes('university') || t.includes('academic')) return 'Universidad / Investigación';
  if (t.includes('public') || t.includes('authority') || t.includes('municipality')) return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

function mapHit(hit) {
  // La API devuelve los datos en _source o directamente en el objeto
  const s = hit._source || hit.fields || hit || {};

  const statusCode = String(s.status || '').trim();
  let estado = 'Abierta';
  if (statusCode === '31094502') estado = 'Próxima';

  // Doble comprobación: si el deadline ya pasó, descartar
  const deadline = s.deadlineDate || s.deadline || null;
  if (estado === 'Abierta' && deadline) {
    try {
      if (new Date(deadline) < NOW) return null;
    } catch {}
  }

  const id    = s.identifier || s.topicIdentifier || s.id || '';
  const title = s.title || s.topicTitle || id || 'Convocatoria EU';
  const prog  = s.programmeName || s.frameworkProgramme || s.callTitle || '';
  const desc  = stripHtml(s.description || s.objective || s.topicDescription || '');
  const tags  = s.tags || s.keywords || s.crossCuttingPriorities || [];

  return {
    id:               'eu-' + (id || Math.random().toString(36).slice(2)),
    titulo:           title.slice(0, 200),
    organismo:        prog ? `Comisión Europea — ${prog}` : 'Comisión Europea',
    ambito:           'eu',
    fuente:           'eu',
    estado,
    beneficiario:     inferirBenef(tags, title),
    importe:          fmtImporte(s.budgetTopicAction || s.budget || s.totalBudget),
    cierre:           deadline,
    descripcion:      desc.slice(0, 500),
    enlace:           id
                        ? PORTAL_BASE + id.toLowerCase()
                        : 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
    fechaPublicacion: s.startDate || s.openingDate || s.publicationDate || null,
    referencia:       id.toUpperCase() || null,
  };
}

// Obtiene una página de resultados
async function fetchPage(pageNumber, pageSize = 50) {
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(SEARCH_ENDPOINT, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify(buildQuery(pageNumber, pageSize)),
      signal:  ctrl.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();

    // Extraer hits según la estructura de respuesta
    const hits =
      json?.hits?.hits ||
      json?.results ||
      json?.data?.results ||
      json?.topicResultDto?.topics ||
      (Array.isArray(json) ? json : []);

    const total =
      json?.hits?.total?.value ||
      json?.hits?.total ||
      json?.total ||
      json?.topicResultDto?.totalCount ||
      hits.length;

    return { hits, total: Number(total) || hits.length };
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  // Cache 30 min — los datos del portal se actualizan varias veces al día
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  try {
    // Página 1: obtener los primeros 50 resultados y el total real
    const page1 = await fetchPage(1, 50);
    const totalPortal = page1.total;
    let allHits = [...page1.hits];

    // Calcular cuántas páginas más necesitamos (máx 3 páginas = 150 resultados)
    // para no superar el timeout de Vercel de 10s
    const maxPages   = 3;
    const totalPages = Math.min(maxPages, Math.ceil(totalPortal / 50));

    if (totalPages > 1) {
      const pagePromises = [];
      for (let p = 2; p <= totalPages; p++) {
        pagePromises.push(fetchPage(p, 50));
      }
      const morePages = await Promise.allSettled(pagePromises);
      morePages.forEach(r => {
        if (r.status === 'fulfilled') allHits.push(...r.value.hits);
      });
    }

    // Mapear y filtrar
    const data = allHits.map(mapHit).filter(Boolean);

    // Ordenar: Abiertas primero por deadline ASC, luego Próximas por fecha apertura ASC
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
      via:            'search-api',
      total_portal:   totalPortal,   // total real según el portal (746)
      total:          data.length,   // los que hemos traído (hasta 150)
      data,
    });

  } catch (err) {
    console.error('EU search-api error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
