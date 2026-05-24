/**
 * /api/eu.js
 * Proxy para convocatorias del EU Funding & Tenders Portal.
 *
 * Usa la Search API oficial documentada en:
 * https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis
 *
 * Endpoint: POST https://api.tech.ec.europa.eu/search-api/prod/rest/search
 * Body: query Elasticsearch con filtros de tipo, estado y periodo.
 *
 * Tipos:
 *   0 = Tenders (licitaciones)
 *   1 = Calls for proposals (convocatorias de subvención)
 *   2 = Prizes
 *   8 = Innovation Procurement
 *
 * Estados:
 *   31094501 = Open
 *   31094502 = Forthcoming
 *   31094503 = Closed
 */

const SEARCH_API = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';

// Query: solo grants/proposals abiertos y próximos, periodo 2021-2027
const QUERY_BODY = {
  bool: {
    must: [
      {
        terms: {
          type: ['1', '2', '8'], // grants, prizes, innovation procurement (excluye licitaciones puras)
        },
      },
      {
        terms: {
          status: ['31094501', '31094502'], // open + forthcoming
        },
      },
      {
        term: {
          programmePeriod: '2021 - 2027',
        },
      },
    ],
  },
};

const REQUEST_BODY = {
  query:       JSON.stringify(QUERY_BODY),
  languages:   ['es', 'en'],
  sort:        'startDate',
  order:       'DESC',
  pageSize:    '50',
  pageNumber:  '1',
};

