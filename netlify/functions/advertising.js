const https = require("https");

function apiRequest(hostname, path, token, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`https://${hostname}${path}`);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "X-Caller-Id": "1877728575",
        "X-Format-New": "true",
        ...extraHeaders,
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw.slice(0, 500) }); }
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

  const debug = {};

  const paths = [
    [PA, `/pa/api/admin-pads/ajax/campaigns/metrics?dateFrom=${from}&dateTo=${to}&advertiserId=${ADV_ID}`, { "X-Caller-Id": user_id, "X-Advertiser-Id": String(ADV_ID) }],
    [PA, `/pa/api/admin-pads/ajax/summary?dateFrom=${from}&dateTo=${to}&advertiserId=${ADV_ID}`, { "X-Caller-Id": user_id }],
    [ML, `/advertising/product_ads/campaigns/search?advertiserId=${ADV_ID}&status=A,D&dateFrom=${from}&dateTo=${to}&limit=50`, { "X-Caller-Id": user_id }],
    [ML, `/advertising/product_ads/campaigns/search?advertiserId=${ADV_ID}&status=ACTIVE&dateFrom=${from}&dateTo=${to}`, { "X-Caller-Id": user_id }],
    [ML, `/advertising/product_ads/advertisers/${ADV_ID}/campaigns?dateFrom=${from}&dateTo=${to}`, { "X-Caller-Id": user_id }],
  ];

  for (const [host, path, headers] of paths) {
    const r = await apiRequest(host, path, token, headers || {});
    debug[`${host}${path}`] = r.status === 404 ? 404 : { status: r.status, body: r.body };
  }

  const working = Object.entries(debug).find(([, v]) => v !== 404 && v.status === 200);
  if (working) {
    const body = working[1].body;
    const items = body?.results || body?.data || body?.campaigns || body?.daily_performance || (Array.isArray(body) ? body : []);
    const total_spent = Array.isArray(items)
      ? items.reduce((s, d) => s + (d.total_amount || d.totalSpend || d.spend || d.cost || 0), 0)
      : (body?.totalSpend || body?.total_spend || body?.spend || 0);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_spent, available: total_spent > 0, endpoint: working[0], debug }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent: 0, available: false, debug }),
  };
};
