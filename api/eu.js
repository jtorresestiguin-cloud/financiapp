/**
 * /api/eu.js
 *
 * Implementación exacta según documentación oficial EU F&T Portal APIs
 * https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis
 *
 * Endpoint correcto:
 *   POST https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***
 *
 * - apiKey y text van en la QUERY STRING de la URL
 * - query va en el FORM-DATA del body (multipart/form-data o x-www-form-urlencoded)
 * - La respuesta tiene estructura: { totalResults, results: [...] }
 * - Cada resultado tiene sus campos en metadata: {}
 *
 * Filtramos:
 *   type: 1 (grants/calls for proposals), 2 (prizes), 8 (innovation procurement)
 *   status: 31094501 (Open) + 31094502 (Forthcoming)
 *   languages: ["en"] para evitar duplicados multilingües (nota de la documentación)
 */

const API_URL = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const NOW = new Date();

// Query exacta según documentación — grants + prizes open/forthcoming
const QUERY = JSON.stringify({
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
});

function buildFormData(pageNumber = 1, pageSize = 50) {
  const fd = new URLSearchParams();
  fd.append('query',     QUERY);
  fd.append('languages', '["en"]');  // evitar duplicados multilingües
  fd.append('pageNumber', String(pageNumber));
  fd.append('pageSize',   String(pageSize));
  fd.append('sortBy',    'deadlineDate');
  fd.append('orderBy',   'ASC');
  return fd.toString();
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

// Extrae el primer valor de un campo que puede ser array o valor directo
function val(field) {
  if (!field) return null;
  if (Array.isArray(field)) return field[0] || null;
  return field;
}

function mapResult(item) {
  // Según la documentación, los campos están en metadata{}
  const md = item.metadata || {};

  const statusArr  = md.status        || [];
  const statusCode = String(val(statusArr) || item.status || '').trim();

  // Solo open (31094501) y forthcoming (31094502)
  if (statusCode === '31094503') return null;

  let estado = 'Abierta';
  if (statusCode === '31094502') estado = 'Próxima';

  // Deadline — descartar si ya pasó (solo para abiertas)
  const deadlineArr = md.deadlineDate || md.deadline || [];
  const deadline    = val(deadlineArr);
  if (estado === 'Abierta' && deadline) {
    try { if (new Date(deadline) < NOW) return null; } catch {}
  }

  // Identificador y título
  const identifierArr = md.identifier || md.topicIdentifier || [];
  const identifier    = val(identifierArr) || item.reference || '';
  const titleArr      = md.title || md.topicTitle || [];
  const title         = val(titleArr) || item.title || item.content || identifier || 'Convocatoria EU';

  // Programa
  const progArr = md.programmeName || md.frameworkProgramme || md.programmes || [];
  const prog    = val(progArr) || '';

  // Descripción — puede estar en content o en metadata
  const desc = stripHtml(
    item.content ||
    val(md.description) ||
    val(md.objective) ||
    val(md.topicDescription) ||
    ''
  );

  // Presupuesto
  const budgetArr = md.budgetTopicAction || md.budget || md.totalBudget || md.euContributionAmount || [];
  const budget    = val(budgetArr);

  // Fecha publicación/apertura
  const pubArr = md.startDate || md.openingDate || md.publicationDate || md.esDA_IngestDate || [];
  const pubDate = val(pubArr);

  // Tags/keywords
  const tags = md.keywords || md.tags || md.crossCuttingPriorities || [];

  // URL directa
  const urlArr  = md.url || md.esST_URL || [];
  const urlRaw  = val(urlArr) || '';
  const enlace  = (urlRaw && urlRaw !== 'NA')
    ? urlRaw.replace(/^uri -> /, '')
    : (identifier ? PORTAL_BASE + identifier.toLowerCase() : 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals');

  if (!title || title === identifier) return null;

  return {
    id:               'eu-' + (identifier || item.reference || Math.random().toString(36).slice(2)),
    titulo:           title.slice(0, 200),
    organismo:        prog ? `Comisión Europea — ${prog}` : 'Comisión Europea',
    ambito:           'eu',
    fuente:           'eu',
    estado,
    beneficiario:     inferirBenef(tags, title),
    importe:          fmtImporte(budget),
    cierre:           deadline,
    descripcion:      desc.slice(0, 500),
    enlace,
    fechaPublicacion: pubDate,
    referencia:       identifier ? identifier.toUpperCase() : null,
  };
}

async function fetchPage(pageNumber, pageSize = 50) {
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':    'application/x-www-form-urlencoded',
        'Accept':          'application/json',
        'User-Agent':      'Mozilla/5.0 (compatible; FinanciApp/2.0)',
        'Accept-Language': 'en',
      },
      body:   buildFormData(pageNumber, pageSize),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${txt.slice(0, 150)}`);
    }
    const json = await r.json();
    // Según documentación: { totalResults, results: [...] }
    const results      = json.results || json.hits?.hits || [];
    const totalResults = json.totalResults || json.hits?.total?.value || results.length;
    return { results, total: Number(totalResults) };
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
    // Página 1 — obtener datos y total real
    const page1      = await fetchPage(1, 50);
    const totalPortal = page1.total;
    let allResults   = [...page1.results];

    // Páginas adicionales en paralelo (máx 150 resultados dentro del timeout de Vercel)
    const totalPages = Math.min(3, Math.ceil(totalPortal / 50));
    if (totalPages > 1) {
      const rest = await Promise.allSettled(
        Array.from({ length: totalPages - 1 }, (_, i) => fetchPage(i + 2, 50))
      );
      rest.forEach(r => {
        if (r.status === 'fulfilled') allResults.push(...r.value.results);
      });
    }

    const data = allResults.map(mapResult).filter(Boolean);

    // Ordenar: Abiertas primero por deadline ASC, luego Próximas
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
      via:          'SEDIA search-api (form-data)',
      total_portal: totalPortal,
      total:        data.length,
      data,
    });

  } catch (err) {
    console.error('EU error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
