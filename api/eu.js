/**
 * /api/eu.js — versión definitiva sin filtros en query
 *
 * La Search API ignora los filtros status/type del query JSON.
 * Solución: query mínimo (solo prefix), filtrar todo client-side.
 *
 * Para cada prefijo de call obtenemos 50 resultados y filtramos:
 *   - language == "en"
 *   - type in [1,2,8]
 *   - status in [31094501, 31094502]
 *   - deadline en el futuro (para abiertas)
 */

const SEARCH_URL  = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const NOW         = new Date();

const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept':       'application/json',
  'User-Agent':   'Mozilla/5.0 (compatible; FinanciApp/2.0; +https://financiapp-wvx2.vercel.app)',
};

const CALL_PREFIXES = [
  'HORIZON-MSCA-2026','HORIZON-MSCA-2027',
  'HORIZON-EIC-2026','HORIZON-EIC-2027',
  'HORIZON-CL1-2026','HORIZON-CL2-2027',
  'HORIZON-CL3-2026','HORIZON-CL3-2027',
  'HORIZON-CL4-2026','HORIZON-CL5-2026',
  'HORIZON-CL5-2027','HORIZON-CL6-2026',
  'HORIZON-EIE-2026','HORIZON-EIE-2027',
  'HORIZON-HLTH-2026','HORIZON-HLTH-2027',
  'HORIZON-MISS-2026','HORIZON-MISS-2027',
  'HORIZON-INFRA-2026','HORIZON-WIDERA-2026',
  'DIGITAL-2026',
  'LIFE-2026','LIFE-2025-SAP',
  'ERASMUS-EDU-2026','ERASMUS-YOUTH-2026','ERASMUS-SPORT-2026',
  'CERV-2026',
  'CEF-T-2026','CEF-E-2026','CEF-DIG-2025',
  'CREA-MEDIA-2026','CREA-CULT-2026',
  'EU4H-2026',
  'SMP-COSME-2026',
  'EDF-2025','EDF-2026',
  'JUST-2026',
  'ESC-2026',
  'INNOVFUND-2026',
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
  if (t.includes('sme')||t.includes('enterprise')||t.includes('startup')) return 'Empresa';
  if (t.includes('ngo')||t.includes('civil society')||t.includes('non-profit')) return 'ONG / Tercer sector';
  if (t.includes('research')||t.includes('university')||t.includes('academic')||t.includes('doctoral')) return 'Universidad / Investigación';
  if (t.includes('public')||t.includes('authority')||t.includes('municipal')) return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

// ─── Mapper ─────────────────────────────────────────────────────────────────

function mapResult(item) {
  const md = item.metadata || {};

  // Debug: ver valores reales de los campos clave
  const rawStatus   = first(md.status);
  const rawType     = first(md.type);
  const rawLang     = first(md.language) || item.language;
  const rawDeadline = first(md.deadlineDate);
  const rawTitle    = first(md.title) || item.title || item.content || '';
  const rawId       = first(md.identifier) || first(md.callIdentifier) || item.reference || '';

  // Filtro idioma: solo inglés
  if (rawLang && rawLang !== 'en') return null;

  // Filtro tipo: solo grants
  const typeStr = String(rawType||'').trim();
  if (!['1','2','8'].includes(typeStr)) return null;

  // Filtro estado
  const statusStr = String(rawStatus||'').trim();
  if (statusStr === '31094503' || !statusStr) return null;
  if (!['31094501','31094502'].includes(statusStr)) return null;

  let estado = statusStr === '31094502' ? 'Próxima' : 'Abierta';

  // Filtro deadline
  const deadline = parseDate(rawDeadline);
  if (estado === 'Abierta' && deadline && !isFuture(deadline)) return null;

  if (!rawTitle || !rawId) return null;

  const prog   = first(md.programmeName)||first(md.frameworkProgramme)||first(md.callTitle)||'';
  const desc   = stripHtml(item.content||first(md.description)||'');
  const budget = fmtImporte(first(md.budgetOverview)||first(md.budget));
  const pubDate= parseDate(first(md.startDate)||first(md.openingDate));
  const tags   = md.keywords||md.tags||[];
  const urlRaw = first(md.esST_URL)||first(md.url)||'';
  const enlace = (urlRaw&&urlRaw!=='NA')
    ? urlRaw.replace(/^uri -> /,'').trim()
    : PORTAL_BASE+rawId.toLowerCase();

  return {
    id:               'eu-'+rawId,
    titulo:           String(rawTitle).slice(0,200),
    organismo:        prog?`Comisión Europea — ${prog}`:'Comisión Europea',
    ambito:'eu', fuente:'eu', estado,
    beneficiario:     inferirBenef(tags,rawTitle),
    importe:          budget, cierre: deadline,
    descripcion:      desc.slice(0,500),
    enlace, fechaPublicacion: pubDate,
    referencia:       rawId.toUpperCase(),
  };
}

// ─── Fetch por prefijo — SIN filtros en query ────────────────────────────────

async function fetchByPrefix(prefix) {
  // Query mínimo: solo el prefijo en el texto de búsqueda
  // NO ponemos filtros status/type en el query — los aplica la API ignorándolos
  const fd = new URLSearchParams();
  fd.append('languages',  '["en"]');
  fd.append('pageNumber', '1');
  fd.append('pageSize',   '50');
  fd.append('query', JSON.stringify({
    bool: { must: [{ prefix: { callIdentifier: prefix } }] }
  }));

  const ctrl = new AbortController();
  const t    = setTimeout(()=>ctrl.abort(), 9000);
  try {
    const r = await fetch(SEARCH_URL, {
      method:'POST', headers:HEADERS, body:fd.toString(), signal:ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) return { items:[], prefix, error:`HTTP ${r.status}` };
    const json = await r.json();
    return { items: json.results||[], prefix };
  } catch(e) {
    clearTimeout(t);
    return { items:[], prefix, error:e.message };
  }
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
    const batches = await Promise.allSettled(
      CALL_PREFIXES.map(p => fetchByPrefix(p))
    );

    const allItems = batches
      .filter(r=>r.status==='fulfilled')
      .flatMap(r=>r.value.items);

    // Diagnóstico: distribución de status y type en los primeros resultados
    const distStatus = {};
    const distType   = {};
    const distLang   = {};
    allItems.slice(0,200).forEach(item => {
      const md = item.metadata||{};
      const s  = String(first(md.status)||'null');
      const tp = String(first(md.type)||'null');
      const lg = String(first(md.language)||item.language||'null');
      distStatus[s] = (distStatus[s]||0)+1;
      distType[tp]  = (distType[tp]||0)+1;
      distLang[lg]  = (distLang[lg]||0)+1;
    });

    // Mapear con filtros client-side
    const seen = new Set();
    const data = allItems
      .map(mapResult)
      .filter(Boolean)
      .filter(item => { if(seen.has(item.id)) return false; seen.add(item.id); return true; });

    data.sort((a,b) => {
      if (a.estado!==b.estado) return a.estado==='Abierta'?-1:1;
      if (!a.cierre&&!b.cierre) return 0;
      if (!a.cierre) return 1; if (!b.cierre) return -1;
      return new Date(a.cierre)-new Date(b.cierre);
    });

    return res.status(200).json({
      ok:true, fuente:'eu',
      via:'Search API prefix query — filtro client-side',
      prefijos: CALL_PREFIXES.length,
      crudos:   allItems.length,
      dist_status: distStatus,
      dist_type:   distType,
      dist_lang:   distLang,
      total:    data.length,
      data,
    });
  } catch(err) {
    return res.status(500).json({ok:false,error:err.message});
  }
};
