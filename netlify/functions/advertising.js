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

  try {
    // Get advertiser_id using correct product_id=PADS
    const adv = await apiGet(`/advertising/advertisers?user_id=${user_id}&product_id=PADS`, token);
    if (adv.status !== 200) {
      return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, error: adv.body }) };
    }

    const advertiser_id = adv.body?.advertisers?.[0]?.advertiser_id;
    if (!advertiser_id) {
      return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, error: "no advertiser_id" }) };
    }

    // Try both report endpoints
    const [rep1, rep2] = await Promise.all([
      apiGet(`/advertising/product_ads/advertisers/${advertiser_id}/reports/daily_performance?date_from=${from}&date_to=${to}`, token),
      apiGet(`/advertising/advertisers/${advertiser_id}/reports/daily_performance?date_from=${from}&date_to=${to}&product_id=PADS`, token),
    ]);

    const report = rep1.status === 200 ? rep1.body : rep2.status === 200 ? rep2.body : null;
    const days = report?.daily_performance || [];
    const total_spent = days.reduce((s, d) => s + (d.total_amount || 0), 0);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_spent, available: true, advertiser_id, days }),
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, error: e.message }) };
  }
};
