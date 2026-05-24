/**
 * /api/eu.js — diagnóstico fase 3
 * Muestra el contenido real de TopicDetails para un ID conocido activo
 */

const DETAIL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FinanciApp/2.0)',
  'Accept':     'application/json, */*',
  'Referer':    'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

async function fetchDetail(id) {
  const url  = DETAIL_BASE + id.toLowerCase() + '.json';
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { id, error: `HTTP ${r.status}` };
    return { id, json: await r.json() };
  } catch(e) {
    clearTimeout(t);
    return { id, error: e.message };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  // ID confirmado que existe (devolvió TopicDetails)
  const { id, json, error } = await fetchDetail('HORIZON-MSCA-2025-DN-01-01');
  if (error) return res.status(200).json({ error });

  const td = json.TopicDetails;
  return res.status(200).json({
    ok:              true,
    keys_TopicDetails: Object.keys(td || {}),
    // Mostrar los campos más relevantes
    muestra: {
      status:        td?.status,
      title:         td?.title,
      deadlineDate:  td?.deadlineDate,
      startDate:     td?.startDate,
      identifier:    td?.identifier,
      programmeName: td?.programmeName,
      budget:        td?.budget ?? td?.budgetTopicAction ?? td?.budgetOverview,
      description:   typeof td?.description === 'string'
                       ? td.description.slice(0, 200)
                       : td?.description,
    },
  });
};
