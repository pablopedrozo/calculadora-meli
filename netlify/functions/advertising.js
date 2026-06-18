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
  const ACC_ID = 741721;
  const debug = {};

  const paths = [
    `/advertising/product_ads/advertisers/${ACC_ID}/reports/daily_performance?date_from=${from}&date_to=${to}`,
    `/advertising/product_ads/advertisers/${ACC_ID}/campaigns`,
    `/advertising/advertisers/${ACC_ID}/reports/daily_performance?date_from=${from}&date_to=${to}&product_id=PADS`,
    `/advertising/advertisers?account_id=${ACC_ID}&product_id=PADS`,
    `/advertising/product_ads/advertisers/${ADV_ID}/reports/daily_performance?date_from=${from}&date_to=${to}&account_id=${ACC_ID}`,
    `/advertising/product_ads/advertisers/${ADV_ID}/campaigns?account_id=${ACC_ID}`,
    `/advertising/advertisers/${ADV_ID}/reports/daily_performance?date_from=${from}&date_to=${to}&account_id=${ACC_ID}&product_id=PADS`,
    `/advertising/product_ads/accounts/${ACC_ID}/reports/daily_performance?date_from=${from}&date_to=${to}`,
    `/advertising/product_ads/accounts/${ACC_ID}/campaigns`,
    `/advertising/accounts/${ACC_ID}/reports?product_id=PADS&date_from=${from}&date_to=${to}`,
  ];

  for (const p of paths) {
    const r = await apiGet(p, token);
    debug[p] = r.status === 404 ? 404 : { status: r.status, body: r.body };
  }

  const working = Object.entries(debug).find(([, v]) => v !== 404 && v.status === 200);

  if (working) {
    const body = working[1].body;
    const days = body?.daily_performance || body?.results || body?.campaigns || [];
    const total_spent = Array.isArray(days) ? days.reduce((s, d) => s + (d.total_amount || d.spend || d.cost || 0), 0) : 0;
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_spent, available: true, working_endpoint: working[0], debug }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent: 0, available: false, debug }),
  };
};