const HEADERS = {
  'Content-Type':  'application/json',
  'Accept':        'application/json',
  'User-Agent':    'Mozilla/5.0 (compatible; FinanciApp/2.0; +https://financiapp-wvx2.vercel.app)',
  'Origin':        'https://ec.europa.eu',
  'Referer':       'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripHtml(s) {
  return (s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#\d]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function inferirBenef(tags, title) {
  const t = ([...(tags || []), title || '']).join(' ').toLowerCase();
  if (t.includes('sme') || t.includes('enterprise') || t.includes('startup') || t.includes('business')) return 'Empresa';
  if (t.includes('ngo') || t.includes('civil society') || t.includes('non-profit') || t.includes('association')) return 'ONG / Tercer sector';
  if (t.includes('research') || t.includes('university') || t.includes('academic') || t.includes('higher education')) return 'Universidad / Investigación';
  if (t.includes('public') || t.includes('authority') || t.includes('municipality')) return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

function guessEstado(statusCode, deadline) {
  if (statusCode === '31094502') return 'Próxima';
  if (statusCode === '31094503') return 'Cerrada';
  if (deadline) {
    try {
      if (new Date(deadline) < new Date()) return 'Cerrada';
    } catch {}
  }
  return 'Abierta';
}

function fmtImporte(val) {
  if (!val) return null;
  const n = parseFloat(String(val).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return null;
  if (n >= 1_000_000) return `€${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `€${Math.round(n / 1_000)}K`;
  return `€${Math.round(n).toLocaleString('es-ES')}`;
}

function mapResult(item) {
  if (!item) return null;

  // La API devuelve los campos en metadata o directamente en el objeto
  const md       = item.metadata || item;
  const title    = md.title    || md.topicTitle    || item.title    || '';
  const id       = md.identifier || md.topicIdentifier || item.identifier || item.id || '';
  const prog     = md.programmeName || md.frameworkProgramme || md.callTitle || '';
  const deadline = md.deadlineDate  || md.deadline  || md.submissionDeadline || null;
  const budget   = md.budgetOverview || md.budget   || md.totalBudget || null;
  const status   = String(md.status || item.status || '31094501');
  const desc     = stripHtml(md.description || md.topicDescription || md.objective || title);
  const tags     = md.tags || md.keywords || md.crossCuttingPriorities || [];
  const pubDate  = md.publicationDate || md.startDate || md.openingDate || null;
  const linkId   = (id || title).toLowerCase().replace(/\s+/g, '-');

  if (!title) return null;

  return {
    id:               'eu-' + Buffer.from(id || title).toString('base64').slice(0, 20),
    titulo:           title.slice(0, 200),
    organismo:        prog ? `Comisión Europea — ${prog}` : 'Comisión Europea / Horizon Europe',
    ambito:           'eu',
    fuente:           'eu',
    estado:           guessEstado(status, deadline),
    beneficiario:     inferirBenef(tags, title),
    importe:          fmtImporte(budget),
    cierre:           deadline,
    descripcion:      desc.slice(0, 500),
    enlace:           id
                        ? `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${id.toLowerCase()}`
                        : 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
    fechaPublicacion: pubDate,
    referencia:       id || null,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  // ── Intento 1: Search API oficial ─────────────────────────────────────────
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const r = await fetch(SEARCH_API, {
      method:  'POST',
      headers: HEADERS,
      body:    JSON.stringify(REQUEST_BODY),
      signal:  controller.signal,
    });
    clearTimeout(timeout);

    if (!r.ok) throw new Error(`Search API HTTP ${r.status}`);

    const json = await r.json();

    // La respuesta puede venir en distintas estructuras según la versión de la API
    const hits =
      json?.hits?.hits ||         // estructura Elasticsearch directa
      json?.results ||            // estructura portal simplificada
      json?.data?.results ||
      json?.response?.results ||
      (Array.isArray(json) ? json : []);

    if (!hits.length) throw new Error('Search API sin resultados');

    const data = hits
      .map(h => mapResult(h._source || h.fields || h))
      .filter(Boolean);

    if (!data.length) throw new Error('Sin resultados mapeables');

    return res.status(200).json({
      ok:    true,
      fuente: 'eu',
      via:   'search-api',
      total: data.length,
      data,
    });

  } catch (apiErr) {
    console.warn('EU Search API error:', apiErr.message, '— intentando API de tópicos');
  }

  // ── Intento 2: API de tópicos (endpoint REST clásico) ─────────────────────
  try {
    const statusParams = '31094501,31094502';
    const url = `https://ec.europa.eu/info/funding-tenders/opportunities/data/topics?status=${statusParams}&language=es&sortBy=startDate&order=DESC&pageSize=50&pageNumber=1`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const r = await fetch(url, {
      headers: { ...HEADERS, 'Content-Type': undefined },
      signal:  controller.signal,
    });
    clearTimeout(timeout);

    if (!r.ok) throw new Error(`Topics API HTTP ${r.status}`);

    const json = await r.json();
    const topics =
      json?.topicResultDto?.topics ||
      json?.topics ||
      json?.results ||
      (Array.isArray(json) ? json : []);

    if (!topics.length) throw new Error('Topics API sin resultados');

    const data = topics.map(mapResult).filter(Boolean);

    return res.status(200).json({
      ok:    true,
      fuente: 'eu',
      via:   'topics-api',
      total: data.length,
      data,
    });

  } catch (topicsErr) {
    console.warn('EU Topics API error:', topicsErr.message, '— intentando RSS');
  }

  // ── Intento 3: RSS de callupdates ─────────────────────────────────────────
  try {
    const RSS = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/referenceData/callupdates-rss.xml';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const r = await fetch(RSS, {
      headers: { ...HEADERS, Accept: 'application/xml, text/xml' },
      signal:  controller.signal,
    });
    clearTimeout(timeout);

    if (!r.ok) throw new Error(`RSS HTTP ${r.status}`);
    const xml = await r.text();

    function getTag(raw, tag) {
      const re = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\/${tag}>|<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i');
      const m = raw.match(re);
      return m ? (m[1] || m[2] || '').trim() : '';
    }
    function getNs(raw, tag) {
      const re = new RegExp(`<(?:[\\w]+:)?${tag}[^>]*>([^<]*)<\/(?:[\\w]+:)?${tag}>`, 'i');
      const m = raw.match(re);
      return m ? m[1].trim() : '';
    }

    const rawItems = [
      ...[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]),
      ...[...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(m => m[1]),
    ];

    if (!rawItems.length) throw new Error('RSS sin elementos');

    const data = rawItems.map((raw, i) => {
      const title    = getTag(raw, 'title');
      if (!title) return null;
      const link     = getTag(raw, 'link') || getTag(raw, 'guid');
      const desc     = stripHtml(getTag(raw, 'description') || getTag(raw, 'summary') || '');
      const pubDate  = getTag(raw, 'pubDate') || getTag(raw, 'published');
      const deadline = getNs(raw, 'deadlineDate') || getNs(raw, 'deadline');
      const budget   = getNs(raw, 'budget') || getNs(raw, 'totalBudget');
      const prog     = getNs(raw, 'programme') || getNs(raw, 'frameworkProgramme') || '';
      const callId   = getNs(raw, 'identifier') || getNs(raw, 'callIdentifier') || '';
      return {
        id:               'eu-rss-' + Buffer.from(callId || link || title).toString('base64').slice(0, 16),
        titulo:           title.slice(0, 200),
        organismo:        prog ? `Comisión Europea — ${prog}` : 'Comisión Europea',
        ambito:           'eu', fuente: 'eu',
        estado:           deadline ? (new Date(deadline) < new Date() ? 'Cerrada' : 'Abierta') : 'Abierta',
        beneficiario:     inferirBenef([], title + ' ' + desc),
        importe:          fmtImporte(budget),
        cierre:           deadline || null,
        descripcion:      desc.slice(0, 500),
        enlace:           link || 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
        fechaPublicacion: pubDate,
        referencia:       callId || null,
      };
    }).filter(Boolean);

    return res.status(200).json({ ok: true, fuente: 'eu', via: 'rss', total: data.length, data });

  } catch (rssErr) {
    console.error('EU todos los intentos fallaron:', rssErr.message);
    return res.status(500).json({ ok: false, error: rssErr.message });
  }
};
