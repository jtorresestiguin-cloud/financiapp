/**
 * /api/eu.js â€” diagnÃ³stico fase 5
 * Ver quÃ© IDs vienen de grant-updates y quÃ© devuelve topicDetails para los primeros 3
 */

const SEARCH_URL  = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***';
const DETAIL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';

const HEADERS_JSON = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept':       'application/json',
  'User-Agent':   'Mozilla/5.0 (compatible; FinanciApp/2.0)',
};
const HEADERS_DETAIL = {
  'User-Agent': 'Mozilla/5.0 (compatible; FinanciApp/2.0)',
  'Accept':     'application/json',
  'Referer':    'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  // Paso 1: obtener grant updates
  const fd = new URLSearchParams();
  fd.append('query',      JSON.stringify({ bool: { must: [{ terms: { type: ['6'] } }] } }));
  fd.append('languages',  '["en"]');
  fd.append('pageNumber', '1');
  fd.append('pageSize',   '10');
  fd.append('sortBy',     'esDA_IngestDate');
  fd.append('orderBy',    'DESC');

  const r    = await fetch(SEARCH_URL, { method: 'POST', headers: HEADERS_JSON, body: fd.toString() });
  const json = await r.json();

  // Mostrar los primeros 3 resultados crudos completos
  const first3 = (json.results || []).slice(0, 3);

  // Para cada uno, tambiÃ©n obtener su topicDetail
  const details = await Promise.all(first3.map(async item => {
    const md  = item.metadata || {};
    const id1 = Array.isArray(md.identifier)    ? md.identifier[0]    : (md.identifier || '');
    const id2 = Array.isArray(md.callIdentifier) ? md.callIdentifier[0] : (md.callIdentifier || '');
    const usedId = id1 || id2;

    let topicDetail = null;
    if (usedId) {
      try {
        const dr = await fetch(DETAIL_BASE + usedId.toLowerCase() + '.json', { headers: HEADERS_DETAIL });
        if (dr.ok) {
          const dj = await dr.json();
          const td = dj?.TopicDetails;
          topicDetail = {
            title:   td?.title,
            actions: (td?.actions || []).map(a => ({
              status_id:   a?.status?.id,
              status_abbr: a?.status?.abbreviation,
              deadlines:   a?.deadlineDates,
              opening:     a?.plannedOpeningDate,
            })),
          };
        } else {
          topicDetail = `HTTP ${dr.status}`;
        }
      } catch(e) {
        topicDetail = `error: ${e.message}`;
      }
    }

    return {
      ref:      item.reference,
      database: item.databaseLabel,
      content:  (item.content || '').slice(0, 100),
      id1, id2,
      metadata_keys: Object.keys(md),
      topicDetail,
    };
  }));

  return res.status(200).json({
    ok:           true,
    total_results: json.totalResults,
    primeros_3:   details,
  });
};
