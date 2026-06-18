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

  // Step 1: search campaigns to get campaign IDs
  const searchPaths = [
    `/advertising/product_ads/campaigns/search?advertiserId=${ADV_ID}&dateFrom=${from}&dateTo=${to}&limit=100`,
    `/advertising/product_ads/campaigns/search?advertiser_id=${ADV_ID}&dateFrom=${from}&dateTo=${to}&limit=100`,
    `/advertising/product_ads/campaigns/search?advertiserId=${ADV_ID}&limit=100`,
    `/advertising/product_ads/campaigns?advertiserId=${ADV_ID}&dateFrom=${from}&dateTo=${to}`,
    `/advertising/product_ads/campaigns?advertiser_id=${ADV_ID}`,
  ];

  let campaignIds = [];
  for (const p of searchPaths) {
    const r = await apiGet(p, token);
    debug[`search: ${p}`] = r.status === 404 ? 404 : { status: r.status, body: r.body };
    if (r.status === 200) {
      const results = r.body?.results || r.body?.campaigns || r.body?.data || (Array.isArray(r.body) ? r.body : []);
      campaignIds = results.map(c => c.id || c.campaign_id || c.campaignId).filter(Boolean);
      if (campaignIds.length > 0) break;
    }
  }

  debug.campaignIds = campaignIds;

  // Step 2: get metrics with campaign IDs
  if (campaignIds.length > 0) {
    const ids = campaignIds.join(",");
    const metricsPaths = [
      `/advertising/product_ads/campaigns/metrics?campaignIds=${ids}&dateFrom=${from}&dateTo=${to}`,
      `/advertising/product_ads/campaigns/metrics?campaign_ids=${ids}&dateFrom=${from}&dateTo=${to}`,
      `/advertising/product_ads/campaigns-table?campaignIds=${ids}&dateFrom=${from}&dateTo=${to}`,
    ];
    for (const p of metricsPaths) {
      const r = await apiGet(p, token);
      debug[`metrics: ${p}`] = r.status === 404 ? 404 : { status: r.status, body: r.body };
      if (r.status === 200) {
        const body = r.body;
        const items = body?.results || body?.data || body?.campaigns || (Array.isArray(body) ? body : []);
        const total_spent = items.reduce((s, d) => s + (d.total_amount || d.totalSpend || d.spend || d.cost || 0), 0);
        return {
          statusCode: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ total_spent, available: true, endpoint: p, debug }),
        };
      }
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent: 0, available: false, debug }),
  };
};
