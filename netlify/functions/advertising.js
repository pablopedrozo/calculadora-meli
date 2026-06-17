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
      res.on("end", () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const { token, user_id, from, to } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  try {
    // Get advertiser account
    const advertiser = await apiGet(`/advertising/product_ads/advertisers/${user_id}`, token);
    if (!advertiser || advertiser.error) {
      return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false }) };
    }

    // Get daily performance report
    const report = await apiGet(
      `/advertising/product_ads/advertisers/${user_id}/reports/daily_performance?date_from=${from}&date_to=${to}`,
      token
    );

    const total_spent = (report.daily_performance || []).reduce((s, d) => s + (d.total_amount || 0), 0);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_spent, available: true, days: report.daily_performance || [] }),
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, error: e.message }) };
  }
};
