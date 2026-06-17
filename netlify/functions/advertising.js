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
        catch (e) { reject(e); }
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

  try {
    // Step 1: check advertiser account
    const adv = await apiGet(`/advertising/product_ads/advertisers/${user_id}`, token);
    debug.advertiser_status = adv.status;
    debug.advertiser_body = adv.body;

    if (adv.status !== 200 || adv.body?.error) {
      return {
        statusCode: 200,
        body: JSON.stringify({ total_spent: 0, available: false, debug }),
      };
    }

    // Step 2: daily performance report
    const rep = await apiGet(
      `/advertising/product_ads/advertisers/${user_id}/reports/daily_performance?date_from=${from}&date_to=${to}`,
      token
    );
    debug.report_status = rep.status;
    debug.report_body = rep.body;

    const days = rep.body?.daily_performance || [];
    const total_spent = days.reduce((s, d) => s + (d.total_amount || 0), 0);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_spent, available: true, days, debug }),
    };
  } catch (e) {
    debug.exception = e.message;
    return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, debug }) };
  }
};
