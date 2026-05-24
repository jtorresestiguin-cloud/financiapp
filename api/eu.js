/**
 * /api/eu.js
 *
 * Usa la API pública del portal EU Funding & Tenders.
 * Endpoint documentado en:
 * https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis
 *
 * Formato correcto según documentación oficial:
 * POST https://api.tech.ec.europa.eu/search-api/prod/rest/search
 * Content-Type: application/x-www-form-urlencoded
 *
 * Parámetros:
 *   apiKey    = SEDIA
 *   text      = *
 *   pageSize  = 50
 *   pageNumber= 1
 *   query     = { JSON stringificado con filtros }
 */

const SEARCH_ENDPOINT = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';
const PORTAL_BASE     = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';

const HEADERS_FORM = {
  'Content-Type':    'application/x-www-form-urlencoded',
  'Accept':          'application/json',
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Origin':          'https://ec.europa.eu',
  'Referer':         'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
};

const NOW = new Date();

// Query con tipos 1,2,8 y estados open+forthcoming
const QUERY_OBJ = {
  bool: {
    must: [
      { terms: { type:   ['1', '2', '8'] } },
      { terms: { status: ['31094501', '31094502'] } },
    ],
  },
};

function buildFormBody(pageNumber = 1, pageSize = 50) {
  const params = new URLSearchParams();
  params.append('apiKey',     'SEDIA');
  params.append('text',       '*');
  params.append('pageSize',   String(pageSize));
  params.append('pageNumber', String(pageNumber));
  params.append('sortBy',     'deadlineDate');
  params.append('orderBy',    'ASC');
  params.append('query',      JSON.stringify(QUERY_OBJ));
  return params.toString();
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
  const s = hit._source || hit.fields || hit || {};

  const statusCode = String(s.status || '').trim();
  let estado = 'Abierta';
  if (statusCode === '31094502') estado = 'Próxima';

  const deadline = s.deadlineDate || s.deadline || null;
  if (estado === 'Abierta' && deadline) {
    try { if (new Date(deadline) < NOW) return null; } catch {}
  }

  const id   = s.identifier || s.topicIdentifier || s.id || '';
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
    enlace:           id ? PORTAL_BASE + id.toLowerCase() : 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
    fechaPublicacion: s.startDate || s.openingDate || s.publicationDate || null,
    referencia:       id.toUpperCase() || null,
  };
}

async function fetchPage(pageNumber, pageSize = 50) {
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(SEARCH_ENDPOINT, {
      method:  'POST',
      headers: HEADERS_FORM,
      body:    buildFormBody(pageNumber, pageSize),
      signal:  ctrl.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${errText.slice(0, 200)}`);
    }
    const json = await r.json();

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
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  try {
    // Página 1
    const page1       = await fetchPage(1, 50);
    const totalPortal = page1.total;
    let allHits       = [...page1.hits];

    // Páginas 2 y 3 en paralelo (máx 150 resultados dentro del timeout)
    const totalPages = Math.min(3, Math.ceil(totalPortal / 50));
    if (totalPages > 1) {
      const rest = await Promise.allSettled(
        Array.from({ length: totalPages - 1 }, (_, i) => fetchPage(i + 2, 50))
      );
      rest.forEach(r => {
        if (r.status === 'fulfilled') allHits.push(...r.value.hits);
      });
    }

    const data = allHits.map(mapHit).filter(Boolean);
    data.sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'Abierta' ? -1 : 1;
      if (!a.cierre && !b.cierre) return 0;
      if (!a.cierre) return 1;
      if (!b.cierre) return -1;
      return new Date(a.cierre) - new Date(b.cierre);
    });

    return res.status(200).json({
      ok:           true,
      fuente:       'eu',
      via:          'search-api (form)',
      total_portal: totalPortal,
      total:        data.length,
      data,
    });

  } catch (err) {
    console.error('EU error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
