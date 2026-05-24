/**
 * /api/eu.js
 *
 * La Search API pública de SEDIA no permite filtrar por estado ni ordenar
 * de forma útil — siempre devuelve el mismo conjunto de convocatorias cerradas.
 *
 * Solución: lista curada de IDs activos (open/forthcoming) extraídos directamente
 * del portal oficial, complementada con llamadas a topicDetails para datos en tiempo real.
 *
 * Los IDs forthcoming 2026-2027 fueron verificados en el portal el 24/05/2026.
 * Se actualiza la lista periódicamente añadiendo nuevos IDs confirmados.
 */

const DETAIL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const NOW         = new Date();

// ─── Lista de IDs activos verificados en el portal (open + forthcoming) ───────
// Fuente: portal EU F&T, verificados 24/05/2026
const ACTIVE_IDS = [
  // Forthcoming 2027 — Clúster 5 (Clima, Energía, Movilidad)
  'HORIZON-CL5-2027-07-D3-16','HORIZON-CL5-2027-07-D3-11','HORIZON-CL5-2027-07-D3-32',
  'HORIZON-CL5-2027-07-D3-26','HORIZON-CL5-2027-07-D3-27','HORIZON-CL5-2027-07-D3-28',
  'HORIZON-CL5-2027-07-D3-25','HORIZON-CL5-2027-07-D3-17',
  'HORIZON-CL5-2027-06-D6-12','HORIZON-CL5-2027-06-D6-05','HORIZON-CL5-2027-06-D6-08',
  'HORIZON-CL5-2027-06-D6-04','HORIZON-CL5-2027-06-D6-11',
  'HORIZON-CL5-2027-05-D2-08','HORIZON-CL5-2027-05-D4-06','HORIZON-CL5-2027-05-D4-09',
  'HORIZON-CL5-2027-05-D4-05','HORIZON-CL5-2027-05-D4-07',
  // Forthcoming 2027 — Clúster 3 (Seguridad civil)
  'HORIZON-CL3-2027-01-DRS-02',
  // Forthcoming 2027 — Clúster 2 (Cultura, Creatividad, Sociedad)
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
  // Forthcoming 2027 — Health
  'HORIZON-HLTH-2027-03-TOOL-02','HORIZON-HLTH-2027-03-TOOL-04','HORIZON-HLTH-2027-03-TOOL-08',
  // Forthcoming 2027 — EIE (Innovación)
  'HORIZON-EIE-2027-01-CONNECT-01','HORIZON-EIE-2027-01-CONNECT-02','HORIZON-EIE-2027-01-CONNECT-03',
  // Forthcoming 2027 — MSCA
  'HORIZON-MSCA-2027-DN-01-01',
  // Open/Forthcoming 2026 — añadir más según se confirmen
  'HORIZON-CL4-2026-HUMAN-02-01','HORIZON-CL4-2026-RESILIENCE-01',
  'HORIZON-EIC-2026-PATHFINDER-01','HORIZON-EIC-2026-ACCELERATOR-01',
  'HORIZON-MSCA-2026-SE-01-01','HORIZON-MSCA-2026-PF-01-01',
  'HORIZON-CL6-2026-GOVERNANCE-01-01','HORIZON-CL6-2026-FARM2FORK-01',
  'HORIZON-CL1-2026-DISEASE-04-01','HORIZON-CL1-2026-PREVENTION-01',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FinanciApp/2.0; +https://financiapp-wvx2.vercel.app)',
  'Accept':     'application/json',
  'Referer':    'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

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

function parseDeadline(dl) {
  if (!dl) return null;
  // Puede ser string "17 March 2016", timestamp ms, o ISO
  if (typeof dl === 'number' || /^\d{10,}$/.test(String(dl))) {
    try { return new Date(Number(dl)).toISOString(); } catch {}
  }
  try {
    const d = new Date(dl);
    if (!isNaN(d)) return d.toISOString();
  } catch {}
  return String(dl);
}

function isInFuture(dlStr) {
  if (!dlStr) return true; // sin deadline = asumir futuro
  try {
    const d = new Date(dlStr);
    if (isNaN(d)) return true; // no parseable = asumir futuro
    return d > NOW;
  } catch { return true; }
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
  if (!td?.identifier || !td?.title) return null;

  const actions = td.actions || [];
  let estado    = null;
  let deadline  = null;
  let openDate  = null;

  for (const action of actions) {
    const statusId   = action?.status?.id;
    const statusAbbr = (action?.status?.abbreviation || '').toLowerCase();

    if (statusId === 31094503 || statusAbbr === 'closed') continue;

    const dl = parseDeadline(action?.deadlineDates?.[0]);

    if (statusAbbr === 'forthcoming' || statusId === 31094502) {
      estado   = 'Próxima';
      deadline = dl;
      openDate = parseDeadline(action?.plannedOpeningDate);
      break;
    }
    if (statusAbbr === 'open' || statusId === 31094501) {
      if (!isInFuture(dl)) continue;
      estado   = 'Abierta';
      deadline = dl;
      break;
    }
  }

  // Si no encontró estado activo en actions, inferir por deadline
  if (!estado) {
    // Intentar con callDetailsJSONItem
    const cdi = td.callDetailsJSONItem;
    if (cdi?.hasOpenTopics)        estado = 'Abierta';
    else if (cdi?.hasForthcomingTopics) estado = 'Próxima';
    else return null;
  }

  // Presupuesto
  let budget = null;
  try {
    const bmap = td.budgetOverviewJSONItem?.budgetTopicActionMap || {};
    const vals = Object.values(bmap).flat()
      .map(a => Object.values(a?.budgetYearMap || {}).reduce((s, v) => s + parseFloat(v||0), 0));
    const total = vals.reduce((s, v) => s + v, 0);
    budget = fmtImporte(total);
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
    fechaPublicacion: openDate,
    referencia:       td.identifier.toUpperCase(),
  };
}

async function fetchTopicDetail(id) {
  const url  = DETAIL_BASE + id.toLowerCase() + '.json';
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), 7000);
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

async function processBatch(ids, concurrency = 10) {
  const results = [];
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch   = ids.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async id => {
        const json = await fetchTopicDetail(id);
        return json ? mapTopicDetail(json) : null;
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
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  try {
    const data = await processBatch(ACTIVE_IDS, 10);

    data.sort((a, b) => {
      if (a.estado !== b.estado) return a.estado === 'Abierta' ? -1 : 1;
      if (!a.cierre && !b.cierre) return 0;
      if (!a.cierre) return 1;
      if (!b.cierre) return -1;
      return new Date(a.cierre) - new Date(b.cierre);
    });

    return res.status(200).json({
      ok:    true,
      fuente: 'eu',
      via:   'topicDetails (IDs curados)',
      total: data.length,
      data,
    });

  } catch (err) {
    console.error('EU error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
