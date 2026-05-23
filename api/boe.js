/**
 * /api/boe.js
 * Proxy para las fuentes del BOE:
 *   GET /api/boe?fuente=ayudas   → RSS canal ayudas
 *   GET /api/boe?fuente=sec3     → API sumario sección III (últimos 3 días hábiles)
 *
 * Corre en el servidor de Vercel → sin restricción CORS.
 * Cache de 15 minutos en Vercel Edge para no sobrecargar el BOE.
 */

const CANAL_AYUDAS = 'https://www.boe.es/rss/canal.php?c=ayudas';
const API_SUMARIO  = 'https://boe.es/datosabiertos/api/boe/sumario/';

// Palabras clave que identifican convocatorias de subvenciones en sección III
const KW_SUBV = [
  'subvenci', 'convocator', 'ayuda', 'financiaci',
  'beca', 'programa de apoyo', 'concurso de', 'fondo',
];

// Últimas N fechas de días hábiles (lunes-viernes) hacia atrás
function diasHabiles(n) {
  const fechas = [];
  const hoy = new Date();
  let cursor = new Date(hoy);
  while (fechas.length < n) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      fechas.push(cursor.toISOString().slice(0, 10).replace(/-/g, ''));
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return fechas;
}

// Convierte un <item> del RSS canal-ayudas en objeto normalizado
function mapRSSItem(item) {
  const get = tag => {
    const m = item.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
    return m ? (m[1] || m[2] || '').trim() : '';
  };
  const title   = get('title');
  const link    = get('link') || get('guid');
  const desc    = get('description').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const pubDate = get('pubDate');
  const dept    = get('departamento') || '';

  return {
    id:               'boe-ayudas-' + Buffer.from(link || title).toString('base64').slice(0, 16),
    titulo:           title.slice(0, 200),
    organismo:        dept || extraerOrg(title) || 'BOE — Administración General del Estado',
    ambito:           'nac',
    fuente:           'boe-ayudas',
    estado:           'Abierta',
    beneficiario:     inferirBenef(title + ' ' + desc),
    importe:          extraerImporte(title + ' ' + desc),
    cierre:           extraerFecha(title + ' ' + desc),
    descripcion:      desc.slice(0, 500),
    enlace:           link,
    fechaPublicacion: pubDate,
  };
}

// Extrae items relevantes del JSON de la API sumario BOE
function extraerSec3(json) {
  const items = [];
  try {
    const sumario = json?.data?.sumario;
    if (!sumario) return items;
    const diarios = Array.isArray(sumario.diario) ? sumario.diario : [sumario.diario];
    for (const diario of diarios) {
      const secciones = Array.isArray(diario.seccion) ? diario.seccion : [diario.seccion];
      for (const sec of secciones) {
        if (sec?.codigo !== '3') continue; // solo Sección III
        const deptos = Array.isArray(sec.departamento) ? sec.departamento : [sec.departamento];
        for (const dep of deptos) {
          // Items directos del departamento (sin epígrafe)
          const directos = dep.item
            ? (Array.isArray(dep.item) ? dep.item : [dep.item])
            : [];
          // Items dentro de epígrafes
          const epis = dep.epigrafe
            ? (Array.isArray(dep.epigrafe) ? dep.epigrafe : [dep.epigrafe])
            : [];
          const deEpis = epis.flatMap(e =>
            e.item ? (Array.isArray(e.item) ? e.item : [e.item]) : []
          );
          for (const it of [...directos, ...deEpis]) {
            if (!it?.titulo) continue;
            const titulo = it.titulo;
            const relevante = KW_SUBV.some(k => titulo.toLowerCase().includes(k));
            if (!relevante) continue;
            items.push({
              id:               'boe-sec3-' + (it.identificador || Buffer.from(titulo).toString('base64').slice(0, 12)),
              titulo:           titulo.slice(0, 200),
              organismo:        dep.nombre || 'BOE — Sección III',
              ambito:           'nac',
              fuente:           'boe-sec3',
              estado:           'Abierta',
              beneficiario:     inferirBenef(titulo),
              importe:          extraerImporte(titulo),
              cierre:           null,
              descripcion:      `Publicado en BOE Sección III (Otras disposiciones). Departamento: ${dep.nombre || '—'}.`,
              enlace:           it.url_html || `https://www.boe.es/diario_boe/txt.php?id=${it.identificador}`,
              fechaPublicacion: null,
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('extraerSec3 error:', e.message);
  }
  return items;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function extraerOrg(title) {
  const m = title.match(/^(.+?)\s*[-–—.]\s/);
  return m ? m[1].trim().slice(0, 80) : null;
}
function inferirBenef(text) {
  const t = text.toLowerCase();
  if (t.includes('empresa') || t.includes('pyme') || t.includes('autónomo')) return 'Empresa';
  if (t.includes('ong') || t.includes('asociaci') || t.includes('fundaci') || t.includes('entidad sin')) return 'ONG / Tercer sector';
  if (t.includes('universid') || t.includes('investigaci')) return 'Universidad / Investigación';
  if (t.includes('ayuntamiento') || t.includes('municipal') || t.includes('local')) return 'Entidad local';
  return 'Entidad pública';
}
function extraerImporte(text) {
  const m = text.match(/[\d.,]+\s*(millones?|M€| M |miles?|K€|€|euros?)/i);
  return m ? m[0].trim() : null;
}
function extraerFecha(text) {
  const m = text.match(/\b(\d{1,2})[\/\-.](0?[1-9]|1[0-2])[\/\-.](\d{2,4})\b/);
  if (!m) return null;
  const y = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// ── Handler principal ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');

  const fuente = req.query.fuente || 'ayudas';

  try {
    // ── Canal ayudas RSS ──────────────────────────────────────────────────
    if (fuente === 'ayudas') {
      const r = await fetch(CANAL_AYUDAS, {
        headers: { 'User-Agent': 'FinanciApp/2.0 (https://financiapp.es)' },
      });
      if (!r.ok) throw new Error(`BOE canal ayudas HTTP ${r.status}`);
      const xml = await r.text();

      // Extraer <item>…</item> con regex (sin DOM en Node edge)
      const rawItems = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(m => m[1]);
      if (!rawItems.length) throw new Error('RSS sin items');

      const data = rawItems.map(mapRSSItem).filter(Boolean);
      return res.status(200).json({ ok: true, fuente: 'boe-ayudas', total: data.length, data });
    }

    // ── API sumario Sección III ───────────────────────────────────────────
    if (fuente === 'sec3') {
      const fechas = diasHabiles(3);
      const allItems = [];

      await Promise.all(fechas.map(async fecha => {
        try {
          const r = await fetch(API_SUMARIO + fecha, {
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'FinanciApp/2.0 (https://financiapp.es)',
            },
          });
          if (!r.ok) return;
          const json = await r.json();
          allItems.push(...extraerSec3(json));
        } catch (e) {
          console.warn(`BOE sumario ${fecha}:`, e.message);
        }
      }));

      return res.status(200).json({ ok: true, fuente: 'boe-sec3', total: allItems.length, data: allItems });
    }

    return res.status(400).json({ ok: false, error: 'Parámetro fuente inválido. Usa: ayudas | sec3' });

  } catch (err) {
    console.error('BOE handler error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
};
