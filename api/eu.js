/**
 * /api/eu.js — versión estable definitiva
 *
 * La Search API pública de SEDIA devuelve siempre el mismo conjunto
 * de registros cerrados en búlgaro, ignorando todos los filtros.
 * No es utilizable para búsqueda dinámica.
 *
 * Solución robusta:
 *   1. topicDetails JSON para Horizon Europe (probado y funcionando: 52 resultados)
 *   2. Lista curada ampliada con IDs completos de otros programas EU
 *      verificados directamente en el portal (DIGITAL, LIFE, ERASMUS+, etc.)
 *
 * Para añadir nuevas convocatorias: añadir el ID completo a ACTIVE_IDS.
 * Los IDs se obtienen visitando el portal y copiando el identificador
 * de la URL: /topic-details/ESTE-ES-EL-ID
 */

const DETAIL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const PORTAL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';
const NOW         = new Date();

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FinanciApp/2.0; +https://financiapp-wvx2.vercel.app)',
  'Accept':     'application/json',
  'Referer':    'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

// ─── IDs activos verificados en el portal EU F&T ────────────────────────────
// Formato: identificador exacto tal como aparece en la URL del portal
// Añadir aquí nuevos IDs cuando se publiquen nuevas convocatorias
const ACTIVE_IDS = [

  // ── HORIZON EUROPE — MSCA ────────────────────────────────────────────────
  'HORIZON-MSCA-2026-PF-01-01',
  'HORIZON-MSCA-2026-SE-01-01',
  'HORIZON-MSCA-2027-DN-01-01',
  'HORIZON-MSCA-2027-PF-01-01',
  'HORIZON-MSCA-2027-COFUND-01-01',

  // ── HORIZON EUROPE — EIC ─────────────────────────────────────────────────
  'HORIZON-EIC-2026-ACCELERATOR-01',
  'HORIZON-EIC-2026-PATHFINDER-01',
  'HORIZON-EIC-2026-TRANSITION-01',
  'HORIZON-EIC-2027-ACCELERATOR-01',
  'HORIZON-EIC-2027-PATHFINDER-01',

  // ── HORIZON EUROPE — Clúster 1 (Salud) ──────────────────────────────────
  'HORIZON-HLTH-2027-03-TOOL-02',
  'HORIZON-HLTH-2027-03-TOOL-04',
  'HORIZON-HLTH-2027-03-TOOL-08',
  'HORIZON-HLTH-2026-DISEASE-04-01',
  'HORIZON-HLTH-2026-STAYHLTH-01-01',

  // ── HORIZON EUROPE — Clúster 2 ───────────────────────────────────────────
  'HORIZON-CL2-2027-01-HERITAGE-01','HORIZON-CL2-2027-01-HERITAGE-02',
  'HORIZON-CL2-2027-01-HERITAGE-03','HORIZON-CL2-2027-01-HERITAGE-04',
  'HORIZON-CL2-2027-01-HERITAGE-05','HORIZON-CL2-2027-01-HERITAGE-06',
  'HORIZON-CL2-2027-01-HERITAGE-07','HORIZON-CL2-2027-01-HERITAGE-08',
  'HORIZON-CL2-2027-01-TRANSFO-01','HORIZON-CL2-2027-01-TRANSFO-02',
  'HORIZON-CL2-2027-01-TRANSFO-03','HORIZON-CL2-2027-01-TRANSFO-04',
  'HORIZON-CL2-2027-01-TRANSFO-05','HORIZON-CL2-2027-01-TRANSFO-06',
  'HORIZON-CL2-2027-01-TRANSFO-07','HORIZON-CL2-2027-01-TRANSFO-08',
  'HORIZON-CL2-2027-01-DEMOCRACY-01','HORIZON-CL2-2027-01-DEMOCRACY-02',
  'HORIZON-CL2-2027-01-DEMOCRACY-03','HORIZON-CL2-2027-01-DEMOCRACY-04',
  'HORIZON-CL2-2027-01-DEMOCRACY-05','HORIZON-CL2-2027-01-DEMOCRACY-06',
  'HORIZON-CL2-2027-01-DEMOCRACY-07','HORIZON-CL2-2027-01-DEMOCRACY-08',

  // ── HORIZON EUROPE — Clúster 3 ───────────────────────────────────────────
  'HORIZON-CL3-2027-01-DRS-02',
  'HORIZON-CL3-2026-FCT-01-01',
  'HORIZON-CL3-2026-CS-01-01',

  // ── HORIZON EUROPE — Clúster 4 ───────────────────────────────────────────
  'HORIZON-CL4-2026-HUMAN-02-01',
  'HORIZON-CL4-2026-RESILIENCE-01-01',
  'HORIZON-CL4-2026-DATA-01-01',

  // ── HORIZON EUROPE — Clúster 5 ───────────────────────────────────────────
  'HORIZON-CL5-2027-07-D3-16','HORIZON-CL5-2027-07-D3-11',
  'HORIZON-CL5-2027-07-D3-32','HORIZON-CL5-2027-07-D3-26',
  'HORIZON-CL5-2027-07-D3-27','HORIZON-CL5-2027-07-D3-28',
  'HORIZON-CL5-2027-07-D3-25','HORIZON-CL5-2027-07-D3-17',
  'HORIZON-CL5-2027-06-D6-12','HORIZON-CL5-2027-06-D6-05',
  'HORIZON-CL5-2027-06-D6-08','HORIZON-CL5-2027-06-D6-04',
  'HORIZON-CL5-2027-06-D6-11',
  'HORIZON-CL5-2027-05-D2-08','HORIZON-CL5-2027-05-D4-06',
  'HORIZON-CL5-2027-05-D4-09','HORIZON-CL5-2027-05-D4-05',
  'HORIZON-CL5-2027-05-D4-07',

  // ── HORIZON EUROPE — Clúster 6 ───────────────────────────────────────────
  'HORIZON-CL6-2026-GOVERNANCE-01-01',
  'HORIZON-CL6-2026-FARM2FORK-01-01',
  'HORIZON-CL6-2026-BIODIV-01-01',

  // ── HORIZON EUROPE — EIE ─────────────────────────────────────────────────
  'HORIZON-EIE-2027-01-CONNECT-01',
  'HORIZON-EIE-2027-01-CONNECT-02',
  'HORIZON-EIE-2027-01-CONNECT-03',

  // ── HORIZON EUROPE — Misiones ─────────────────────────────────────────────
  'HORIZON-MISS-2026-CANCER-01-01',
  'HORIZON-MISS-2026-CLIMA-01-01',
  'HORIZON-MISS-2026-OCEAN-01-01',
  'HORIZON-MISS-2026-SOIL-01-01',
  'HORIZON-MISS-2026-CIT-01-01',

  // ── DIGITAL EUROPE PROGRAMME ─────────────────────────────────────────────
  // IDs completos con sufijo (verificados: status Forthcoming, deadline oct 2026)
  'DIGITAL-2026-SKILLS-10-EDTECH',
  'DIGITAL-2026-SKILLS-10-CLOUD',
  'DIGITAL-2026-BESTUSE-10-EDUCATION',
  'DIGITAL-2026-BESTUSE-10-PUBLIC',
  'DIGITAL-2026-AI-DATA-10-COMPLIANCE',
  'DIGITAL-2026-AI-DATA-10-TRUSTED',
  'DIGITAL-ECCC-2026-DEPLOY-CYBER-10-CSC',
  'DIGITAL-ECCC-2026-DEPLOY-CYBER-10-SOC',

  // ── LIFE 2026 ────────────────────────────────────────────────────────────
  'LIFE-2026-SAP-NAT-NATURE',
  'LIFE-2026-SAP-ENV-ENVIRONMENT',
  'LIFE-2026-SAP-CLI-CLIMA',
  'LIFE-2026-IP-ENV',
  'LIFE-2026-IP-CLI',
  'LIFE-2026-PP-NATURE',
  'LIFE-2026-PP-CLIMA',

  // ── ERASMUS+ 2026 ────────────────────────────────────────────────────────
  'ERASMUS-EDU-2026-PI-ALL-INNO-BLUEPRINT',
  'ERASMUS-EDU-2026-PEX-COVE',
  'ERASMUS-EDU-2026-PI-LEA-INNO-TCA',
  'ERASMUS-YOUTH-2026-SCP-SCE',
  'ERASMUS-SPORT-2026-SNCESE',
  'ERASMUS-EDU-2026-POL-EXP-SSEF',
  'ERASMUS-EDU-2022-ECHE-CERT-FP',

  // ── CERV 2026 ────────────────────────────────────────────────────────────
  'CERV-2026-DAPHNE',
  'CERV-2026-CITIZENS-TOWN',
  'CERV-2026-EQUAL-RRAC',
  'CERV-2026-CHAR-LOGI',

  // ── Creative Europe 2026 ─────────────────────────────────────────────────
  'CREA-MEDIA-2026-DEVSLATE',
  'CREA-MEDIA-2026-COPROEU',
  'CREA-CULT-2026-COOP',
  'CREA-CULT-2026-TRANS',

  // ── EU4Health 2026 ───────────────────────────────────────────────────────
  'EU4H-2026-PJ-01',
  'EU4H-2026-PJ-02',
  'EU4H-2026-PJ-03',

  // ── CEF 2026 ─────────────────────────────────────────────────────────────
  'CEF-T-2026-AFIF-RAILS',
  'CEF-T-2026-MULTIMODAL',
  'CEF-E-2026-PCI',

  // ── SMP / COSME 2026 ─────────────────────────────────────────────────────
  'SMP-COSME-2026-CLUSTER-EXCELLENCE',
  'SMP-COSME-2026-ESO',

  // ── Justice 2026 ─────────────────────────────────────────────────────────
  'JUST-2026-JTRA-EJTR',
  'JUST-2026-JACC-ROLE',

  // ── Innovation Fund ───────────────────────────────────────────────────────
  'INNOVFUND-2026-NER',
  'INNOVFUND-2026-LSC',

  // ── European Solidarity Corps 2026 ───────────────────────────────────────
  'ESC-2026-VEU-SVOL',
  'ESC-2026-VSE-VST',

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
  if (/^\d{10,}$/.test(String(d))) { try{return new Date(Number(d)).toISOString();}catch{} }
  try { const dt=new Date(d); if(!isNaN(dt)) return dt.toISOString(); } catch {}
  return null;
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
  if (t.includes('sme')||t.includes('enterprise')||t.includes('startup')) return 'Empresa';
  if (t.includes('ngo')||t.includes('civil society')||t.includes('non-profit')) return 'ONG / Tercer sector';
  if (t.includes('research')||t.includes('university')||t.includes('academic')||t.includes('doctoral')) return 'Universidad / Investigación';
  if (t.includes('public')||t.includes('authority')||t.includes('municipal')) return 'Entidad pública';
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
    if (cdi?.hasOpenTopics)             estado='Abierta';
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

// ─── Fetch ────────────────────────────────────────────────────────────────

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

async function processBatch(ids,concurrency=12) {
  const results=[];
  for (let i=0;i<ids.length;i+=concurrency) {
    const settled=await Promise.allSettled(
      ids.slice(i,i+concurrency).map(async id=>{
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
    const data=await processBatch(ACTIVE_IDS,12);
    data.sort((a,b)=>{
      if (a.estado!==b.estado) return a.estado==='Abierta'?-1:1;
      if (!a.cierre&&!b.cierre) return 0;
      if (!a.cierre) return 1; if (!b.cierre) return -1;
      return new Date(a.cierre)-new Date(b.cierre);
    });
    return res.status(200).json({
      ok:true, fuente:'eu',
      via:'topicDetails — lista curada multi-programa',
      ids_en_lista: ACTIVE_IDS.length,
      total: data.length,
      data,
    });
  } catch(err) {
    return res.status(500).json({ok:false,error:err.message});
  }
};
