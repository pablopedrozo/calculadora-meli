const https = require("https");

function apiGet(path, token, apiVersion) {
  return new Promise((resolve) => {
    const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (apiVersion) headers["Api-Version"] = String(apiVersion);
    const options = { hostname: "api.mercadolibre.com", path, method: "GET", headers };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        let body; try { body = JSON.parse(raw); } catch (e) { body = raw.slice(0, 400); }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", (e) => resolve({ status: 0, body: { error: e.message } }));
    req.end();
  });
}

// Suma el gasto (cost) de un array de campañas, probando nombres de campo conocidos
function sumSpend(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((s, c) => {
    const m = c.metrics || c;
    const cost = m.cost ?? m.total_amount ?? m.spend ?? m.amount ?? m.investment ?? 0;
    return s + (Number(cost) || 0);
  }, 0);
}

exports.handler = async (event) => {
  const { token, user_id, from, to, site = "MLA" } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  const debug = {};

  // 1. Advertiser ID (endpoint conocido que funciona)
  let advertiser_id = null;
  const adv = await apiGet(`/advertising/advertisers?product_id=PADS`, token, 1);
  debug.advertisers = { status: adv.status, body: adv.body };
  if (adv.status === 200) {
    const list = adv.body?.advertisers || adv.body?.results || (Array.isArray(adv.body) ? adv.body : []);
    advertiser_id = list[0]?.advertiser_id || list[0]?.id || null;
  }
  if (!advertiser_id) advertiser_id = 703867; // fallback conocido de la cuenta

  // 2. Endpoints nuevos (marketplace) — los viejos se deprecaron feb 2026
  const metricFields = "clicks,prints,cost,cpc,acos,total_amount";
  const candidates = [
    `/advertising/${site}/advertisers/${advertiser_id}/product_ads/campaigns/search?date_from=${from}&date_to=${to}&limit=100&metrics=${metricFields}&metrics_summary=true`,
    `/marketplace/advertising/${site}/advertisers/${advertiser_id}/product_ads/campaigns/search?date_from=${from}&date_to=${to}&limit=100&metrics=${metricFields}&metrics_summary=true`,
    `/advertising/product_ads/${site}/advertisers/${advertiser_id}/campaigns/search?date_from=${from}&date_to=${to}&limit=100&metrics=${metricFields}`,
    `/advertising/advertisers/${advertiser_id}/product_ads/campaigns/search?date_from=${from}&date_to=${to}&limit=100&metrics=${metricFields}`,
  ];

  let total_spent = 0;
  let endpoint = null;

  for (const path of candidates) {
    // probar con Api-Version 1 y 2
    for (const ver of [1, 2]) {
      const r = await apiGet(path, token, ver);
      const key = `v${ver} ${path.split("?")[0]}`;
      debug[key] = { status: r.status, body_preview: typeof r.body === "object" ? JSON.stringify(r.body).slice(0, 250) : r.body };
      if (r.status === 200 && r.body) {
        // El resumen de métricas puede venir en metrics_summary o sumando results
        const summary = r.body.metrics_summary || r.body.metrics || null;
        const fromSummary = summary ? (summary.cost ?? summary.total_amount ?? 0) : 0;
        const fromList = sumSpend(r.body.results || r.body.campaigns || []);
        const spend = Number(fromSummary) || fromList;
        if (spend > 0) { total_spent = spend; endpoint = key; break; }
        // status 200 pero sin gasto: igual lo damos por válido (puede ser 0 real)
        if (!endpoint) { endpoint = key; }
      }
    }
    if (total_spent > 0) break;
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent, available: total_spent > 0, advertiser_id, endpoint, debug }),
  };
};
