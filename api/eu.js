/**
 * /api/eu.js
 *
 * Estrategia:
 *   1. Lee https://ec.europa.eu/info/funding-tenders/opportunities/data/topic-list.html
 *      → fichero HTML estático con TODOS los identificadores de tópicos
 *   2. Filtra los que contienen "2025" o "2026" en el identificador
 *   3. Para cada uno consulta el JSON de detalle:
 *      https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/{id}.json
 *   4. Filtra los que tienen status "Open" o "Forthcoming"
 *   5. Devuelve el array normalizado
 *
 * Vercel cachea la respuesta 30 min para no saturar el portal EU.
 */

const TOPIC_LIST = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topic-list.html';
const TOPIC_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';

const HEADERS = {
  'User-Agent':    'Mozilla/5.0 (compatible; FinanciApp/2.0; +https://financiapp-wvx2.vercel.app)',
  'Accept':        'application/json, text/html, */*',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Referer':       'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
};

// Estados que consideramos activos
const ESTADOS_ACTIVOS = new Set(['open', 'forthcoming', 'abierta', 'open for submission']);

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
  if (t.includes('ngo') || t.includes('civil society') || t.includes('non-profit') || t.includes('association')) return 'ONG / Tercer sector';
  if (t.includes('research') || t.includes('university') || t.includes('academic') || t.includes('higher education')) return 'Universidad / Investigación';
  if (t.includes('public') || t.includes('authority') || t.includes('municipality')) return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

function mapTopic(id, detail) {
  // La respuesta JSON tiene distintas estructuras según el programa
  const d = detail?.topicDetails || detail?.details || detail || {};

  const title      = d.title       || d.topicTitle    || id;
  const statusRaw  = (d.status     || d.topicStatus   || '').toLowerCase().trim();
  const deadline   = d.deadlineDate || d.deadline     || d.submissionDeadline || null;
  const budget     = d.budgetTopicAction || d.budget  || d.totalBudget || null;
  const prog       = d.programmeName    || d.callTitle || d.frameworkProgramme || '';
  const desc       = stripHtml(d.description || d.objective || d.topicDescription || '');
  const pubDate    = d.openingDate  || d.startDate    || d.publicationDate || null;
  const tags       = d.tags         || d.keywords     || [];

  // Determinar estado
  let estado = 'Abierta';
  if (statusRaw.includes('forthcoming') || statusRaw === '31094502') estado = 'Próxima';
  else if (statusRaw.includes('closed') || statusRaw === '31094503') estado = 'Cerrada';
  else if (deadline) {
    try { if (new Date(deadline) < new Date()) estado = 'Cerrada'; } catch {}
  }

  return {
    id:               'eu-' + id,
    titulo:           title.slice(0, 200),
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

// Obtiene los detalles de un tópico con timeout
async function fetchTopicDetail(id) {
  const url = TOPIC_BASE + id.toLowerCase() + '.json';
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const json = await r.json();
    return json;
  } catch {
    clearTimeout(t);
    return null;
  }
}

// Procesa un lote de IDs en paralelo (máx N concurrentes)
async function fetchBatch(ids, concurrency = 8) {
  const results = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async id => {
        const detail = await fetchTopicDetail(id);
        if (!detail) return null;
        const mapped = mapTopic(id, detail);
        // Filtrar solo activos
        if (mapped.estado === 'Cerrada') return null;
        return mapped;
      })
    );
    results.push(...settled.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean));
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
  // Cache 30 min en Vercel Edge — evita saturar el portal EU
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  try {
    // ── Paso 1: obtener la lista completa de IDs ───────────────────────────
    const listCtrl = new AbortController();
    const listTimeout = setTimeout(() => listCtrl.abort(), 10000);

    const listResp = await fetch(TOPIC_LIST, {
      headers: { ...HEADERS, Accept: 'text/html' },
      signal: listCtrl.signal,
    });
    clearTimeout(listTimeout);

    if (!listResp.ok) throw new Error(`topic-list HTTP ${listResp.status}`);
    const html = await listResp.text();

    // Extraer todos los identificadores de los hrefs
    // Formato: /topic-details/IDENTIFICADOR
    const allIds = [];
    const re = /topic-details\/([\w-]+)/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      allIds.push(m[1]);
    }

    if (!allIds.length) throw new Error('No se encontraron IDs en topic-list.html');

    // ── Paso 2: filtrar IDs de 2025 y 2026 ────────────────────────────────
    const currentYear = new Date().getFullYear();
    const nextYear    = currentYear + 1;
    const recentIds   = allIds.filter(id => {
      const lower = id.toLowerCase();
      return lower.includes(String(currentYear)) || lower.includes(String(nextYear));
    });

    // Si hay pocos IDs recientes, ampliar a años anteriores como respaldo
    const idsToFetch = recentIds.length >= 10
      ? recentIds
      : allIds.filter(id => {
          const lower = id.toLowerCase();
          return lower.includes('2024') || lower.includes('2025') || lower.includes('2026');
        });

    // ── Paso 3: obtener detalles en paralelo ──────────────────────────────
    // Limitar a 60 IDs máximo para no superar el timeout de Vercel (10s)
    const sample = idsToFetch.slice(0, 60);
    const data   = await fetchBatch(sample, 10);

    if (!data.length) throw new Error('Ningún tópico activo encontrado');

    // Ordenar: primero Abierta, luego Próxima; dentro de cada grupo por fecha de cierre
    data.sort((a, b) => {
      if (a.estado === b.estado) {
        if (!a.cierre) return 1;
        if (!b.cierre) return -1;
        return new Date(a.cierre) - new Date(b.cierre);
      }
      return a.estado === 'Abierta' ? -1 : 1;
    });

    return res.status(200).json({
      ok:     true,
      fuente: 'eu',
      via:    'topic-list + topicDetails JSON',
      total:  data.length,
      data,
    });

  } catch (err) {
    console.error('EU handler error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
