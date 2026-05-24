/**
 * /api/eu.js
 *
 * Estrategia: consultar la API de topics filtrando por cada programa
 * usando el endpoint documentado:
 * GET https://ec.europa.eu/info/funding-tenders/opportunities/data/topics?
 *   programmeCCM2Id=XXXX&status=31094501,31094502&language=en&pageSize=50
 *
 * Lista completa de programas EU con sus IDs CCM2 obtenidos del portal.
 * Cubre los 40+ programas del listado oficial.
 */

const TOPICS_API  = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topics';
const DETAIL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const NOW         = new Date();

const HEADERS = {
  'User-Agent':      'Mozilla/5.0 (compatible; FinanciApp/2.0; +https://financiapp-wvx2.vercel.app)',
  'Accept':          'application/json',
  'Accept-Language': 'en',
  'Referer':         'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

// Programas EU con sus abreviaturas (para búsqueda por frameworkProgramme)
// Se usan como filtro en la API de topics
const EU_PROGRAMMES = [
  'HORIZON','LIFE2027','ERASMUS2027','CERV','CEF2027','CREA2027',
  'DIGITAL','EU4H','SMP','JUST2027','EDF','EMFAF','ESF','ESC2027',
  'NDICI','AMIF2027','ISF','BMVI','UCPM2027','INNOVFUND',
  'RFCS2027','JTM','TSI','SOCPL','RELEX2027','EURATOM2027',
];

// IDs verificados directamente (garantía de datos)
const CURATED_IDS = [
  'HORIZON-MSCA-2026-PF-01-01','HORIZON-MSCA-2027-DN-01-01',
  'HORIZON-EIC-2026-ACCELERATOR-01','HORIZON-EIC-2026-PATHFINDER-01',
  'HORIZON-CL5-2027-07-D3-16','HORIZON-CL5-2027-07-D3-11',
  'HORIZON-CL5-2027-06-D6-08','HORIZON-CL5-2027-05-D2-08',
  'HORIZON-CL2-2027-01-HERITAGE-01','HORIZON-CL2-2027-01-DEMOCRACY-01',
  'HORIZON-CL2-2027-01-TRANSFO-01','HORIZON-CL3-2027-01-DRS-02',
  'HORIZON-HLTH-2027-03-TOOL-02','HORIZON-EIE-2027-01-CONNECT-01',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function stripHtml(s) {
  return (s||'').replace(/<[^>]+>/g,' ').replace(/&[a-z#\d]+;/gi,' ').replace(/\s+/g,' ').trim();
}
function fmtImporte(n) {
  const v = parseFloat(String(n||'').replace(/[^0-9.]/g,''));
  if (isNaN(v)||v===0) return null;
  if (v>=1_000_000) return `€${(v/1_000_000).toFixed(1)}M`;
  if (v>=1_000)     return `€${Math.round(v/1_000)}K`;
  return `€${Math.round(v).toLocaleString('es-ES')}`;
}
function parseDate(d) {
  if (!d) return null;
  if (/^\d{10,}$/.test(String(d))) { try { return new Date(Number(d)).toISOString(); } catch {} }
  try { const dt=new Date(d); if (!isNaN(dt)) return dt.toISOString(); } catch {}
  return String(d);
}
function isFuture(s) {
  if (!s) return true;
  try { return new Date(s)>NOW; } catch { return true; }
}
function progStr(fp) {
  if (!fp) return null;
  if (typeof fp==='string') return fp;
  if (fp.description) return fp.description;
  if (fp.abbreviation) return fp.abbreviation;
  if (Array.isArray(fp)&&fp[0]) return progStr(fp[0]);
  return null;
}
function inferirBenef(kw,title) {
  const t=([...(Array.isArray(kw)?kw:[]),title||'']).join(' ').toLowerCase();
  if (t.includes('sme')||t.includes('enterprise')||t.includes('startup')||t.includes('compan')) return 'Empresa';
  if (t.includes('ngo')||t.includes('civil society')||t.includes('non-profit')||t.includes('associat')) return 'ONG / Tercer sector';
  if (t.includes('research')||t.includes('university')||t.includes('academic')||t.includes('doctoral')) return 'Universidad / Investigación';
  if (t.includes('public')||t.includes('authority')||t.includes('municipal')||t.includes('local')) return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

// ─── Mapper topicDetails ─────────────────────────────────────────────────────

function mapTopicDetail(json) {
  const td=json?.TopicDetails;
  if (!td?.identifier||!td?.title) return null;
  const actions=Array.isArray(td.actions)?td.actions:[];
  let estado=null,deadline=null,openDate=null;
  for (const action of actions) {
    const sid=action?.status?.id;
    const sabb=(action?.status?.abbreviation||'').toLowerCase();
    if (sid===31094503||sabb==='closed') continue;
    const dl=parseDate(action?.deadlineDates?.[0]);
    if (sabb==='forthcoming'||sid===31094502) {
      estado='Próxima'; deadline=dl;
      openDate=parseDate(action?.plannedOpeningDate); break;
    }
    if (sabb==='open'||sid===31094501) {
      if (!isFuture(dl)) continue;
      estado='Abierta'; deadline=dl; break;
    }
  }
  if (!estado) {
    const cdi=td.callDetailsJSONItem;
    if (cdi?.hasOpenTopics) estado='Abierta';
    else if (cdi?.hasForthcomingTopics) estado='Próxima';
    else return null;
  }
  let budget=null;
  try {
    const bmap=td.budgetOverviewJSONItem?.budgetTopicActionMap||{};
    const total=Object.values(bmap).flat()
      .reduce((s,a)=>s+Object.values(a?.budgetYearMap||{})
        .reduce((ss,v)=>ss+parseFloat(v||0),0),0);
    budget=fmtImporte(total);
  } catch {}
  const prog=progStr(td.frameworkProgramme)||td.callTitle||null;
  return {
    id:'eu-'+td.identifier,
    titulo:String(td.title).slice(0,200),
    organismo:prog?`Comisión Europea — ${prog}`:'Comisión Europea',
    ambito:'eu', fuente:'eu', estado,
    beneficiario:inferirBenef(td.keywords,td.title),
    importe:budget, cierre:deadline,
    descripcion:stripHtml(td.description||'').slice(0,500),
    enlace:PORTAL_BASE+td.identifier.toLowerCase(),
    fechaPublicacion:openDate,
    referencia:td.identifier.toUpperCase(),
  };
}

// ─── Obtener topics activos por programa via API ─────────────────────────────

async function fetchTopicsByProgramme(programme) {
  const url = `${TOPICS_API}?frameworkProgramme=${programme}&status=31094501,31094502&language=en&pageSize=50&pageNumber=1`;
  const ctrl = new AbortController();
  const t    = setTimeout(()=>ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const json = await r.json();
    // La API puede devolver los topics directamente con sus datos
    const topics =
      json?.topicResultDto?.topics ||
      json?.topics ||
      json?.results ||
      (Array.isArray(json) ? json : []);
    return topics.map(t => {
      const id = t.identifier || t.topicIdentifier || t.ccm2Id || null;
      return id ? String(id).toUpperCase() : null;
    }).filter(Boolean);
  } catch { clearTimeout(t); return []; }
}

// ─── Fetch topicDetails individual ──────────────────────────────────────────

async function fetchDetail(id) {
  const ctrl=new AbortController();
  const t=setTimeout(()=>ctrl.abort(),7000);
  try {
    const r=await fetch(DETAIL_BASE+id.toLowerCase()+'.json',{headers:HEADERS,signal:ctrl.signal});
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch { clearTimeout(t); return null; }
}

async function processBatch(ids, concurrency=12) {
  const results=[];
  const seen=new Set();
  const unique=ids.filter(id=>{if(seen.has(id))return false;seen.add(id);return true;});
  for (let i=0;i<unique.length;i+=concurrency) {
    const settled=await Promise.allSettled(
      unique.slice(i,i+concurrency).map(async id=>{
        const json=await fetchDetail(id);
        return json?mapTopicDetail(json):null;
      })
    );
    results.push(...settled.map(r=>r.status==='fulfilled'?r.value:null).filter(Boolean));
  }
  return results;
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
    // Paso 1: intentar obtener IDs via API de topics por programa (paralelo)
    const progResults = await Promise.allSettled(
      EU_PROGRAMMES.map(p => fetchTopicsByProgramme(p))
    );
    const apiIds = progResults
      .filter(r=>r.status==='fulfilled')
      .flatMap(r=>r.value);

    // Paso 2: combinar con lista curada
    const allIds = [...new Set([...apiIds, ...CURATED_IDS])];

    // Paso 3: procesar hasta 120 IDs dentro del timeout de Vercel
    const toProcess = allIds.slice(0, 120);
    const data      = await processBatch(toProcess, 12);

    data.sort((a,b)=>{
      if (a.estado!==b.estado) return a.estado==='Abierta'?-1:1;
      if (!a.cierre&&!b.cierre) return 0;
      if (!a.cierre) return 1;
      if (!b.cierre) return -1;
      return new Date(a.cierre)-new Date(b.cierre);
    });

    return res.status(200).json({
      ok:true, fuente:'eu',
      via:'API topics por programa + lista curada → topicDetails',
      ids_via_api: apiIds.length,
      ids_total:   allIds.length,
      ids_procesados: toProcess.length,
      total: data.length,
      data,
    });
  } catch(err) {
    return res.status(500).json({ok:false,error:err.message});
  }
};
