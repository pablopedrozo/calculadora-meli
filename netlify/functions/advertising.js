const https = require("https");

function apiRequest(path, token, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`https://api.mercadolibre.com${path}`);
    const postBody = body ? JSON.stringify(body) : null;
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(postBody ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(postBody) } : {}),
      },
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
    if (postBody) req.write(postBody);
    req.end();
  });
}

exports.handler = async (event) => {
  const { token, user_id, from, to } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  const ADV_ID = 703867;
  const ACC_ID = 741721;
  const debug = {};

  // POST to campaigns/search with various body structures
  const bodies = [
    { advertiserId: ADV_ID, dateFrom: from, dateTo: to, limit: 100 },
    { accountId: ACC_ID, dateFrom: from, dateTo: to, limit: 100 },
    { advertiserId: ADV_ID, accountId: ACC_ID, dateFrom: from, dateTo: to, limit: 100 },
    { userId: Number(user_id), dateFrom: from, dateTo: to, limit: 100 },
    { advertiserId: ADV_ID, dateFrom: from, dateTo: to },
    { filters: { advertiserId: ADV_ID }, dateFrom: from, dateTo: to },
  ];

  let campaignIds = [];
  for (const body of bodies) {
    const r = await apiRequest(`/advertising/product_ads/campaigns/search`, token, "POST", body);
    debug[`POST search ${JSON.stringify(body)}`] = { status: r.status, body: r.status !== 404 ? r.body : 404 };
    if (r.status === 200) {
      const results = r.body?.results || r.body?.campaigns || (Array.isArray(r.body) ? r.body : []);
      campaignIds = results.map(c => c.id || c.campaign_id || c.campaignId).filter(Boolean);
      if (campaignIds.length > 0) {
        debug.found_campaigns = campaignIds;
        break;
      }
    }
  }

  if (campaignIds.length > 0) {
    const ids = campaignIds.join(",");
    const r = await apiRequest(`/advertising/product_ads/campaigns/metrics?campaignIds=${ids}&dateFrom=${from}&dateTo=${to}`, token);
    debug.metrics = { status: r.status, body: r.body };
    if (r.status === 200) {
      const items = r.body?.results || r.body?.data || r.body?.campaigns || (Array.isArray(r.body) ? r.body : []);
      const total_spent = items.reduce((s, d) => s + (d.total_amount || d.totalSpend || d.spend || d.cost || 0), 0);
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ total_spent, available: true, debug }),
      };
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent: 0, available: false, debug }),
  };
};
