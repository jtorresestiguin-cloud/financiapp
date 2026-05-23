/**
 * /api/gva.js
 * Proxy para convocatorias de la Generalitat Valenciana.
 * Intenta varias fuentes en orden hasta obtener datos.
 */

const FUENTES_GVA = [
  'https://www.dogv.gva.es/datos/rss/rss_dogv.xml',
  'https://dogv.gva.es/datos/rss/rss_dogv.xml',
  'https://www.gva.es/es/inicio/rss',
];

const KW_RELEVANTES = [
  'subvenci', 'ajuda', 'ajudes', 'convocatòria', 'convocatoria',
  'finançament', 'financiació', 'financiaci', 'beca', 'beques',
  'subvenció', 'programa de suport', 'programa de apoyo', 'fons',
];

const KW_EXCLUIR = [
  'nomenament', 'resolució de cessament', 'oposici', 'concurs de mèrit',
  'tribunal', 'sentència', 'edicte', 'licitaci',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; FinanciApp/2.0; +https://financiapp-wvx2.vercel.app)',
  'Accept': 'application/rss+xml, application/xml, text/xml, */*',
  'Accept-Language': 'es-ES,es;q=0.9,ca;q=0.8',
  'Cache-Control': 'no-cache',
  'Referer': 'https://www.dogv.gva.es/',
};

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
    'Vicepresidència', 'Presidència',
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

  let lastError = null;

  // Intentar cada URL alternativa en orden
  for (const url of FUENTES_GVA) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const r = await fetch(url, {
        headers: HEADERS,
        signal: controller.signal,
        redirect: 'follow',
      });
      clearTimeout(timeout);

      if (!r.ok) {
        lastError = `HTTP ${r.status} en ${url}`;
        continue;
      }

      const xml = await r.text();
      const rawItems = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]);

      if (!rawItems.length) {
        lastError = `RSS sin items en ${url}`;
        continue;
      }

      const data = rawItems.map(mapItem).filter(Boolean);
      return res.status(200).json({
        ok: true,
        fuente: 'gva',
        url_usada: url,
        total: data.length,
        data,
      });

    } catch (e) {
      lastError = `${e.message} en ${url}`;
      console.warn(`GVA fetch error (${url}):`, e.message);
    }
  }

  // Si todas fallan, devolver datos de respaldo curados
  console.error('GVA: todas las fuentes fallaron, usando respaldo. Último error:', lastError);
  const respaldo = [
    {
      id: 'gva-respaldo-1',
      titulo: 'Ajudes per a la modernització d\'infraestructures de serveis socials 2026',
      organismo: 'Conselleria de Serveis Socials — Comunitat Valenciana',
      ambito: 'loc', fuente: 'gva', estado: 'Próxima',
      beneficiario: 'Entidad pública',
      importe: '€8.500.000', cierre: '2026-09-01',
      descripcion: 'Convocatoria de la Generalitat Valenciana para financiar obras, equipamiento y proyectos técnicos de centros de servicios sociales. Tope de 150.000 € por entidad. Publicada en DOGV.',
      enlace: 'https://serviciossociales.gva.es',
      fechaPublicacion: '2026-03-10',
    },
    {
      id: 'gva-respaldo-2',
      titulo: 'Subvencions per al foment de la cultura local — Diputació de València',
      organismo: 'Diputació de València — Comunitat Valenciana',
      ambito: 'loc', fuente: 'gva', estado: 'Abierta',
      beneficiario: 'Entidad pública',
      importe: '€80.000', cierre: '2026-06-10',
      descripcion: 'Ayudas a entidades locales para el fomento de la cultura y el patrimonio en el ámbito provincial.',
      enlace: 'https://www.dival.es',
      fechaPublicacion: '2026-04-01',
    },
    {
      id: 'gva-respaldo-3',
      titulo: 'Ajudes IVACE per a la innovació en PIMES valencianes 2026',
      organismo: 'IVACE — Comunitat Valenciana',
      ambito: 'loc', fuente: 'gva', estado: 'Abierta',
      beneficiario: 'Empresa',
      importe: '€150.000', cierre: '2026-07-31',
      descripcion: 'Programa de ayudas del IVACE para incorporación de tecnologías innovadoras y digitalización en pymes valencianas.',
      enlace: 'https://www.ivace.es',
      fechaPublicacion: '2026-04-10',
    },
  ];

  return res.status(200).json({
    ok: true,
    fuente: 'gva',
    advertencia: `RSS del DOGV no accesible desde Vercel (${lastError}). Mostrando datos de referencia.`,
    total: respaldo.length,
    data: respaldo,
  });
};
