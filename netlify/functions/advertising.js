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

  // Try search with accountId, userId, or no advertiser param
  const paths = [
    `/advertising/product_ads/campaigns/search?accountId=${ACC_ID}&dateFrom=${from}&dateTo=${to}&limit=100`,
    `/advertising/product_ads/campaigns/search?accountId=${ACC_ID}&limit=100`,
    `/advertising/product_ads/campaigns/search?userId=${user_id}&dateFrom=${from}&dateTo=${to}&limit=100`,
    `/advertising/product_ads/campaigns/search?dateFrom=${from}&dateTo=${to}&limit=100`,
    `/advertising/product_ads/campaigns/search?limit=100`,
    `/advertising/product_ads/campaigns/search?advertiserId=${ADV_ID}&accountId=${ACC_ID}&dateFrom=${from}&dateTo=${to}`,
    `/advertising/product_ads/campaigns/search?advertiser_id=${ADV_ID}&account_id=${ACC_ID}&dateFrom=${from}&dateTo=${to}`,
    // Try campaigns-table directly (seen in dashboard network)
    `/advertising/product_ads/campaigns-table?advertiserId=${ADV_ID}&dateFrom=${from}&dateTo=${to}`,
    `/advertising/product_ads/campaigns-table?accountId=${ACC_ID}&dateFrom=${from}&dateTo=${to}`,
  ];

  for (const p of paths) {
    const r = await apiGet(p, token);
    debug[p] = r.status === 404 ? 404 : { status: r.status, body: r.body };
  }

  const working = Object.entries(debug).find(([, v]) => v !== 404 && v.status === 200);
  if (working) {
    return { statusCode: 200, body: JSON.stringify({ found: working[0], data: working[1].body }) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent: 0, available: false, debug }),
  };
};
