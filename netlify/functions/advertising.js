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

  // POST attempts to campaigns/metrics with different body structures
  const postBodies = [
    { advertiserId: ADV_ID, dateFrom: from, dateTo: to },
    { advertiserId: String(ADV_ID), dateFrom: from, dateTo: to },
    { advertiser_id: ADV_ID, dateFrom: from, dateTo: to },
    { advertiserId: ADV_ID, date_from: from, date_to: to },
    { advertiserId: ADV_ID, from, to },
    { advertiserId: ADV_ID, dateFrom: from, dateTo: to, product_id: "PADS" },
  ];

  for (const body of postBodies) {
    const key = JSON.stringify(body);
    const r = await apiRequest(`/advertising/product_ads/campaigns/metrics`, token, "POST", body);
    debug[key] = { status: r.status, body: r.body };
    if (r.status === 200) break;
  }

  // Also try GET with advertiserId as int (no quotes) via query string
  const getAttempts = [
    `/advertising/product_ads/campaigns/metrics?advertiserId=${ADV_ID}&dateFrom=${from}&dateTo=${to}&product_id=PADS`,
    `/advertising/product_ads/campaigns/metrics?advertiser_id=${ADV_ID}&dateFrom=${from}&dateTo=${to}`,
  ];
  for (const p of getAttempts) {
    const r = await apiRequest(p, token);
    debug[`GET ${p}`] = r.status === 404 ? 404 : { status: r.status, body: r.body };
  }

  const working = Object.entries(debug).find(([, v]) => v.status === 200);
  if (working) {
    const body = working[1].body;
    const days = body?.daily_performance || body?.results || body?.data || body?.metrics || [];
    const total_spent = Array.isArray(days)
      ? days.reduce((s, d) => s + (d.total_amount || d.spend || d.cost || d.totalSpend || 0), 0)
      : (body?.totalSpend || body?.total_spend || body?.spend || 0);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_spent, available: true, FOUND: working[0], data: body }),
    };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent: 0, available: false, debug }),
  };
};
