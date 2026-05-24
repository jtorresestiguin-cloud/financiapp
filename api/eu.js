/**
 * /api/eu.js
 *
 * Estrategia definitiva para cubrir todas las tipologías de ayudas EU activas:
 *
 * 1. FUENTES DE DESCUBRIMIENTO DE IDs:
 *    a) RSS callupdates-rss.xml  → IDs de convocatorias con cambios recientes
 *    b) Lista curada ACTIVE_IDS  → IDs verificados manualmente (fallback garantizado)
 *
 * 2. Para cada ID obtenido → consulta topicDetails JSON
 *
 * 3. Filtro: solo actions con status Open (31094501) o Forthcoming (31094502)
 *
 * Esto cubre: Horizon Europe, LIFE, ERASMUS+, CEF, COSME, FSE+, FEDER, EIC,
 *             MSCA, Marie Curie, Creative Europe, Connecting Europe Facility, etc.
 */

const RSS_URL     = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/referenceData/callupdates-rss.xml';
const DETAIL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const NOW         = new Date();

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FinanciApp/2.0; +https://financiapp-wvx2.vercel.app)',
  'Accept':     'application/json, application/xml, text/xml, */*',
  'Referer':    'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

// ─── Lista curada de IDs activos verificados (garantiza datos aunque el RSS falle) ─
const CURATED_IDS = [
  // MSCA 2026-2027
  'HORIZON-MSCA-2026-PF-01-01','HORIZON-MSCA-2027-DN-01-01',
  // EIC 2026
  'HORIZON-EIC-2026-ACCELERATOR-01',
  // Clúster 5 — Clima, Energía, Movilidad 2027
  'HORIZON-CL5-2027-07-D3-16','HORIZON-CL5-2027-07-D3-11','HORIZON-CL5-2027-07-D3-32',
  'HORIZON-CL5-2027-07-D3-26','HORIZON-CL5-2027-07-D3-27','HORIZON-CL5-2027-07-D3-28',
  'HORIZON-CL5-2027-07-D3-25','HORIZON-CL5-2027-07-D3-17',
  'HORIZON-CL5-2027-06-D6-12','HORIZON-CL5-2027-06-D6-05','HORIZON-CL5-2027-06-D6-08',
  'HORIZON-CL5-2027-06-D6-04','HORIZON-CL5-2027-06-D6-11',
  'HORIZON-CL5-2027-05-D2-08','HORIZON-CL5-2027-05-D4-06','HORIZON-CL5-2027-05-D4-09',
  'HORIZON-CL5-2027-05-D4-05','HORIZON-CL5-2027-05-D4-07',
  // Clúster 3 — Seguridad civil 2027
  'HORIZON-CL3-2027-01-DRS-02',
  // Clúster 2 — Cultura, Creatividad, Sociedad 2027
  'HORIZON-CL2-2027-01-HERITAGE-05','HORIZON-CL2-2027-01-HERITAGE-06',
  'HORIZON-CL2-2027-01-HERITAGE-01','HORIZON-CL2-2027-01-HERITAGE-04',
  'HORIZON-CL2-2027-01-HERITAGE-03','HORIZON-CL2-2027-01-HERITAGE-08',
  'HORIZON-CL2-2027-01-HERITAGE-02','HORIZON-CL2-2027-01-HERITAGE-07',
  'HORIZON-CL2-2027-01-TRANSFO-01','HORIZON-CL2-2027-01-TRANSFO-02',
  'HORIZON-CL2-2027-01-TRANSFO-03','HORIZON-CL2-2027-01-TRANSFO-04',
  'HORIZON-CL2-2027-01-TRANSFO-05','HORIZON-CL2-2027-01-TRANSFO-06',
  'HORIZON-CL2-2027-01-TRANSFO-07','HORIZON-CL2-2027-01-TRANSFO-08',
  'HORIZON-CL2-2027-01-DEMOCRACY-01','HORIZON-CL2-2027-01-DEMOCRACY-02',
  'HORIZON-CL2-2027-01-DEMOCRACY-03','HORIZON-CL2-2027-01-DEMOCRACY-04',
  'HORIZON-CL2-2027-01-DEMOCRACY-05','HORIZON-CL2-2027-01-DEMOCRACY-06',
  'HORIZON-CL2-2027-01-DEMOCRACY-07','HORIZON-CL2-2027-01-DEMOCRACY-08',
  // Health 2027
  'HORIZON-HLTH-2027-03-TOOL-02','HORIZON-HLTH-2027-03-TOOL-04','HORIZON-HLTH-2027-03-TOOL-08',
  // EIE — Innovación ecosistemas 2027
  'HORIZON-EIE-2027-01-CONNECT-01','HORIZON-EIE-2027-01-CONNECT-02','HORIZON-EIE-2027-01-CONNECT-03',
  // Otros programas EU activos (no Horizon)
  'LIFE-2025-SAP-NAT-NATURE','LIFE-2025-SAP-ENV-ENVIRONMENT',
  'CERV-2025-DAPHNE','CERV-2025-CITIZENS-TOWN',
  'SMP-COSME-2025-CLUSTER','SMP-COSME-2025-ENTRECOMP',
  'CEF-T-2025-AFIF-RAILS','CEF-T-2025-MULTIMODAL',
  'ERASMUS-EDU-2025-PI-ALL-INNO','ERASMUS-EDU-2025-PEX-COVE',
  'ERASMUS-YOUTH-2025-SCP','ERASMUS-YOUTH-2025-CBHE',
  'DL-VA-25-09','DL-VA-25-10',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#\d]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function fmtImporte(n) {
  if (!n) return null;
  const v = parseFloat(String(n).replace(/[^0-9.]/g, ''));
  if (isNaN(v) || v === 0) return null;
  if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `€${Math.round(v / 1_000)}K`;
  return `€${Math.round(v).toLocaleString('es-ES')}`;
}

