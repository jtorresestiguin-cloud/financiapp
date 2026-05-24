/**
 * /api/eu.js
 *
 * Lee topic-list.html, filtra IDs 2025/2026, consulta cada topicDetails JSON
 * y devuelve SOLO convocatorias con estado Open (31094501) o Forthcoming (31094502).
 * Las cerradas (31094503) o con deadline pasado se descartan siempre.
 */

const TOPIC_LIST = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topic-list.html';
const TOPIC_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (compatible; FinanciApp/2.0; +https://financiapp-wvx2.vercel.app)',
  'Accept':          'application/json, text/html, */*',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer':         'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
};

// Códigos de estado oficiales del portal EU
const STATUS_OPEN        = '31094501';
const STATUS_FORTHCOMING = '31094502';
const STATUS_CLOSED      = '31094503';
const NOW = new Date();

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── Filtro de estado — ÚNICA función que decide si incluir o descartar ───────
function resolverEstado(detail) {
  const d = detail?.topicDetails || detail?.details || detail || {};

  // El portal devuelve el código como número o string
  const statusCode = String(d.status || d.topicStatus || d.statusCode || '').trim();

  // Descartar explícitamente cerradas
  if (statusCode === STATUS_CLOSED || statusCode === '3') return null;

  // Comprobar también por texto por si la API lo devuelve así
  const statusText = statusCode.toLowerCase();
  if (statusText === 'closed' || statusText === 'cerrada') return null;

  // Comprobar deadline: si ya pasó, descartar aunque el código diga "open"
  const deadlineRaw = d.deadlineDate || d.deadline || d.submissionDeadline || null;
  if (deadlineRaw) {
    try {
      const dl = new Date(deadlineRaw);
      if (!isNaN(dl) && dl < NOW) return null; // caducada
    } catch {}
  }

  // Determinar estado normalizado
  if (statusCode === STATUS_FORTHCOMING || statusText === 'forthcoming') return 'Próxima';
  return 'Abierta';
}

// ─── Mapper ───────────────────────────────────────────────────────────────────
function mapTopic(id, detail) {
  const estado = resolverEstado(detail);
  if (!estado) return null; // descartar cerradas/caducadas

  const d = detail?.topicDetails || detail?.details || detail || {};

  const title    = (d.title || d.topicTitle || id).slice(0, 200);
  const deadline = d.deadlineDate || d.deadline || d.submissionDeadline || null;
  const budget   = d.budgetTopicAction || d.budget || d.totalBudget || null;
  const prog     = d.programmeName || d.callTitle || d.frameworkProgramme || '';
  const desc     = stripHtml(d.description || d.objective || d.topicDescription || '');
  const pubDate  = d.openingDate || d.startDate || d.publicationDate || null;
  const tags     = d.tags || d.keywords || [];

  return {
    id:               'eu-' + id,
    titulo:           title,
    organismo:        prog ? `Comisión Europea — ${prog}` : 'Comisión Europea',
    ambito:           'eu',
    fuente:           'eu',
    estado,
    beneficiario:     inferirBenef(tags, title),
    importe:          fmtImporte(budget),
    cierre:           deadline,
    descripcion:      desc.slice(0, 500),
    enlace:           PORTAL_BASE + id.toLowerCase(),
    fechaPublicacion: pubDate,
    referencia:       id.toUpperCase(),
  };
}

// ─── Fetch con timeout ────────────────────────────────────────────────────────
async function fetchTopicDetail(id) {
  const url  = TOPIC_BASE + id.toLowerCase() + '.json';
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

// ─── Procesado en lotes con concurrencia controlada ───────────────────────────
async function fetchBatch(ids, concurrency = 10) {
  const results = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch   = ids.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async id => {
        const detail = await fetchTopicDetail(id);
        if (!detail) return null;
        return mapTopic(id, detail);
      })
    );
    results.push(
      ...settled
        .map(r => (r.status === 'fulfilled' ? r.value : null))
        .filter(Boolean)
    );
  }
  return results;
}

// ─── Handler principal ────────────────────────────────────────────────────────
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
    // Paso 1: obtener lista completa de IDs
    const listCtrl    = new AbortController();
    const listTimeout = setTimeout(() => listCtrl.abort(), 10000);
    const listResp    = await fetch(TOPIC_LIST, {
      headers: { ...HEADERS, Accept: 'text/html' },
      signal:  listCtrl.signal,
    });
    clearTimeout(listTimeout);
    if (!listResp.ok) throw new Error(`topic-list HTTP ${listResp.status}`);

    const html   = await listResp.text();
    const allIds = [];
    const re     = /topic-details\/([\w-]+)/gi;
    let m;
    while ((m = re.exec(html)) !== null) allIds.push(m[1]);
    if (!allIds.length) throw new Error('No se encontraron IDs en topic-list.html');

    // Paso 2: filtrar IDs con año actual o siguiente
    const yr1     = String(NOW.getFullYear());      // 2026
    const yr2     = String(NOW.getFullYear() - 1);  // 2025 (pueden aún estar abiertas)
    const yr3     = String(NOW.getFullYear() + 1);  // 2027 (forthcoming)

    const recentIds = allIds.filter(id => {
      const l = id.toLowerCase();
      return l.includes(yr1) || l.includes(yr2) || l.includes(yr3);
    });

    // Si hay pocos, ampliar la búsqueda
    const idsToFetch = recentIds.length >= 5 ? recentIds : allIds.filter(id =>
      id.toLowerCase().includes('2024') || id.toLowerCase().includes('2025') ||
      id.toLowerCase().includes('2026') || id.toLowerCase().includes('2027')
    );

    // Paso 3: consultar detalles — procesar hasta 80 IDs dentro del timeout de Vercel
    const sample = idsToFetch.slice(0, 80);
    const data   = await fetchBatch(sample, 10);

    if (!data.length) {
      return res.status(200).json({
        ok:          true,
        fuente:      'eu',
        total:       0,
        advertencia: 'No se encontraron convocatorias abiertas o próximas para los años ' + [yr2, yr1, yr3].join('/'),
        data:        [],
      });
    }

    // Paso 4: ordenar — Abiertas primero, luego Próximas; dentro de cada grupo por deadline ascendente
    data.sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'Abierta' ? -1 : 1;
      if (!a.cierre && !b.cierre) return 0;
      if (!a.cierre) return 1;
      if (!b.cierre) return -1;
      return new Date(a.cierre) - new Date(b.cierre);
    });

    return res.status(200).json({
      ok:     true,
      fuente: 'eu',
      via:    'topicDetails JSON (filtrado por estado y deadline)',
      total:  data.length,
      data,
    });

  } catch (err) {
    console.error('EU handler error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
