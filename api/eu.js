/**
 * /api/eu.js — versión diagnóstico v2
 * Sin ningún filtro. Muestra distribución real de type y status
 * en los primeros 50 resultados para entender la estructura.
 */

const API_URL = 'https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***';
const NOW     = new Date();

function first(f) {
  if (!f) return null;
  if (Array.isArray(f)) return f[0] ?? null;
  return f;
}

function buildBody(pageNumber = 1, pageSize = 50, sortBy = 'deadlineDate', orderBy = 'DESC') {
  const fd = new URLSearchParams();
  fd.append('languages',  '["en"]');
  fd.append('pageNumber', String(pageNumber));
  fd.append('pageSize',   String(pageSize));
  fd.append('sortBy',     sortBy);
  fd.append('orderBy',    orderBy);
  return fd.toString();
}

async function fetchRaw(pageNumber = 1, pageSize = 10, sortBy = 'deadlineDate', orderBy = 'DESC') {
  const ctrl    = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(API_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept':       'application/json',
        'User-Agent':   'Mozilla/5.0 (compatible; FinanciApp/2.0)',
      },
      body:   buildBody(pageNumber, pageSize, sortBy, orderBy),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).end();
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  try {
    // Tres llamadas en paralelo con distintos ordenamientos
    const [byDeadlineDesc, byDeadlineAsc, byStartDesc] = await Promise.all([
      fetchRaw(1, 10, 'deadlineDate', 'DESC'),
      fetchRaw(1, 10, 'deadlineDate', 'ASC'),
      fetchRaw(1, 10, 'startDate',    'DESC'),
    ]);

    function summarize(json) {
      const results = json.results ?? [];
      return results.map(item => {
        const md = item.metadata || {};
        return {
          type:       first(md.type),
          status:     first(md.status),
          deadline:   first(md.deadlineDate),
          startDate:  first(md.startDate),
          title:      first(md.title) ?? item.title ?? item.content ?? '',
          identifier: first(md.identifier) ?? item.reference ?? '',
          database:   item.databaseLabel ?? item.database ?? '',
        };
      });
    }

    // Contar distribución de type y status
    function distribution(items, field) {
      const counts = {};
      items.forEach(i => {
        const v = String(i[field] ?? 'null');
        counts[v] = (counts[v] || 0) + 1;
      });
      return counts;
    }

    const ddDesc = summarize(byDeadlineDesc);
    const ddAsc  = summarize(byDeadlineAsc);
    const sdDesc = summarize(byStartDesc);

    return res.status(200).json({
      ok:            true,
      total_portal:  byDeadlineDesc.totalResults,
      diagnostico: {
        deadline_DESC: {
          type_dist:   distribution(ddDesc, 'type'),
          status_dist: distribution(ddDesc, 'status'),
          muestra:     ddDesc.slice(0, 5),
        },
        deadline_ASC: {
          type_dist:   distribution(ddAsc, 'type'),
          status_dist: distribution(ddAsc, 'status'),
          muestra:     ddAsc.slice(0, 5),
        },
        startDate_DESC: {
          type_dist:   distribution(sdDesc, 'type'),
          status_dist: distribution(sdDesc, 'status'),
          muestra:     sdDesc.slice(0, 5),
        },
      },
    });

  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
