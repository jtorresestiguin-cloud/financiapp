/**
 * /api/eu.js
 * Proxy para el RSS oficial de convocatorias de la Comisión Europea:
 *   https://ec.europa.eu/info/funding-tenders/opportunities/data/referenceData/callupdates-rss.xml
 *
 * GET /api/eu → array de convocatorias normalizadas
 */

const EU_RSS = 'https://ec.europa.eu/info/funding-tenders/opportunities/data/referenceData/callupdates-rss.xml';

// Extrae texto de una etiqueta XML (con o sin CDATA)
function getTag(xml, tag) {
  const re = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([^<]*)</${tag}>`,
    'i'
  );
  const m = xml.match(re);
  return m ? (m[1] || m[2] || '').trim() : '';
}

// El RSS europeo usa namespaces como <ns2:deadlineDate>, <ns2:budget>, etc.
// Extraemos tanto con ns como sin ns.
function getNsTag(xml, tag) {
  const re = new RegExp(`<(?:[\\w]+:)?${tag}[^>]*>([^<]*)<\/(?:[\\w]+:)?${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function stripHtml(h) {
  return h.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function inferirBenef(text) {
  const t = text.toLowerCase();
  if (t.includes('sme') || t.includes('enterprise') || t.includes('empresa') || t.includes('business')) return 'Empresa';
  if (t.includes('ngo') || t.includes('ong') || t.includes('civil society')) return 'ONG / Tercer sector';
  if (t.includes('research') || t.includes('university') || t.includes('universit') || t.includes('investigaci')) return 'Universidad / Investigación';
  if (t.includes('public') || t.includes('authority') || t.includes('municipality')) return 'Entidad pública';
  return 'Empresa / Universidad / Entidad pública';
}

function guessEstado(deadlineStr) {
  if (!deadlineStr) return 'Abierta';
  try {
    const d = new Date(deadlineStr);
    if (!isNaN(d)) return d < new Date() ? 'Cerrada' : 'Abierta';
  } catch {}
  return 'Abierta';
}

function mapItem(rawItem) {
  const title    = getTag(rawItem, 'title');
  const link     = getTag(rawItem, 'link') || getTag(rawItem, 'guid');
  const desc     = stripHtml(getTag(rawItem, 'description') || getTag(rawItem, 'summary') || '');
  const pubDate  = getTag(rawItem, 'pubDate') || getTag(rawItem, 'published');

  // Campos específicos del RSS europeo (con y sin namespace)
  const deadline = getNsTag(rawItem, 'deadlineDate') || getNsTag(rawItem, 'deadline');
  const budget   = getNsTag(rawItem, 'budget') || getNsTag(rawItem, 'totalBudget');
  const prog     = getNsTag(rawItem, 'programme') || getNsTag(rawItem, 'frameworkProgramme') || '';
  const callId   = getNsTag(rawItem, 'identifier') || getNsTag(rawItem, 'callIdentifier') || '';

  if (!title) return null;

  return {
    id:               'eu-' + Buffer.from(callId || link || title).toString('base64').slice(0, 16),
    titulo:           title.slice(0, 200),
    organismo:        prog ? `Comisión Europea — ${prog}` : 'Comisión Europea / Horizon Europe',
    ambito:           'eu',
    fuente:           'eu',
    estado:           guessEstado(deadline),
    beneficiario:     inferirBenef(title + ' ' + desc),
    importe:          budget || null,
    cierre:           deadline || null,
    descripcion:      desc.slice(0, 500),
    enlace:           link || 'https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals',
    fechaPublicacion: pubDate,
    referencia:       callId || null,
  };
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

  try {
    const r = await fetch(EU_RSS, {
      headers: {
        'User-Agent': 'FinanciApp/2.0 (https://financiapp.es)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });

    if (!r.ok) throw new Error(`EU RSS HTTP ${r.status}`);
    const xml = await r.text();

    // El RSS europeo usa <item> o <entry>
    const rawItems = [
      ...[...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]),
      ...[...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(m => m[1]),
    ];

    if (!rawItems.length) throw new Error('RSS europeo sin elementos');

    const data = rawItems.map(mapItem).filter(Boolean);
    return res.status(200).json({ ok: true, fuente: 'eu', total: data.length, data });

  } catch (err) {
    console.error('EU handler error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
