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

  const ADV_ID = 703867; // confirmed advertiser_id for this account

  // Try all possible campaign/report paths for PADS
  const paths = [
    `/advertising/product_ads/campaigns?advertiser_id=${ADV_ID}&date_from=${from}&date_to=${to}`,
    `/advertising/campaigns?advertiser_id=${ADV_ID}&product_id=PADS&date_from=${from}&date_to=${to}`,
    `/advertising/product_ads/campaigns?advertiser_id=${ADV_ID}`,
    `/advertising/campaigns?advertiser_id=${ADV_ID}&product_id=PADS`,
    `/advertising/advertisers/${ADV_ID}/campaigns?product_id=PADS`,
    `/advertising/advertisers/${ADV_ID}/metrics?product_id=PADS&date_from=${from}&date_to=${to}`,
    `/advertising/advertisers/${ADV_ID}/summary?product_id=PADS&date_from=${from}&date_to=${to}`,
    `/advertising/advertisers/${ADV_ID}/spending?product_id=PADS&date_from=${from}&date_to=${to}`,
    `/advertising/advertisers/${ADV_ID}/reports/spending?product_id=PADS&date_from=${from}&date_to=${to}`,
    `/advertising/advertisers/${ADV_ID}/reports/campaigns?product_id=PADS&date_from=${from}&date_to=${to}`,
  ];

  const debug = {};
  for (const p of paths) {
    const r = await apiGet(p, token);
    if (r.status !== 404) debug[p] = { status: r.status, body: r.body };
    else debug[p] = r.status;
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent: 0, available: false, debug }),
  };
};
