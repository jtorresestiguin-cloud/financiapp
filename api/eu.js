/**
 * /api/eu.js — diagnóstico topicDetails
 * Obtiene el JSON raw de 3 IDs conocidos para ver la estructura exacta
 */

const DETAIL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const TOPIC_LIST  = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topic-list.html';

const HEADERS = {
  'User-Agent':  'Mozilla/5.0 (compatible; FinanciApp/2.0)',
  'Accept':      'application/json, */*',
  'Referer':     'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

async function fetchDetail(id) {
  const url  = DETAIL_BASE + id.toLowerCase() + '.json';
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { id, error: `HTTP ${r.status}` };
    const json = await r.json();
    return { id, json };
  } catch(e) {
    clearTimeout(t);
    return { id, error: e.message };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  // IDs activos conocidos — uno reciente de Horizon Europe 2026
  const testIds = [
    'HORIZON-CL5-2026-D3-01',
    'HORIZON-MSCA-2025-DN-01-01',
    'HORIZON-EIC-2026-PATHFINDER-01',
  ];

  // También sacamos los últimos 5 IDs de topic-list para ver qué hay ahí
  let lastIds = [];
  try {
    const r    = await fetch(TOPIC_LIST, { headers: HEADERS });
    const html = await r.text();
    const re   = /topic-details\/([\w-]+)/gi;
    const ids  = [];
    let m;
    while ((m = re.exec(html)) !== null) ids.push(m[1]);
    lastIds = ids.slice(-5); // últimos 5
  } catch(e) {
    lastIds = [`error: ${e.message}`];
  }

  const results = await Promise.all(testIds.map(fetchDetail));

  // Para cada resultado mostrar solo las claves raíz y metadata
  const summary = results.map(({ id, json, error }) => {
    if (error) return { id, error };
    const keys_raiz     = Object.keys(json || {});
    const primer_result = Array.isArray(json?.results) ? json.results[0] : null;
    const keys_metadata = primer_result ? Object.keys(primer_result.metadata || {}) : Object.keys(json?.metadata || {});
    const status_val    = primer_result?.metadata?.status ?? json?.metadata?.status ?? json?.status ?? 'NO ENCONTRADO';
    const title_val     = primer_result?.metadata?.title  ?? json?.metadata?.title  ?? json?.title  ?? 'NO ENCONTRADO';
    const deadline_val  = primer_result?.metadata?.deadlineDate ?? json?.metadata?.deadlineDate ?? 'NO ENCONTRADO';
    return { id, keys_raiz, keys_metadata, status_val, title_val, deadline_val };
  });

  return res.status(200).json({
    ok: true,
    last_ids_in_topic_list: lastIds,
    test_results: summary,
  });
};
