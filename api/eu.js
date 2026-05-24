/**
 * /api/eu.js — diagnóstico Search API con text="IDENTIFIER" para DIGITAL
 * Según documentación sección 5: Topic Details service
 * POST https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text="IDENTIFIER"
 */
const SEARCH_URL = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search';
const HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'Accept':       'application/json',
  'User-Agent':   'Mozilla/5.0 (compatible; FinanciApp/2.0)',
};

const TEST_IDS = [
  'DIGITAL-2026-SKILLS-10',
  'DIGITAL-2026-AI-DATA-10',
  'LIFE-2025-SAP-NAT-NATURE',
  'CERV-2025-DAPHNE',
  'ERASMUS-EDU-2025-PI-ALL-INNO',
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  const results = await Promise.all(TEST_IDS.map(async id => {
    // Según documentación: text con el identifier entre comillas
    const url = `${SEARCH_URL}?apiKey=SEDIA&text=%22${encodeURIComponent(id)}%22`;
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: HEADERS,
        body: '', // sin body adicional — el text va en la URL
        signal: ctrl.signal,
      });
      if (!r.ok) return { id, http: r.status };
      const json = await r.json();
      const results_arr = json?.results || [];
      const first = results_arr[0];
      return {
        id,
        http:        200,
        totalResults: json?.totalResults,
        first_type:   first?.metadata?.type?.[0] ?? first?.databaseLabel,
        first_status: first?.metadata?.status?.[0],
        first_title:  first?.metadata?.title?.[0] ?? first?.content ?? first?.title,
        first_deadline: first?.metadata?.deadlineDate?.[0],
        first_identifier: first?.metadata?.identifier?.[0] ?? first?.reference,
      };
    } catch(e) {
      return { id, error: e.message.slice(0,80) };
    }
  }));

  return res.status(200).json({ ok: true, results });
};
