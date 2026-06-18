const https = require("https");

function apiGet(path, token) {
  return new Promise((resolve) => {
    const options = {
      hostname: "api.mercadolibre.com",
      path,
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Api-Version": "1" },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => { let b; try { b = JSON.parse(raw); } catch (e) { b = null; } resolve({ status: res.statusCode, body: b }); });
    });
    req.on("error", () => resolve({ status: 0, body: null }));
    req.end();
  });
}

exports.handler = async (event) => {
  const { token, user_id, from, to, site = "MLA" } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  const json = (obj) => ({ statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });

  // 1. Advertiser ID de Product Ads (PADS)
  let advertiser_id = null;
  const adv = await apiGet(`/advertising/advertisers?product_id=PADS`, token);
  if (adv.status === 200) {
    const list = adv.body?.advertisers || adv.body?.results || [];
    advertiser_id = list[0]?.advertiser_id || list[0]?.id || null;
  }
  if (!advertiser_id) return json({ total_spent: 0, available: false, error: "no_advertiser", adv_status: adv.status });

  // 2. Campañas + métricas reales del período (gasto en metrics_summary.cost)
  // Endpoint nuevo marketplace — los viejos se deprecaron feb 2026
  const metricFields = "clicks,prints,cost,cpc,acos,total_amount,direct_amount,indirect_amount";
  const path = `/advertising/${site}/advertisers/${advertiser_id}/product_ads/campaigns/search?date_from=${from}&date_to=${to}&limit=100&metrics=${metricFields}&metrics_summary=true`;
  const r = await apiGet(path, token);

  if (r.status !== 200 || !r.body) {
    return json({ total_spent: 0, available: false, advertiser_id, status: r.status });
  }

  const summary = r.body.metrics_summary || {};
  const total_spent = Number(summary.cost) || 0;       // gasto real en publicidad
  const ventas_ads = Number(summary.total_amount) || 0; // ventas atribuidas (directas + indirectas)
  const acos = Number(summary.acos) || 0;               // % gasto/ventas atribuidas

  // Desglose de campañas con gasto en el período
  const campaigns = (r.body.results || [])
    .filter((c) => (c.metrics?.cost || 0) > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      cost: c.metrics.cost,
      ventas: c.metrics.total_amount || 0,
      acos: c.metrics.acos || 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  return json({ total_spent, ventas_ads, acos, available: total_spent > 0, advertiser_id, campaigns });
};
