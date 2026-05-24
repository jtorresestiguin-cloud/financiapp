/**
 * /api/eu.js â€” diagnÃ³stico DIGITAL IDs
 */
const DETAIL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FinanciApp/2.0)',
  'Accept':     'application/json',
  'Referer':    'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

const TEST_IDS = [
  'DIGITAL-2026-SKILLS-10',
  'DIGITAL-2026-BESTUSE-10',
  'DIGITAL-ECCC-2026-DEPLOY-CYBER-10',
  'DIGITAL-2026-AI-DATA-10',
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const results = await Promise.all(TEST_IDS.map(async id => {
    const url  = DETAIL_BASE + id.toLowerCase() + '.json';
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    try {
      const r    = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      if (!r.ok) return { id, http: r.status };
      const json = await r.json();
      const td   = json?.TopicDetails;
      return {
        id,
        http:       200,
        keys:       Object.keys(json),
        has_TopicDetails: !!td,
        title:      td?.title,
        status:     td?.actions?.[0]?.status,
        deadline:   td?.actions?.[0]?.deadlineDates?.[0],
      };
    } catch(e) {
      return { id, error: e.message };
    }
  }));

  return res.status(200).json({ ok: true, results });
};
