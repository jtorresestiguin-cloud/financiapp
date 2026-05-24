/**
 * /api/eu.js â€” diagnÃ³stico RSS
 * Ver quÃ© IDs extrae el RSS y probar uno contra topicDetails
 */

const RSS_URL     = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/referenceData/callupdates-rss.xml';
const DETAIL_BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topicDetails/';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FinanciApp/2.0)',
  'Accept':     'application/xml, text/xml, */*',
  'Referer':    'https://ec.europa.eu/info/funding-tenders/opportunities/portal/',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  try {
    // Obtener el RSS
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 10000);
    const r   = await fetch(RSS_URL, { headers: HEADERS, signal: ctrl.signal });
    const xml = await r.text();

    // Mostrar los primeros 2000 caracteres del XML para ver la estructura real
    const xmlSample = xml.slice(0, 3000);

    // Extraer los primeros 10 <item> completos
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 3)
      .map(m => m[1].trim());

    // Para el primer item, intentar obtener su topicDetail
    let topicTest = null;
    if (items[0]) {
      // Extraer todos los posibles identificadores del item
      const patterns = [
        ...([...items[0].matchAll(/<(?:[\w:]*identifier)[^>]*>([^<]+)<\/(?:[\w:]*identifier)>/gi)].map(m => m[1].trim())),
        ...([...items[0].matchAll(/HORIZON-[\w-]+/g)].map(m => m[0])),
        ...([...items[0].matchAll(/topic-details\/([\w-]+)/gi)].map(m => m[1])),
      ];
      const uniqueIds = [...new Set(patterns)].filter(id => id.length > 5);

      for (const id of uniqueIds.slice(0, 3)) {
        try {
          const dr = await fetch(DETAIL_BASE + id.toLowerCase() + '.json', { headers: HEADERS });
          const status = dr.status;
          let topicStatus = null;
          if (dr.ok) {
            const dj = await dr.json();
            topicStatus = dj?.TopicDetails?.actions?.[0]?.status?.abbreviation ?? 'no actions';
          }
          topicTest = { id, httpStatus: status, topicStatus };
          break;
        } catch(e) {
          topicTest = { id, error: e.message };
        }
      }
    }

    return res.status(200).json({
      ok: true,
      xml_length: xml.length,
      xml_sample: xmlSample,
      first_3_items: items,
      topic_test: topicTest,
    });

  } catch(err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
