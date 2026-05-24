/**
 * /api/eu.js
 * Proxy para convocatorias abiertas del EU Funding & Tenders Portal.
 *
 * Usa la API de datos del portal oficial:
 * https://ec.europa.eu/info/funding-tenders/opportunities/data/topics
 *
 * Parámetros clave:
 *   status=31094501  → Open (abierta)
 *   status=31094502  → Forthcoming (próxima apertura)
 *   pageSize=50      → resultados por página
 *
 * Documentación: https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis
 */

const BASE = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/topics';
const TOPIC_URL = 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/';

// Códigos de estado del portal EU
const STATUS_OPEN       = '31094501';
const STATUS_FORTHCOMING = '31094502';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FinanciApp/2.0; +https://financiapp-wvx2.vercel.app)',
  'Accept': 'application/json',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
  'Origin': 'https://ec.europa.eu',
  'Referer': 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
};

function inferirBenef(keywords, description) {
  const t = ((keywords || []).join(' ') + ' ' + (description || '')).toLowerCase();
  if (t.includes('sme') || t.includes('enterprise') || t.includes('startup') || t.includes('business')) return 'Empresa';
  if (t.includes('ngo') || t.includes('civil society') || t.includes('non-profit')) return 'ONG / Tercer sector';
  if (t.includes('research') || t.includes('university') || t.includes('academic')) return 'Universidad / Investigación';
  if (t.includes('public') || t.includes('authority') || t.includes('municipality') || t.includes('local')) return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

function guessEstado(statusCode, deadlineDate) {
  if (statusCode === STATUS_FORTHCOMING) return 'Próxima';
  if (deadlineDate) {
    try {
      const d = new Date(deadlineDate);
      if (!isNaN(d) && d < new Date()) return 'Cerrada';
    } catch {}
  }
  return 'Abierta';
}

function mapTopic(t) {
  if (!t) return null;
  const identifier = (t.identifier || t.topicIdentifier || '').toLowerCase();
  return {
    id:               'eu-' + (t.identifier || t.id || Math.random().toString(36).slice(2)),
    titulo:           (t.title || t.topicTitle || 'Convocatoria EU').slice(0, 200),
    organismo:        t.programmeName || t.callTitle || 'Comisión Europea / Horizon Europe',
    ambito:           'eu',
    fuente:           'eu',
    estado:           guessEstado(t.status, t.deadlineDate || t.deadline),
    beneficiario:     inferirBenef(t.tags || t.keywords, t.title),
    importe:          t.budgetTopicAction
                        ? `€${Number(t.budgetTopicAction).toLocaleString('es-ES')}`
                        : (t.budget ? `€${Number(t.budget).toLocaleString('es-ES')}` : null),
    cierre:           t.deadlineDate || t.deadline || null,
    descripcion:      (t.description || t.topicDescription || t.title || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g,' ').trim().slice(0, 500),
    enlace:           identifier
                        ? `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${identifier}`
                        : 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
    fechaPublicacion: t.publicationDate || t.startDate || null,
    referencia:       t.identifier || t.callIdentifier || null,
  };
}

async function fetchTopics(status, pageSize = 50) {
  const url = `${BASE}?status=${status}&language=es&sortBy=startDate&pageSize=${pageSize}&pageNumber=1`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const r = await fetch(url, { headers: HEADERS, signal: controller.signal });
    clearTimeout(timeout);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const json = await r.json();
    // El portal devuelve { topicResultDto: { topics: [...] } } o similar
    const topics =
      json?.topicResultDto?.topics ||
      json?.topics ||
      json?.result ||
      json?.results ||
      json?.data ||
      (Array.isArray(json) ? json : []);
    return topics.map(mapTopic).filter(Boolean);
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const errors = [];

  // Intentar API oficial del portal con convocatorias abiertas Y próximas
  try {
    const [abiertas, proximas] = await Promise.allSettled([
      fetchTopics(STATUS_OPEN, 50),
      fetchTopics(STATUS_FORTHCOMING, 20),
    ]);

    const data = [
      ...(abiertas.status === 'fulfilled' ? abiertas.value : []),
      ...(proximas.status === 'fulfilled' ? proximas.value : []),
    ];

    if (abiertas.status === 'rejected') errors.push('Open: ' + abiertas.reason?.message);
    if (proximas.status === 'rejected') errors.push('Forthcoming: ' + proximas.reason?.message);

    if (data.length > 0) {
      return res.status(200).json({
        ok: true,
        fuente: 'eu',
        total: data.length,
        errors: errors.length ? errors : undefined,
        data,
      });
    }

    // Si la API oficial no devuelve datos, intentar con el RSS de actualizaciones
    throw new Error('API oficial sin datos. ' + errors.join('; '));

  } catch (apiError) {
    console.warn('EU API oficial falló:', apiError.message, '— intentando RSS de respaldo');

    // Respaldo: RSS de callupdates (el que ya teníamos)
    const RSS_URL = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/referenceData/callupdates-rss.xml';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const r = await fetch(RSS_URL, { headers: { ...HEADERS, Accept: 'application/xml, text/xml' }, signal: controller.signal });
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
        const link     = getTag(raw, 'link') || getTag(raw, 'guid');
        const desc     = (getTag(raw, 'description') || getTag(raw, 'summary') || '').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
        const pubDate  = getTag(raw, 'pubDate') || getTag(raw, 'published');
        const deadline = getNs(raw, 'deadlineDate') || getNs(raw, 'deadline');
        const budget   = getNs(raw, 'budget') || getNs(raw, 'totalBudget');
        const prog     = getNs(raw, 'programme') || getNs(raw, 'frameworkProgramme') || '';
        const callId   = getNs(raw, 'identifier') || getNs(raw, 'callIdentifier') || '';
        if (!title) return null;
        return {
          id: 'eu-rss-' + Buffer.from(callId || link || title).toString('base64').slice(0, 16),
          titulo: title.slice(0, 200),
          organismo: prog ? `Comisión Europea — ${prog}` : 'Comisión Europea',
          ambito: 'eu', fuente: 'eu',
          estado: deadline ? (new Date(deadline) < new Date() ? 'Cerrada' : 'Abierta') : 'Abierta',
          beneficiario: inferirBenef([], title + ' ' + desc),
          importe: budget || null,
          cierre: deadline || null,
          descripcion: desc.slice(0, 500),
          enlace: link || 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
          fechaPublicacion: pubDate,
          referencia: callId || null,
        };
      }).filter(Boolean);

      return res.status(200).json({
        ok: true,
        fuente: 'eu',
        via: 'rss-respaldo',
        total: data.length,
        data,
      });

    } catch (rssError) {
      console.error('EU RSS respaldo también falló:', rssError.message);
      return res.status(500).json({
        ok: false,
        error: `API oficial: ${apiError.message} | RSS: ${rssError.message}`,
      });
    }
  }
};
