/**
 * /api/eu.js
 *
 * EU Funding & Tenders Portal — Search API
 * POST https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***
 *
 * NOTA IMPORTANTE: el filtro `query` con `status` no se aplica server-side
 * en la versión actual de la API (devuelve resultados de todos los estados).
 * Por eso filtramos client-side por:
 *   - metadata.status == '31094501' (Open) o '31094502' (Forthcoming)
 *   - metadata.deadlineDate en el futuro (para abiertas)
 *   - metadata.type == '1' | '2' | '8' (grants, no tenders ni proyectos)
 */

const API_URL     = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const NOW         = new Date();

// Pedimos resultados sin filtro de estado — filtramos nosotros
const QUERY_ALL_GRANTS = JSON.stringify({
  bool: {
    must: [
      { terms: { type: ['1', '2', '8'] } },
    ],
  },
});

function buildBody(pageNumber = 1, pageSize = 50) {
  const fd = new URLSearchParams();
  fd.append('query',      QUERY_ALL_GRANTS);
  fd.append('languages',  '["en"]');
  fd.append('pageNumber', String(pageNumber));
  fd.append('pageSize',   String(pageSize));
  fd.append('sortBy',     'deadlineDate');
  fd.append('orderBy',    'DESC'); // más recientes primero — más probable que estén abiertas
  return fd.toString();
}

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#\d]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function fmtImporte(v) {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
  if (isNaN(n) || n === 0) return null;
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `€${Math.round(n / 1_000)}K`;
  return `€${Math.round(n).toLocaleString('es-ES')}`;
}

function first(f) {
  if (!f) return null;
  if (Array.isArray(f)) return f[0] ?? null;
  return f;
}

function inferirBenef(tags, title) {
  const t = ([...(Array.isArray(tags) ? tags : []), title || '']).join(' ').toLowerCase();
  if (t.includes('sme') || t.includes('enterprise') || t.includes('startup'))       return 'Empresa';
  if (t.includes('ngo') || t.includes('civil society') || t.includes('non-profit')) return 'ONG / Tercer sector';
  if (t.includes('research') || t.includes('university') || t.includes('academic')) return 'Universidad / Investigación';
  if (t.includes('public') || t.includes('authority'))                              return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

function mapResult(item) {
  const md = item.metadata || {};

  // ── Tipo: solo grants (1, 2, 8) ─────────────────────────────────────────
  const typeVal = String(first(md.type) || '').trim();
  if (!['1','2','8'].includes(typeVal)) return null;

  // ── Estado: solo open (31094501) o forthcoming (31094502) ────────────────
  const statusCode = String(first(md.status) || '').trim();
  if (statusCode === '31094503' || statusCode === '') return null;
  if (!['31094501','31094502'].includes(statusCode))  return null;

  let estado = statusCode === '31094502' ? 'Próxima' : 'Abierta';

  // ── Deadline: descartar abiertas con fecha pasada ─────────────────────────
  const deadline = first(md.deadlineDate) ?? null;
  if (estado === 'Abierta' && deadline) {
    try { if (new Date(deadline) < NOW) return null; } catch {}
  }

  // ── Campos principales ────────────────────────────────────────────────────
  const identifier = first(md.identifier) ?? first(md.callIdentifier) ?? item.reference ?? '';
  const title      = first(md.title) ?? item.title ?? item.content ?? identifier ?? '';
  if (!title) return null;

  const prog    = first(md.programmeName) ?? first(md.frameworkProgramme) ?? first(md.callTitle) ?? '';
  const desc    = stripHtml(item.content ?? first(md.description) ?? first(md.objective) ?? '');
  const budget  = first(md.budgetOverview) ?? first(md.budget) ?? first(md.totalBudget) ?? null;
  const pubDate = first(md.startDate) ?? first(md.openingDate) ?? null;
  const tags    = md.keywords ?? md.tags ?? md.crossCuttingPriorities ?? [];

  const urlRaw = first(md.esST_URL) ?? first(md.url) ?? '';
  const enlace = (urlRaw && urlRaw !== 'NA')
    ? urlRaw.replace(/^uri -> /, '').trim()
    : identifier
      ? PORTAL_BASE + identifier.toLowerCase()
      : 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals';

  return {
    id:               'eu-' + (identifier || item.reference || Math.random().toString(36).slice(2)),
    titulo:           String(title).slice(0, 200),
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
    referencia:       identifier ? String(identifier).toUpperCase() : null,
  };
}

async function fetchPage(pageNumber, pageSize = 50) {
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(API_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept':       'application/json',
        'User-Agent':   'Mozilla/5.0 (compatible; FinanciApp/2.0)',
      },
      body:   buildBody(pageNumber, pageSize),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${txt.slice(0, 150)}`);
    }
    const json = await r.json();
    return {
      results: json.results ?? [],
      total:   Number(json.totalResults ?? 0),
    };
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
    // Consultamos hasta 5 páginas en paralelo (250 registros)
    // filtrando client-side para obtener convocatorias activas
    const PAGE_SIZE  = 50;
    const MAX_PAGES  = 5;

    const page1   = await fetchPage(1, PAGE_SIZE);
    const total   = page1.total;
    let allItems  = [...page1.results];

    const extraPages = Math.min(MAX_PAGES - 1, Math.ceil(total / PAGE_SIZE) - 1);
    if (extraPages > 0) {
      const rest = await Promise.allSettled(
        Array.from({ length: extraPages }, (_, i) => fetchPage(i + 2, PAGE_SIZE))
      );
      rest.forEach(r => {
        if (r.status === 'fulfilled') allItems.push(...r.value.results);
      });
    }

    const data = allItems.map(mapResult).filter(Boolean);

    // Ordenar: Abiertas por deadline ASC, luego Próximas
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
      via:          'SEDIA search-api + filtro client-side',
      total_portal: total,
      total:        data.length,
      data,
    });

  } catch (err) {
    console.error('EU error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
