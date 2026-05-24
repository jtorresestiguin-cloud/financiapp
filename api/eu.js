/**
 * /api/eu.js — versión definitiva multi-programa
 *
 * Usa la Search API con búsqueda por callIdentifier para cada programa,
 * filtrando por idioma inglés y estado activo (open/forthcoming).
 *
 * POST https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***
 * body form-data: query (JSON con filtros), languages=["en"], pageSize, pageNumber
 *
 * Cubre TODOS los programas EU: Horizon, DIGITAL, LIFE, ERASMUS+, CERV,
 * CEF, Creative Europe, EU4Health, SMP, EDF, EMFAF, etc.
 */

const SEARCH_URL  = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const NOW         = new Date();

const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept':       'application/json',
  'User-Agent':   'Mozilla/5.0 (compatible; FinanciApp/2.0; +https://financiapp-wvx2.vercel.app)',
};

// ─── Programas y sus callIdentifiers activos 2025-2027 ──────────────────────
// Cada entrada es un prefijo de callIdentifier que se busca en la API.
// La API devuelve todos los topics de ese call con sus estados reales.
const CALL_PREFIXES = [
  // Horizon Europe
  'HORIZON-MSCA-2026','HORIZON-MSCA-2027',
  'HORIZON-EIC-2026','HORIZON-EIC-2027',
  'HORIZON-CL1-2026','HORIZON-CL2-2027',
  'HORIZON-CL3-2026','HORIZON-CL3-2027',
  'HORIZON-CL4-2026','HORIZON-CL5-2026',
  'HORIZON-CL5-2027','HORIZON-CL6-2026',
  'HORIZON-EIE-2026','HORIZON-EIE-2027',
  'HORIZON-HLTH-2026','HORIZON-HLTH-2027',
  'HORIZON-INFRA-2026','HORIZON-WIDERA-2026',
  'HORIZON-MISS-2026','HORIZON-MISS-2027',
  // Digital Europe
  'DIGITAL-2026',
  // LIFE
  'LIFE-2026',
  // ERASMUS+
  'ERASMUS-EDU-2026','ERASMUS-YOUTH-2026','ERASMUS-SPORT-2026',
  // CERV
  'CERV-2026',
  // CEF
  'CEF-T-2026','CEF-E-2026','CEF-DIG-2025',
  // Creative Europe
  'CREA-MEDIA-2026','CREA-CULT-2026',
  // EU4Health
  'EU4H-2026',
  // SMP / COSME
  'SMP-COSME-2026',
  // European Defence Fund
  'EDF-2025','EDF-2026',
  // Justice
  'JUST-2026',
  // European Solidarity Corps
  'ESC-2026',
  // EMFAF
  'EMFAF-2026',
  // Innovation Fund
  'INNOVFUND-2026',
  // Research Fund Coal & Steel
  'RFCS-2026',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripHtml(s) {
  return (s||'').replace(/<[^>]+>/g,' ').replace(/&[a-z#\d]+;/gi,' ').replace(/\s+/g,' ').trim();
}
function fmtImporte(n) {
  const v=parseFloat(String(n||'').replace(/[^0-9.]/g,''));
  if (isNaN(v)||v===0) return null;
  if (v>=1_000_000) return `€${(v/1_000_000).toFixed(1)}M`;
  if (v>=1_000)     return `€${Math.round(v/1_000)}K`;
  return `€${Math.round(v).toLocaleString('es-ES')}`;
}
function parseDate(d) {
  if (!d) return null;
  try { const dt=new Date(d); if (!isNaN(dt)) return dt.toISOString(); } catch {}
  return null;
}
function isFuture(s) {
  if (!s) return true;
  try { return new Date(s)>NOW; } catch { return true; }
}
function first(f) {
  if (!f) return null;
  return Array.isArray(f)?f[0]??null:f;
}
function inferirBenef(kw,title) {
  const t=([...(Array.isArray(kw)?kw:[]),title||'']).join(' ').toLowerCase();
  if (t.includes('sme')||t.includes('enterprise')||t.includes('startup')||t.includes('compan')) return 'Empresa';
  if (t.includes('ngo')||t.includes('civil society')||t.includes('non-profit')||t.includes('associat')) return 'ONG / Tercer sector';
  if (t.includes('research')||t.includes('university')||t.includes('academic')||t.includes('doctoral')) return 'Universidad / Investigación';
  if (t.includes('public')||t.includes('authority')||t.includes('municipal')||t.includes('local')) return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

// ─── Mapper resultado Search API → convocatoria normalizada ─────────────────

function mapResult(item) {
  const md = item.metadata || {};

  // Filtrar por idioma: solo inglés
  const lang = first(md.language) || item.language || '';
  if (lang && lang !== 'en') return null;

  // Estado
  const statusCode = String(first(md.status)||'').trim();
  if (statusCode === '31094503') return null; // cerrada
  if (!['31094501','31094502'].includes(statusCode)) return null;

  let estado = statusCode === '31094502' ? 'Próxima' : 'Abierta';

  // Deadline
  const deadline = parseDate(first(md.deadlineDate));
  if (estado === 'Abierta' && deadline && !isFuture(deadline)) return null;

  // Tipo: solo grants (1,2,8), no organizaciones ni proyectos
  const typeVal = String(first(md.type)||'').trim();
  if (!['1','2','8'].includes(typeVal)) return null;

  const identifier = first(md.identifier) || first(md.callIdentifier) || item.reference || '';
  const title      = first(md.title) || item.title || item.content || '';
  if (!title || !identifier) return null;

  const prog    = first(md.programmeName) || first(md.frameworkProgramme) || first(md.callTitle) || '';
  const desc    = stripHtml(item.content || first(md.description) || '');
  const budget  = fmtImporte(first(md.budgetOverview) || first(md.budget));
  const pubDate = parseDate(first(md.startDate) || first(md.openingDate));
  const tags    = md.keywords || md.tags || [];

  const urlRaw  = first(md.esST_URL) || first(md.url) || '';
  const enlace  = (urlRaw && urlRaw !== 'NA')
    ? urlRaw.replace(/^uri -> /,'').trim()
    : PORTAL_BASE + identifier.toLowerCase();

  return {
    id:               'eu-' + identifier,
    titulo:           String(title).slice(0,200),
    organismo:        prog ? `Comisión Europea — ${prog}` : 'Comisión Europea',
    ambito:           'eu',
    fuente:           'eu',
    estado,
    beneficiario:     inferirBenef(tags, title),
    importe:          budget,
    cierre:           deadline,
    descripcion:      desc.slice(0,500),
    enlace,
    fechaPublicacion: pubDate,
    referencia:       identifier.toUpperCase(),
  };
}

// ─── Buscar topics por callIdentifier prefix ─────────────────────────────────

async function fetchByCallPrefix(prefix) {
  // Query: buscar por callIdentifier que empiece por el prefijo
  // Filtrar type 1,2,8 y status open+forthcoming
  const query = JSON.stringify({
    bool: {
      must: [
        { terms: { type: ['1','2','8'] } },
        { terms: { status: ['31094501','31094502'] } },
        { prefix: { callIdentifier: prefix } },
      ],
    },
  });

  const fd = new URLSearchParams();
  fd.append('query',      query);
  fd.append('languages',  '["en"]');
  fd.append('pageNumber', '1');
  fd.append('pageSize',   '50');

  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(SEARCH_URL, {
      method: 'POST', headers: HEADERS,
      body: fd.toString(), signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) return [];
    const json = await r.json();
    return json.results || [];
  } catch { clearTimeout(timeout); return []; }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method==='OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Access-Control-Allow-Methods','GET, OPTIONS');
    return res.status(200).end();
  }
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','s-maxage=3600, stale-while-revalidate=7200');

  try {
    // Consultar en paralelo todos los prefijos de call
    const batches = await Promise.allSettled(
      CALL_PREFIXES.map(prefix => fetchByCallPrefix(prefix))
    );

    const allResults = batches
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    // Mapear y filtrar — deduplicar por id
    const seen = new Set();
    const data = allResults
      .map(mapResult)
      .filter(Boolean)
      .filter(item => {
        if (seen.has(item.id)) return false;
        seen.add(item.id); return true;
      });

    // Ordenar: Abiertas primero por deadline ASC, luego Próximas
    data.sort((a,b) => {
      if (a.estado !== b.estado) return a.estado==='Abierta' ? -1 : 1;
      if (!a.cierre && !b.cierre) return 0;
      if (!a.cierre) return 1;
      if (!b.cierre) return -1;
      return new Date(a.cierre) - new Date(b.cierre);
    });

    return res.status(200).json({
      ok: true, fuente: 'eu',
      via: 'Search API por callIdentifier — todos los programas EU',
      prefijos_consultados: CALL_PREFIXES.length,
      resultados_crudos: allResults.length,
      total: data.length,
      data,
    });

  } catch(err) {
    return res.status(500).json({ ok:false, error: err.message });
  }
};
