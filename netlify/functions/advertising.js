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

  // Try every possible MeLi advertising endpoint for Argentina
  const paths = [
    `/advertising/product_ads/advertisers/${user_id}`,
    `/advertising/product_ads/advertisers`,
    `/advertising/product_ads/advertisers?user_id=${user_id}&site_id=MLA`,
    `/sites/MLA/advertising/product_ads/advertisers/${user_id}`,
    `/sites/MLA/advertising/advertisers/${user_id}`,
    `/advertising/advertisers/${user_id}`,
    `/advertising/advertisers?user_id=${user_id}`,
    `/advertising/${user_id}`,
    `/users/${user_id}/advertising`,
    `/users/${user_id}/advertising/campaigns`,
  ];

  const results = {};
  for (const p of paths) {
    const r = await apiGet(p, token);
    results[p] = { status: r.status, body: r.status !== 404 ? r.body : "404" };
  }

  // Find first working endpoint
  const working = Object.entries(results).find(([, v]) => v.status === 200);

  if (!working) {
    return {
      statusCode: 200,
      body: JSON.stringify({ total_spent: 0, available: false, debug: results }),
    };
  }

  // Try to get spending from working endpoint
  const [workingPath, workingData] = working;
  const advId = workingData.body?.id || workingData.body?.advertiser_id || user_id;

  const rep = await apiGet(
    `/advertising/product_ads/advertisers/${advId}/reports/daily_performance?date_from=${from}&date_to=${to}`,
    token
  );

  const days = rep.body?.daily_performance || [];
  const total_spent = days.reduce((s, d) => s + (d.total_amount || 0), 0);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent, available: total_spent > 0, working_endpoint: workingPath, debug: results }),
  };
};
