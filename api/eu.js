/**
 * /api/eu.js — diagnóstico fase 4
 * Inspeccionar callDetailsJSONItem y budgetOverviewJSONItem
 */

const DETAIL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FinanciApp/2.0)',
  'Accept':     'application/json, */*',
  'Referer':    'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const url  = DETAIL_BASE + 'horizon-msca-2025-dn-01-01.json';
  const r    = await fetch(url, { headers: HEADERS });
  const json = await r.json();
  const td   = json.TopicDetails;

  // Mostrar los dos campos clave completos
  return res.status(200).json({
    ok: true,
    callDetailsJSONItem:    td?.callDetailsJSONItem,
    budgetOverviewJSONItem: td?.budgetOverviewJSONItem,
    // También otros campos que podrían tener estado
    sme:       td?.sme,
    actions:   td?.actions,
    latestInfos: td?.latestInfos,
  });
};
