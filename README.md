# FinanciApp · NTT DATA
## Integración API — Funding & Tenders EU

---

### Estructura del repositorio

```
/
├── index.html              ← Frontend completo (autocontenido)
├── vercel.json             ← Configuración Vercel (rutas + headers)
└── api/
    └── eu-grants.js        ← Serverless function (proxy EU API)
```

---

### Despliegue en Vercel

**1. Añadir los ficheros al repositorio**

```bash
git add index.html vercel.json api/eu-grants.js
git commit -m "feat: integración API Funding & Tenders EU"
git push
```

Vercel desplegará automáticamente al hacer push.

**2. Verificar que la función está activa**

```
GET https://financiapp-wvx2.vercel.app/api/eu-grants
```

Respuesta esperada:
```json
{
  "ok": true,
  "meta": {
    "total": 1847,
    "page": 1,
    "pageSize": 100,
    "pages": 19,
    "cached": false,
    "cachedAt": "2025-05-27T10:00:00.000Z",
    "source": "EU Funding & Tenders Portal"
  },
  "data": [ ... ]
}
```

---

### API Reference

#### `GET /api/eu-grants`

Devuelve convocatorias del portal Funding & Tenders de la Comisión Europea,
normalizadas al formato FinanciApp.

**Query params:**

| Param       | Tipo   | Descripción                                      | Ejemplo               |
|-------------|--------|--------------------------------------------------|-----------------------|
| `status`    | string | Filtrar por estado: `open`, `forthcoming`, `closed` | `?status=open`     |
| `programme` | string | Filtrar por programa (parcial, case-insensitive) | `?programme=HORIZON`  |
| `q`         | string | Búsqueda libre en título, org, tags              | `?q=digitalisation`   |
| `page`      | number | Número de página (desde 1)                       | `?page=2`             |
| `size`      | number | Resultados por página (máx. 100, def. 50)        | `?size=100`           |

**Objeto `data[]`:**

```typescript
{
  id:           string   // identificador interno de la CE (ej: "horizon-cl4-2025-…")
  src:          "eu"
  title:        string   // título del tópico
  callTitle:    string   // título de la convocatoria padre
  org:          string   // nombre del programa (ej: "Horizon Europe")
  programme:    string   // acrónimo (ej: "HORIZON")
  status:       "open" | "forthcoming" | "closed"
  amount:       string   // importe formateado (ej: "hasta 3 M €")
  deadline:     string   // DD/MM/AAAA o "Sin fecha definida"
  deadlineSort: string   // AAAA-MM-DD (para ordenación)
  openDate:     string | null
  tags:         string[]
  obj:          string[] // ["idi","digital","sostenib","inversion","inter","formacion"]
  entity:       string[] // ["pyme","gran","startup","uni","publica","ong"]
  fondo:        "subvencion"
  url:          string   // enlace directo a la ficha en el portal
  identifier:   string
  actions:      string[]
  keywords:     string[]
}
```

---

### Funcionamiento técnico

```
Browser → GET /api/eu-grants
             ↓
         Vercel Edge (eu-grants.js)
             ↓ (si caché expirada, TTL=1h)
         POST https://api.tech.ec.europa.eu/search-api/prod/rest/search
             ↓ (si falla)
         GET  https://ec.europa.eu/info/funding-tenders/…/callupdates-rss.xml
             ↓
         Normalización + paginación
             ↓
         JSON → Browser
```

**Caché:** los datos se cachean en memoria durante 1 hora por instancia.
Vercel también aplica `s-maxage=3600` a nivel de CDN.
El frontend carga todas las páginas en segundo plano con paginación automática.

**Fallback:** si la API principal de la CE falla, se intenta el RSS oficial.
Si ambos fallan, el frontend usa los datos BDNS estáticos incorporados en `index.html`.

---

### Fuentes oficiales

- **Portal:** https://ec.europa.eu/info/funding-tenders/opportunities/portal/
- **API (no oficial):** https://api.tech.ec.europa.eu/search-api/prod/rest/search
- **RSS actualizaciones:** https://ec.europa.eu/info/funding-tenders/opportunities/data/referenceData/callupdates-rss.xml
- **Topic list:** https://ec.europa.eu/info/funding-tenders/opportunities/data/topic-list.html

> ⚠️ La API de búsqueda del portal es interna y no está documentada oficialmente.
> Puede cambiar sin previo aviso. Si deja de funcionar, el fallback RSS se activa automáticamente.
> Para una integración estable a largo plazo, contactar con la CE para acceso a la API oficial.

---

### Próximos pasos

- [ ] Integrar API BDNS (https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias)
- [ ] Webhook o cron job para invalidar caché y notificar nuevas convocatorias
- [ ] Almacenar convocatorias en base de datos (Vercel KV / Postgres) para búsqueda full-text
- [ ] Añadir filtros por programa Horizon (EIC, ERC, MSCA, etc.)
- [ ] Dashboard de alertas por email (Resend / SendGrid)
