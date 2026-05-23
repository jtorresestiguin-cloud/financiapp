/**
 * /api/gva.js
 * Proxy para el RSS oficial del DOGV (Diari Oficial de la Generalitat Valenciana):
 *   https://www.dogv.gva.es/datos/rss/rss_dogv.xml
 *
 * GET /api/gva → array de convocatorias normalizadas (solo subvenciones/ayudas)
 */

const DOGV_RSS = 'https://www.dogv.gva.es/datos/rss/rss_dogv.xml';

const KW_RELEVANTES = [
  'subvenci', 'ajuda', 'ajudes', 'convocatòria', 'convocatoria',
  'finançament', 'financiació', 'financiaci', 'beca', 'beques',
  'subvenció', 'programa de suport', 'programa de apoyo',
];

const KW_EXCLUIR = [
  'nomenament', 'resolució de cessament', 'oposici', 'concurs de mèrit',
  'tribunal', 'sentència', 'edicte',
];

function getTag(xml, tag) {
  const re = new RegExp(
    `<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([^<]*)</${tag}>`,
    'i'
  );
  const m = xml.match(re);
  return m ? (m[1] || m[2] || '').trim() : '';
}

function stripHtml(h) {
  return h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#\d]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function extraerOrg(title) {
  const orgs = [
    'Conselleria', "Conselleria d'", 'Diputació', 'Ajuntament', 'IVACE',
    'Generalitat', 'Institut Valencià', 'Agència Valenciana', 'GVA',
  ];
  for (const o of orgs) {
    if (title.includes(o)) return o + ' — Comunitat Valenciana';
  }
  return 'Generalitat Valenciana';
}

function inferirBenef(text) {
  const t = text.toLowerCase();
  if (t.includes('empresa') || t.includes('pime') || t.includes('autònom') || t.includes('autónomo')) return 'Empresa';
  if (t.includes('ong') || t.includes('associaci') || t.includes('entitat sense') || t.includes('fundaci')) return 'ONG / Tercer sector';
  if (t.includes('universit') || t.includes('investigaci')) return 'Universidad / Investigación';
  if (t.includes('ajuntament') || t.includes('municipal') || t.includes('local') || t.includes('entitat local')) return 'Entidad local';
  return 'Entidad pública';
}

function extraerImporte(text) {
  const m = text.match(/[\d.,]+\s*(milions?|millones?|M€| M |milers?|miles?|€|euros?)/i);
  return m ? m[0].trim() : null;
}

function extraerFecha(text) {
  const m = text.match(/\b(\d{1,2})[\/\-.](0?[1-9]|1[0-2])[\/\-.](\d{2,4})\b/);
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function guessEstado(title, desc, pubDate) {
  const combined = (title + ' ' + desc).toLowerCase();
  if (combined.includes('resoluci') && (combined.includes('concedi') || combined.includes('denegaci'))) return 'Cerrada';
  if (combined.includes('pròxima') || combined.includes('próxima') || combined.includes('prevista')) return 'Próxima';
  if (pubDate) {
    try {
      const d = new Date(pubDate);
      if (!isNaN(d) && Date.now() - d.getTime() > 180 * 86400000) return 'Cerrada';
    } catch {}
  }
  return 'Abierta';
}

function mapItem(rawItem) {
  const title   = getTag(rawItem, 'title');
  const link    = getTag(rawItem, 'link') || getTag(rawItem, 'guid');
  const desc    = stripHtml(getTag(rawItem, 'description') || '');
  const pubDate = getTag(rawItem, 'pubDate');

  if (!title) return null;

  const tl = title.toLowerCase();
  const dl = desc.toLowerCase();

  const esRelevante = KW_RELEVANTES.some(k => tl.includes(k) || dl.includes(k));
  const excluir     = KW_EXCLUIR.some(k => tl.includes(k));

  if (!esRelevante || excluir) return null;

  return {
    id:               'gva-' + Buffer.from(link || title).toString('base64').slice(0, 16),
    titulo:           title.slice(0, 200),
    organismo:        extraerOrg(title),
    ambito:           'loc',
    fuente:           'gva',
    estado:           guessEstado(title, desc, pubDate),
    beneficiario:     inferirBenef(title + ' ' + desc),
    importe:          extraerImporte(title + ' ' + desc),
    cierre:           extraerFecha(title + ' ' + desc),
    descripcion:      desc.slice(0, 500),
    enlace:           link || 'https://www.dogv.gva.es',
    fechaPublicacion: pubDate,
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
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');

  try {
    const r = await fetch(DOGV_RSS, {
      headers: {
        'User-Agent': 'FinanciApp/2.0 (https://financiapp.es)',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });

    if (!r.ok) throw new Error(`DOGV RSS HTTP ${r.status}`);
    const xml = await r.text();

    const rawItems = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
    if (!rawItems.length) throw new Error('DOGV RSS sin items');

    const data = rawItems.map(mapItem).filter(Boolean);
    return res.status(200).json({ ok: true, fuente: 'gva', total: data.length, data });

  } catch (err) {
    console.error('GVA handler error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
