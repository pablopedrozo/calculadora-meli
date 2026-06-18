const https = require("https");

function apiGet(path, token) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`https://api.mercadolibre.com${path}`);
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
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
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
  const debug = {};

  // Try metrics endpoint with camelCase dates (what the dashboard actually uses)
  const paths = [
    `/advertising/product_ads/advertisers/${ADV_ID}/metrics?dateFrom=${from}&dateTo=${to}`,
    `/advertising/advertisers/${ADV_ID}/metrics?product_id=PADS&dateFrom=${from}&dateTo=${to}`,
    `/advertising/advertisers/${ADV_ID}/metrics?dateFrom=${from}&dateTo=${to}`,
    `/advertising/product_ads/advertisers/${ADV_ID}/reports/daily_performance?dateFrom=${from}&dateTo=${to}`,
    `/advertising/product_ads/advertisers/${ADV_ID}/campaigns/metrics?dateFrom=${from}&dateTo=${to}`,
    `/advertising/advertisers/${ADV_ID}/campaigns/metrics?product_id=PADS&dateFrom=${from}&dateTo=${to}`,
    `/advertising/product_ads/campaigns/metrics?advertiserId=${ADV_ID}&dateFrom=${from}&dateTo=${to}`,
    `/advertising/product_ads/campaigns/metrics?advertiser_id=${ADV_ID}&dateFrom=${from}&dateTo=${to}`,
  ];

  for (const p of paths) {
    const r = await apiGet(p, token);
    debug[p] = r.status === 404 ? 404 : { status: r.status, body: r.body };
  }

  const working = Object.entries(debug).find(([, v]) => v !== 404 && v.status === 200);
  if (working) {
    return {
      statusCode: 200,
      body: JSON.stringify({ total_spent: 0, available: false, FOUND: working[0], data: working[1].body }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent: 0, available: false, debug }),
  };
};
