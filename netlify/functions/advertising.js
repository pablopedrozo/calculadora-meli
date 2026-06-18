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

  // Try different date param names with known advertiser
  const dateVariants = [
    `date_from=${from}&date_to=${to}`,
    `from=${from}&to=${to}`,
    `start_date=${from}&end_date=${to}`,
    `from_date=${from}&to_date=${to}`,
    `begin=${from}&end=${to}`,
  ];

  for (const dates of dateVariants) {
    const p = `/advertising/product_ads/advertisers/${ADV_ID}/reports/daily_performance?${dates}`;
    const r = await apiGet(p, token);
    if (r.status !== 404) debug[`date_variant: ${dates}`] = { status: r.status, body: r.body };
  }

  // Try different report path structures
  const paths = [
    `/advertising/reports/daily_performance?advertiser_id=${ADV_ID}&product_id=PADS&date_from=${from}&date_to=${to}`,
    `/advertising/report?product_id=PADS&advertiser_id=${ADV_ID}&date_from=${from}&date_to=${to}`,
    `/advertising/product_ads/report?advertiser_id=${ADV_ID}&date_from=${from}&date_to=${to}`,
    `/advertising/product_ads/advertiser/${ADV_ID}/reports/daily_performance?date_from=${from}&date_to=${to}`,
    `/advertising/product_ads/advertisers/${ADV_ID}/performance?date_from=${from}&date_to=${to}`,
    `/advertising/product_ads/advertisers/${ADV_ID}/stats?date_from=${from}&date_to=${to}`,
    `/advertising/product_ads/advertisers/${ADV_ID}/insights?date_from=${from}&date_to=${to}`,
    `/advertising/product_ads/advertisers/${ADV_ID}`,
    `/advertising/advertisers/${ADV_ID}?product_id=PADS&date_from=${from}&date_to=${to}`,
    `/advertising/advertisers/${ADV_ID}/performance?product_id=PADS&date_from=${from}&date_to=${to}`,
  ];

  for (const p of paths) {
    const r = await apiGet(p, token);
    debug[p] = r.status === 404 ? 404 : { status: r.status, body: r.body };
  }

  const working = Object.entries(debug).find(([, v]) => v !== 404 && v.status === 200);
  if (working) {
    return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, working: working[0], data: working[1].body }) };
  }

  return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, debug }) };
};
