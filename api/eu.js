/**
 * /api/eu.js — diagnóstico endpoints alternativos para programas no-Horizon
 */
const BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FinanciApp/2.0)',
  'Accept':     'application/json, text/html, */*',
  'Referer':    'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

const TEST_ID = 'DIGITAL-2026-SKILLS-10';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  // Probar distintos patrones de URL para programas no-Horizon
  const urls = [
    `${BASE}topicDetails/${TEST_ID.toLowerCase()}.json`,
    `${BASE}callDetails/${TEST_ID.toLowerCase()}.json`,
    `${BASE}topicDetails/${TEST_ID}.json`,
    `${BASE}callDetails/${TEST_ID}.json`,
    `${BASE}topics?identifier=${TEST_ID}&language=en`,
    `${BASE}topics?callIdentifier=DIGITAL-2026&language=en&pageSize=10`,
    `https://ec.europa.eu/info/funding-tenders/opportunities/data/calls?identifier=DIGITAL-2026&language=en`,
    `https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text="${TEST_ID}"`,
  ];

  const results = await Promise.all(urls.map(async url => {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 7000);
    try {
      const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
      const ct = r.headers.get('content-type') || '';
      let preview = '';
      if (r.ok) {
        const txt = await r.text();
        preview = txt.slice(0, 300);
      }
      return { url, http: r.status, ct: ct.slice(0,40), preview };
    } catch(e) {
      return { url, error: e.message.slice(0,60) };
    }
  }));

  return res.status(200).json({ ok: true, test_id: TEST_ID, results });
};
