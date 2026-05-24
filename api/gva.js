/**
 * /api/gva.js — v3 con BDNS
 *
 * Consulta la API REST de la BDNS filtrando por:
 *   - Comunitat Valenciana (ambitoGeografico=9, código de la CV)
 *   - Convocatorias abiertas (estado=1)
 *
 * Si la BDNS no es accesible desde Vercel, mantiene datos de respaldo.
 *
 * Documentación BDNS API:
 * https://www.infosubvenciones.es/bdnstrans/ayuda/pdf/AYUDA_API_REST
 */

const PORTAL_BASE = 'https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias/';
const NOW         = new Date();

// URLs a probar para la BDNS — distintos parámetros documentados
const BDNS_URLS = [
  // Convocatorias abiertas de la Comunitat Valenciana
  'https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias?page=0&pageSize=50&estado=1&ambitoGeografico=9',
  // Sin filtro de ámbito — todas las abiertas
  'https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias?page=0&pageSize=20&estado=1',
  // Formato alternativo documentado
  'https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias.json?page=0&pageSize=20&estado=1',
];

const HEADERS = {
  'User-Agent':  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':      'application/json, text/html, */*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Referer':     'https://www.infosubvenciones.es/',
  'Origin':      'https://www.infosubvenciones.es',
};

function stripHtml(s) {
  return (s||'').replace(/<[^>]+>/g,' ').replace(/&[a-z#\d]+;/gi,' ').replace(/\s+/g,' ').trim();
}
function fmtImporte(n) {
  const v=parseFloat(String(n||'').replace(/[^0-9.]/g,''));
  if (isNaN(v)||v===0) return null;
  if (v>=1_000_000) return `€${(v/1_000_000).toFixed(1)}M`;
  if (v>=1_000)     return `€${Math.round(v/1_000)}K`;
  return `€${Math.round(v).toLocaleString('es-ES')}`;
}
function parseDate(d) {
  if (!d) return null;
  // BDNS usa formato dd/mm/yyyy o yyyy-MM-dd
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) {
    const [dd,mm,yyyy] = d.split('/');
    return `${yyyy}-${mm}-${dd}`;
  }
  try { const dt=new Date(d); if (!isNaN(dt)) return dt.toISOString().split('T')[0]; } catch {}
  return null;
}
function isFuture(s) {
  if (!s) return true;
  try { return new Date(s)>NOW; } catch { return true; }
}

function mapConvocatoria(c) {
  if (!c) return null;
  const titulo = c.titulo || c.descripcion || c.objeto || '';
  if (!titulo) return null;

  const deadline = parseDate(c.fechaFinSolicitud || c.fechaFin || c.plazoSolicitud);
  if (deadline && !isFuture(deadline)) return null; // descartada si ya cerró

  const bdnsId = c.idConvocatoria || c.codigoBDNS || c.id || '';

  return {
    id:               'gva-bdns-' + bdnsId,
    titulo:           titulo.slice(0, 200),
    organismo:        c.organo || c.organismo || c.nombreOrgano || 'Administración Pública',
    ambito:           'loc',
    fuente:           'gva',
    estado:           'Abierta',
    beneficiario:     c.tipoBeneficiario || c.beneficiarios || 'Entidad pública',
    importe:          fmtImporte(c.importeTotal || c.presupuesto || c.dotacionTotal),
    cierre:           deadline,
    descripcion:      stripHtml(c.objeto || c.descripcion || titulo).slice(0, 500),
    enlace:           bdnsId
                        ? `${PORTAL_BASE}${bdnsId}`
                        : 'https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias',
    fechaPublicacion: parseDate(c.fechaPublicacion || c.fechaRegistro || c.fechaInicio),
    referencia:       bdnsId ? String(bdnsId) : null,
  };
}

async function fetchBDNS(url) {
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal });
    clearTimeout(timeout);
    if (!r.ok) return { ok: false, status: r.status };
    const ct = r.headers.get('content-type') || '';
    const text = await r.text();
    // Intentar parsear como JSON
    if (ct.includes('json') || text.trim().startsWith('{') || text.trim().startsWith('[')) {
      const json = JSON.parse(text);
      return { ok: true, json, preview: text.slice(0, 500) };
    }
    return { ok: false, notJson: true, preview: text.slice(0, 300), ct };
  } catch (e) {
    clearTimeout(timeout);
    return { ok: false, error: e.message };
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
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');

  // Probar todas las URLs de la BDNS en orden
  const diagnostico = [];
  for (const url of BDNS_URLS) {
    const result = await fetchBDNS(url);
    diagnostico.push({ url, ...result });

    if (result.ok && result.json) {
      // Extraer el array de convocatorias — puede estar en distintos campos
      const json = result.json;
      const lista =
        json.content ||       // Spring Boot paginado
        json.convocatorias ||
        json.data ||
        json.results ||
        (Array.isArray(json) ? json : []);

      if (lista.length > 0) {
        const data = lista.map(mapConvocatoria).filter(Boolean);
        return res.status(200).json({
          ok:    true,
          fuente: 'gva',
          via:   'BDNS API',
          url_usada: url,
          total: data.length,
          data,
        });
      }
    }
  }

  // Si BDNS no es accesible → datos de respaldo curados
  const respaldo = [
    {
      id:'gva-respaldo-1',
      titulo:'Ajudes per a la modernització d\'infraestructures de serveis socials 2026',
      organismo:'Conselleria de Serveis Socials — Generalitat Valenciana',
      ambito:'loc', fuente:'gva', estado:'Próxima',
      beneficiario:'Entidad pública',
      importe:'€8.500.000', cierre:'2026-09-01',
      descripcion:'Convocatoria de la GVA para financiar obras, equipamiento y proyectos técnicos de centros de servicios sociales. Tope 150.000€ por entidad.',
      enlace:'https://serviciossociales.gva.es',
      fechaPublicacion:'2026-03-10', referencia:null,
    },
    {
      id:'gva-respaldo-2',
      titulo:'Subvencions per al foment de la cultura local — Diputació de València',
      organismo:'Diputació de València',
      ambito:'loc', fuente:'gva', estado:'Abierta',
      beneficiario:'Entidad pública',
      importe:'€80.000', cierre:'2026-06-10',
      descripcion:'Ayudas a entidades locales para el fomento de la cultura y el patrimonio en el ámbito provincial.',
      enlace:'https://www.dival.es',
      fechaPublicacion:'2026-04-01', referencia:null,
    },
    {
      id:'gva-respaldo-3',
      titulo:'Ajudes IVACE per a la innovació en PIMES valencianes 2026',
      organismo:'IVACE — Institut Valencià de Competitivitat',
      ambito:'loc', fuente:'gva', estado:'Abierta',
      beneficiario:'Empresa',
      importe:'€150.000', cierre:'2026-07-31',
      descripcion:'Ayudas del IVACE para incorporación de tecnologías innovadoras y digitalización en pymes valencianas.',
      enlace:'https://www.ivace.es',
      fechaPublicacion:'2026-04-10', referencia:null,
    },
  ];

  return res.status(200).json({
    ok:          true,
    fuente:      'gva',
    via:         'respaldo curado (BDNS no accesible)',
    diagnostico: diagnostico.map(d => ({
      url: d.url,
      status: d.status,
      error: d.error,
      notJson: d.notJson,
      ct: d.ct,
      preview: d.preview?.slice(0, 100),
    })),
    total:       respaldo.length,
    data:        respaldo,
  });
};
