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

  const debug = {};

  // Try every known product_id variation
  const productIds = [
    "MP_ADS", "MPAds", "MPads", "mpads",
    "SPONSORED", "sponsored",
    "DISPLAY", "BRAND", "NATIVE", "SEARCH",
    "ADS", "MLA", "PUBLICIDAD",
    "product_ads", "PRODUCT_ADS",
    "MELI_ADS", "meli_ads",
    "PADS", "PAds",
  ];

  const results = {};
  for (const pid of productIds) {
    const r = await apiGet(`/advertising/advertisers?user_id=${user_id}&product_id=${pid}`, token);
    // Only record non-400 "Invalid product id" responses to find the valid one
    const isInvalid = r.status === 400 && JSON.stringify(r.body).includes("Invalid product id");
    if (!isInvalid) {
      results[pid] = { status: r.status, body: r.body };
    }
  }

  debug.valid_product_ids = results;
  debug.all_tried = productIds;

  // Find working advertiser
  const working = Object.entries(results).find(([, v]) => v.status === 200);
  if (!working) {
    return {
      statusCode: 200,
      body: JSON.stringify({ total_spent: 0, available: false, debug }),
    };
  }

  const [pid, data] = working;
  const advId = data.body?.id || data.body?.advertiser_id ||
    (Array.isArray(data.body) ? data.body[0]?.id : null) || user_id;

  const rep = await apiGet(
    `/advertising/product_ads/advertisers/${advId}/reports/daily_performance?date_from=${from}&date_to=${to}`,
    token
  );
  debug.report = { status: rep.status, body: rep.body };

  const days = rep.body?.daily_performance || [];
  const total_spent = days.reduce((s, d) => s + (d.total_amount || 0), 0);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent, available: total_spent > 0, product_id_used: pid, advertiser_id: advId, debug }),
  };
};
