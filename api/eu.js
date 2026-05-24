/**
 * /api/eu.js
 *
 * Documentación oficial:
 * POST https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***
 * body: form-data con query (JSON), languages, pageSize, pageNumber
 *
 * La respuesta tiene: { totalResults, results: [ { metadata: {}, content, ... } ] }
 */

const API_URL     = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const NOW         = new Date();

// Query filtrada: solo grants (1,2,8) open+forthcoming
const QUERY_GRANTS = JSON.stringify({
  bool: {
    must: [
      { terms: { type:   ['1', '2', '8'] } },
      { terms: { status: ['31094501', '31094502'] } },
    ],
  },
});

function buildBody(pageNumber = 1, pageSize = 50) {
  const fd = new URLSearchParams();
  fd.append('query',      QUERY_GRANTS);
  fd.append('languages',  '["en"]');
  fd.append('pageNumber', String(pageNumber));
  fd.append('pageSize',   String(pageSize));
  fd.append('sortBy',     'deadlineDate');
  fd.append('orderBy',    'ASC');
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
  if (t.includes('sme') || t.includes('enterprise') || t.includes('startup'))  return 'Empresa';
  if (t.includes('ngo') || t.includes('civil society') || t.includes('non-profit')) return 'ONG / Tercer sector';
  if (t.includes('research') || t.includes('university') || t.includes('academic')) return 'Universidad / Investigación';
  if (t.includes('public') || t.includes('authority') || t.includes('municipality')) return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

function mapResult(item) {
  // La API devuelve los campos en item.metadata (como arrays) o directamente en item
  const md = item.metadata || {};

  // ── Estado ────────────────────────────────────────────────────────────────
  // status puede estar en metadata.status[] o en item directo
  const statusRaw  = first(md.status) ?? first(item.status) ?? '';
  const statusCode = String(statusRaw).trim();

  // Descartar cerradas
  if (statusCode === '31094503' || statusCode.toLowerCase() === 'closed') return null;

  let estado = statusCode === '31094502' ? 'Próxima' : 'Abierta';

  // ── Deadline ──────────────────────────────────────────────────────────────
  const deadline = first(md.deadlineDate) ?? first(md.deadline) ?? null;
  if (estado === 'Abierta' && deadline) {
    try { if (new Date(deadline) < NOW) return null; } catch {}
  }

  // ── Identificador ─────────────────────────────────────────────────────────
  // Puede estar en metadata.identifier[], metadata.callIdentifier[], o item.reference
  const identifier =
    first(md.identifier) ??
    first(md.callIdentifier) ??
    first(md.topicIdentifier) ??
    item.reference ??
    '';

  // ── Título ────────────────────────────────────────────────────────────────
  // Puede estar en metadata.title[], item.title, o item.content
  const title =
    first(md.title) ??
    first(md.topicTitle) ??
    item.title ??
    item.content ??
    identifier ??
    '';

  if (!title) return null;

  // ── Programa ──────────────────────────────────────────────────────────────
  const prog =
    first(md.programmeName) ??
    first(md.programmes) ??
    first(md.frameworkProgramme) ??
    first(md.callTitle) ??
    '';

  // ── Descripción ───────────────────────────────────────────────────────────
  const desc = stripHtml(
    item.content ??
    first(md.description) ??
    first(md.objective) ??
    first(md.topicDescription) ??
    ''
  );

  // ── Presupuesto ───────────────────────────────────────────────────────────
  const budget =
    first(md.budgetTopicAction) ??
    first(md.budget) ??
    first(md.totalBudget) ??
    first(md.euContributionAmount) ??
    first(md.overallBudget) ??
    null;

  // ── Fecha publicación ─────────────────────────────────────────────────────
  const pubDate =
    first(md.startDate) ??
    first(md.openingDate) ??
    first(md.publicationDate) ??
    null;

  // ── URL ───────────────────────────────────────────────────────────────────
  const urlRaw = first(md.url) ?? first(md.esST_URL) ?? '';
  const enlace = (urlRaw && urlRaw !== 'NA')
    ? urlRaw.replace(/^uri -> /, '').trim()
    : identifier
      ? PORTAL_BASE + identifier.toLowerCase()
      : 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals';

  // ── Tags ──────────────────────────────────────────────────────────────────
  const tags = md.keywords ?? md.tags ?? md.crossCuttingPriorities ?? [];

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
      body:   buildBody(pageNumber, pageSize),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`);
    }
    const json = await r.json();

    // Estructura documentada: { totalResults, results: [...] }
    const results = json.results ?? json.hits?.hits ?? [];
    const total   = Number(json.totalResults ?? json.hits?.total?.value ?? results.length);

    return { results, total, raw_sample: results[0] ?? null };
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
  res.setHeader('Cache-Control', 'no-store'); // sin cache mientras depuramos

  try {
    const page1       = await fetchPage(1, 10); // solo 10 para diagnóstico rápido
    const totalPortal = page1.total;
    const allResults  = page1.results;

    const data = allResults.map(mapResult).filter(Boolean);

    return res.status(200).json({
      ok:           true,
      fuente:       'eu',
      total_portal: totalPortal,
      total:        data.length,
      raw_descartados: allResults.length - data.length,
      // Muestra el primer resultado crudo para diagnóstico
      debug_primer_resultado: page1.raw_sample
        ? {
            keys_raiz:      Object.keys(page1.raw_sample),
            keys_metadata:  Object.keys(page1.raw_sample.metadata || {}),
            status_val:     page1.raw_sample.metadata?.status,
            title_val:      page1.raw_sample.metadata?.title ?? page1.raw_sample.title,
            identifier_val: page1.raw_sample.metadata?.identifier,
            deadline_val:   page1.raw_sample.metadata?.deadlineDate,
            type_val:       page1.raw_sample.metadata?.type,
          }
        : null,
      data,
    });

  } catch (err) {
    console.error('EU error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
