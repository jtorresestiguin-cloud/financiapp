/**
 * /api/eu.js
 *
 * La Search API pública de SEDIA no admite filtrado por status desde exterior.
 * Usamos en cambio el endpoint de Topic Details individual:
 *   https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/{ID}.json
 *
 * Estrategia:
 *   1. Leer topic-list.html (lista completa de IDs)
 *   2. Consultar en paralelo los JSON de detalle de cada ID
 *   3. Filtrar client-side: status 31094501/31094502 Y deadline futuro
 *
 * La estructura real confirmada por diagnóstico:
 *   metadata.status[]      → ['31094501'] | ['31094502'] | ['31094503']
 *   metadata.deadlineDate[] → ['2026-09-16T00:00:00.000+0000']
 *   metadata.title[]        → ['Título de la convocatoria']
 *   metadata.identifier[]   → ['HORIZON-CL5-2026-D3-01']
 */

const TOPIC_LIST  = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topic-list.html';
const DETAIL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const NOW         = new Date();

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (compatible; FinanciApp/2.0; +https://financiapp-wvx2.vercel.app)',
  'Accept':          'application/json, text/html, */*',
  'Accept-Language': 'en',
  'Referer':         'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

function first(f) {
  if (!f) return null;
  if (Array.isArray(f)) return f[0] ?? null;
  return f;
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

function inferirBenef(tags, title) {
  const t = ([...(Array.isArray(tags) ? tags : []), title || '']).join(' ').toLowerCase();
  if (t.includes('sme') || t.includes('enterprise') || t.includes('startup'))       return 'Empresa';
  if (t.includes('ngo') || t.includes('civil society') || t.includes('non-profit')) return 'ONG / Tercer sector';
  if (t.includes('research') || t.includes('university') || t.includes('academic')) return 'Universidad / Investigación';
  if (t.includes('public') || t.includes('authority'))                              return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

function mapDetail(id, json) {
  // El JSON de topicDetails tiene la misma estructura que vimos en el diagnóstico
  // Los campos están en el objeto raíz o en metadata{}
  const item = json?.results?.[0] ?? json ?? {};
  const md   = item.metadata || item || {};

  // ── Estado ─────────────────────────────────────────────────────────────
  const statusCode = String(first(md.status) || '').trim();
  if (!statusCode) return null;
  if (statusCode === '31094503') return null; // cerrada
  if (!['31094501', '31094502'].includes(statusCode)) return null;

  let estado = statusCode === '31094502' ? 'Próxima' : 'Abierta';

  // ── Deadline ────────────────────────────────────────────────────────────
  const deadline = first(md.deadlineDate) ?? null;
  if (estado === 'Abierta' && deadline) {
    try { if (new Date(deadline) < NOW) return null; } catch {}
  }

  // ── Campos ──────────────────────────────────────────────────────────────
  const identifier = first(md.identifier) ?? first(md.callIdentifier) ?? id;
  const title      = first(md.title) ?? item.title ?? item.content ?? identifier;
  if (!title || title === identifier) return null;

  const prog    = first(md.programmeName) ?? first(md.frameworkProgramme) ?? first(md.callTitle) ?? '';
  const desc    = stripHtml(item.content ?? first(md.description) ?? first(md.objective) ?? first(md.topicDescription) ?? '');
  const budget  = first(md.budgetOverview) ?? first(md.budget) ?? first(md.totalBudget) ?? null;
  const pubDate = first(md.startDate) ?? first(md.openingDate) ?? null;
  const tags    = md.keywords ?? md.tags ?? md.crossCuttingPriorities ?? [];

  const urlRaw = first(md.esST_URL) ?? first(md.url) ?? '';
  const enlace = (urlRaw && urlRaw !== 'NA' && !urlRaw.includes('undefined'))
    ? urlRaw.replace(/^uri -> /, '').trim()
    : PORTAL_BASE + identifier.toLowerCase();

  return {
    id:               'eu-' + identifier,
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
    referencia:       String(identifier).toUpperCase(),
  };
}

async function fetchDetail(id) {
  const url  = DETAIL_BASE + id.toLowerCase() + '.json';
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    clearTimeout(t);
    return null;
  }
}

// Procesa IDs en lotes con concurrencia controlada
async function processBatch(ids, concurrency = 12) {
  const results = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch   = ids.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async id => {
        const json = await fetchDetail(id);
        if (!json) return null;
        return mapDetail(id, json);
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
    // Paso 1: obtener lista completa de IDs desde topic-list.html
    const ctrl1 = new AbortController();
    const t1    = setTimeout(() => ctrl1.abort(), 10000);
    const resp  = await fetch(TOPIC_LIST, {
      headers: { ...HEADERS, Accept: 'text/html' },
      signal:  ctrl1.signal,
    });
    clearTimeout(t1);
    if (!resp.ok) throw new Error(`topic-list HTTP ${resp.status}`);

    const html   = await resp.text();
    const allIds = [];
    const re     = /topic-details\/([\w-]+)/gi;
    let   m;
    while ((m = re.exec(html)) !== null) allIds.push(m[1]);
    if (!allIds.length) throw new Error('No se encontraron IDs en topic-list.html');

    // Paso 2: los IDs activos (open/forthcoming) están al FINAL de la lista
    // topic-list.html está ordenado cronológicamente — los más recientes al final
    // Tomamos los últimos 150 para maximizar convocatorias activas en el timeout de Vercel
    const idsToProcess = allIds.slice(-150);

    // Paso 3: obtener detalles y filtrar
    const data = await processBatch(idsToProcess, 12);

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
      via:            'topicDetails JSON',
      ids_procesados: idsToProcess.length,
      total:          data.length,
      data,
    });

  } catch (err) {
    console.error('EU error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
