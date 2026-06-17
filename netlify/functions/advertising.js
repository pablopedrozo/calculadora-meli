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
  const debug = {};

  // Try POST to campaigns endpoint
  const postBody = { advertiser_id: ADV_ID, date_from: from, date_to: to };
  const postAttempts = await Promise.all([
    apiRequest(`/advertising/product_ads/campaigns`, token, "POST", postBody),
    apiRequest(`/advertising/product_ads/campaigns?advertiser_id=${ADV_ID}`, token, "POST", { date_from: from, date_to: to }),
    apiRequest(`/advertising/product_ads/advertisers/${ADV_ID}/campaigns`, token, "POST", { date_from: from, date_to: to }),
    apiRequest(`/advertising/product_ads/advertisers/${ADV_ID}/campaigns`, token, "GET"),
    apiRequest(`/advertising/product_ads/advertisers/${ADV_ID}/ads`, token, "GET"),
    apiRequest(`/advertising/product_ads/advertisers/${ADV_ID}/reports`, token, "GET"),
    apiRequest(`/advertising/product_ads/advertisers/${ADV_ID}/reports`, token, "POST", { date_from: from, date_to: to }),
  ]);

  const labels = ["POST /campaigns (body adv_id)", "POST /campaigns?adv_id", "POST /advertisers/{id}/campaigns", "GET /advertisers/{id}/campaigns", "GET /advertisers/{id}/ads", "GET /advertisers/{id}/reports", "POST /advertisers/{id}/reports"];
  postAttempts.forEach((r, i) => { debug[labels[i]] = { status: r.status, body: r.body }; });

  // Find working endpoint
  const working = postAttempts.find(r => r.status === 200);
  if (!working) {
    return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, debug }) };
  }

  const campaigns = working.body?.results || working.body?.campaigns || working.body?.data || [];
  const total_spent = campaigns.reduce((s, c) => s + (c.total_amount || c.spend || c.cost || 0), 0);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent, available: total_spent > 0, campaigns_found: campaigns.length, debug }),
  };
};
