const https = require("https");

function apiGet(hostname, path, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`https://${hostname}${path}`);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw.slice(0, 300) }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const { token, user_id, from, to } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  const ADV_ID = 703867;
  const ML = "api.mercadolibre.com";
  const PA = "pa.mercadolibre.com.ar";

  const attempts = [
    // camelCase dates on api.mercadolibre.com
    [ML, `/advertising/product_ads/advertisers/${ADV_ID}/metrics?dateFrom=${from}&dateTo=${to}`],
    [ML, `/advertising/advertisers/${ADV_ID}/metrics?product_id=PADS&dateFrom=${from}&dateTo=${to}`],
    [ML, `/advertising/product_ads/advertisers/${ADV_ID}/reports/daily_performance?dateFrom=${from}&dateTo=${to}`],
    [ML, `/advertising/product_ads/campaigns/metrics?advertiserId=${ADV_ID}&dateFrom=${from}&dateTo=${to}`],
    [ML, `/advertising/advertisers/${ADV_ID}/campaigns/metrics?product_id=PADS&dateFrom=${from}&dateTo=${to}`],
    // Try pa.mercadolibre.com.ar with OAuth token
    [PA, `/pa/api/admin-pads/ajax/campaigns/metrics?dateFrom=${from}&dateTo=${to}`],
    [PA, `/pa/api/admin-pads/ajax/campaigns/metrics?dateFrom=${from}&dateTo=${to}&advertiserId=${ADV_ID}`],
    [PA, `/pa/api/admin-pads/ajax/campaigns/search?dateFrom=${from}&dateTo=${to}`],
  ];

  const debug = {};
  for (const [host, path] of attempts) {
    const r = await apiGet(host, path, token);
    debug[`${host}${path}`] = r.status === 404 ? 404 : { status: r.status, body: r.body };
  }

  const working = Object.entries(debug).find(([, v]) => v !== 404 && v.status === 200);
  if (working) {
    const body = working[1].body;
    const days = body?.daily_performance || body?.results || body?.data || body?.campaigns || [];
    const total_spent = Array.isArray(days) ? days.reduce((s, d) => s + (d.total_amount || d.spend || d.cost || d.totalSpend || 0), 0) : (body?.totalSpend || body?.total_spend || 0);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_spent, available: total_spent > 0, FOUND: working[0], data: body }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent: 0, available: false, debug }),
  };
};