function parseDate(d) {
  if (!d) return null;
  if (typeof d === 'number' || /^\d{10,}$/.test(String(d))) {
    try { return new Date(Number(d)).toISOString(); } catch {}
  }
  try { const dt = new Date(d); if (!isNaN(dt)) return dt.toISOString(); } catch {}
  return String(d);
}

function isFuture(s) {
  if (!s) return true;
  try { const d = new Date(s); return isNaN(d) || d > NOW; } catch { return true; }
}

function inferirBenef(keywords, title) {
  const t = ([...(Array.isArray(keywords) ? keywords : []), title || '']).join(' ').toLowerCase();
  if (t.includes('sme') || t.includes('enterprise') || t.includes('startup') || t.includes('company')) return 'Empresa';
  if (t.includes('ngo') || t.includes('civil society') || t.includes('non-profit') || t.includes('association')) return 'ONG / Tercer sector';
  if (t.includes('research') || t.includes('university') || t.includes('academic') || t.includes('higher education')) return 'Universidad / Investigación';
  if (t.includes('public') || t.includes('authority') || t.includes('municipality') || t.includes('local')) return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

function progStr(fp) {
  if (!fp) return null;
  if (typeof fp === 'string') return fp;
  if (fp.description) return fp.description;
  if (fp.abbreviation) return fp.abbreviation;
  if (Array.isArray(fp)) return fp[0] ? progStr(fp[0]) : null;
  return null;
}

// ─── Mapear topicDetails JSON al esquema normalizado ───────────────────────

function mapTopicDetail(json) {
  const td = json?.TopicDetails;
  if (!td?.identifier || !td?.title) return null;

  const actions = Array.isArray(td.actions) ? td.actions : [];
  let estado   = null;
  let deadline = null;
  let openDate = null;

  for (const action of actions) {
    const sid   = action?.status?.id;
    const sabb  = (action?.status?.abbreviation || '').toLowerCase();
    if (sid === 31094503 || sabb === 'closed') continue;

    const dl = parseDate(action?.deadlineDates?.[0]);

    if (sabb === 'forthcoming' || sid === 31094502) {
      estado   = 'Próxima';
      deadline = dl;
      openDate = parseDate(action?.plannedOpeningDate);
      break;
    }
    if (sabb === 'open' || sid === 31094501) {
      if (!isFuture(dl)) continue;
      estado   = 'Abierta';
      deadline = dl;
      break;
    }
  }

  // Fallback: callDetailsJSONItem
  if (!estado) {
    const cdi = td.callDetailsJSONItem;
    if (cdi?.hasOpenTopics)             estado = 'Abierta';
    else if (cdi?.hasForthcomingTopics) estado = 'Próxima';
    else return null;
  }

  // Presupuesto
  let budget = null;
  try {
    const bmap = td.budgetOverviewJSONItem?.budgetTopicActionMap || {};
    const total = Object.values(bmap).flat()
      .reduce((s, a) => s + Object.values(a?.budgetYearMap || {})
        .reduce((ss, v) => ss + parseFloat(v || 0), 0), 0);
    budget = fmtImporte(total);
  } catch {}

  const prog = progStr(td.frameworkProgramme) || td.callTitle || null;

  return {
    id:               'eu-' + td.identifier,
    titulo:           String(td.title).slice(0, 200),
    organismo:        prog ? `Comisión Europea — ${prog}` : 'Comisión Europea',
    ambito:           'eu',
    fuente:           'eu',
    estado,
    beneficiario:     inferirBenef(td.keywords, td.title),
    importe:          budget,
    cierre:           deadline,
    descripcion:      stripHtml(td.description || '').slice(0, 500),
    enlace:           PORTAL_BASE + td.identifier.toLowerCase(),
    fechaPublicacion: openDate,
    referencia:       td.identifier.toUpperCase(),
  };
}

// ─── Fetch topicDetails individual ─────────────────────────────────────────

async function fetchDetail(id) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), 7000);
  try {
    const r = await fetch(DETAIL_BASE + id.toLowerCase() + '.json', {
      headers: HEADERS, signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch { clearTimeout(t); return null; }
}

// ─── Descubrir IDs desde el RSS de callupdates ─────────────────────────────
// El RSS contiene <identifier> de convocatorias con actualizaciones recientes
// → mezcla de open, forthcoming y closed; filtramos en mapTopicDetail

async function discoverFromRSS() {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), 8000);
  const ids  = new Set();
  try {
    const r = await fetch(RSS_URL, {
      headers: { ...HEADERS, Accept: 'application/xml, text/xml' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const xml = await r.text();

    // Extraer <identifier> y <callIdentifier> del RSS
    const re1 = /<(?:[\w]+:)?identifier[^>]*>([^<]+)<\/(?:[\w]+:)?identifier>/gi;
    const re2 = /HORIZON-[\w-]{6,}/g;
    let m;
    while ((m = re1.exec(xml)) !== null) {
      const v = m[1].trim();
      if (v.length > 5) ids.add(v);
    }
    while ((m = re2.exec(xml)) !== null) ids.add(m[0]);

    // También extraer de <link> URLs del tipo topic-details/ID
    const re3 = /topic-details\/([\w-]+)/gi;
    while ((m = re3.exec(xml)) !== null) ids.add(m[1].toUpperCase());

  } catch(e) { clearTimeout(t); console.warn('RSS discover error:', e.message); }
  return [...ids];
}

// ─── Procesar lotes con concurrencia controlada ─────────────────────────────

async function processBatch(ids, concurrency = 12) {
  const results = [];
  const seen    = new Set();
  const unique  = ids.filter(id => { if (seen.has(id)) return false; seen.add(id); return true; });

  for (let i = 0; i < unique.length; i += concurrency) {
    const batch   = unique.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async id => {
        const json = await fetchDetail(id);
        return json ? mapTopicDetail(json) : null;
      })
    );
    results.push(...settled.map(r => r.status === 'fulfilled' ? r.value : null).filter(Boolean));
  }
  return results;
}

// ─── Handler principal ──────────────────────────────────────────────────────

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
    // Paso 1: descubrir IDs del RSS (nuevas convocatorias con actualizaciones)
    const rssIds = await discoverFromRSS();

    // Paso 2: combinar con lista curada, priorizando RSS (más recientes)
    // Limitar a 100 IDs para no superar el timeout de Vercel (10s)
    const allIds    = [...new Set([...rssIds, ...CURATED_IDS])];
    const toProcess = allIds.slice(0, 100);

    // Paso 3: obtener detalles y filtrar activos
    const data = await processBatch(toProcess, 12);

    // Paso 4: ordenar — Abiertas por deadline ASC, luego Próximas
    data.sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'Abierta' ? -1 : 1;
      if (!a.cierre && !b.cierre) return 0;
      if (!a.cierre) return 1;
      if (!b.cierre) return -1;
      return new Date(a.cierre) - new Date(b.cierre);
    });

    return res.status(200).json({
      ok:              true,
      fuente:          'eu',
      via:             'RSS callupdates + IDs curados → topicDetails',
      ids_rss:         rssIds.length,
      ids_curados:     CURATED_IDS.length,
      ids_procesados:  toProcess.length,
      total:           data.length,
      data,
    });

  } catch (err) {
    console.error('EU error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
