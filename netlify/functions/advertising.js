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
    // Get advertiser_id
    const adv = await apiGet(`/advertising/advertisers?user_id=${user_id}&product_id=PADS`, token);
    if (adv.status !== 200) {
      return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, error: adv.body }) };
    }
    const advertiser_id = adv.body?.advertisers?.[0]?.advertiser_id;
    if (!advertiser_id) {
      return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, error: "no advertiser_id" }) };
    }

    // Try all report endpoint variants
    const reportPaths = [
      `/advertising/product_ads/advertisers/${advertiser_id}/reports/daily_performance?date_from=${from}&date_to=${to}`,
      `/advertising/advertisers/${advertiser_id}/reports/daily_performance?date_from=${from}&date_to=${to}&product_id=PADS`,
      `/advertising/advertisers/${advertiser_id}/reports/daily_performance?date_from=${from}&date_to=${to}`,
      `/advertising/product_ads/advertisers/${advertiser_id}/report?date_from=${from}&date_to=${to}`,
      `/advertising/advertisers/${advertiser_id}/reports?date_from=${from}&date_to=${to}&product_id=PADS&type=daily_performance`,
      `/advertising/advertisers/${advertiser_id}/campaigns?date_from=${from}&date_to=${to}&product_id=PADS`,
      `/advertising/advertisers/${advertiser_id}?product_id=PADS`,
    ];

    const reportDebug = {};
    let total_spent = 0;
    let found = false;

    for (const path of reportPaths) {
      const r = await apiGet(path, token);
      reportDebug[path] = { status: r.status, body: r.body };
      if (r.status === 200 && !found) {
        const body = r.body;
        const days = body?.daily_performance || body?.results || body?.data || [];
        const spent = Array.isArray(days) ? days.reduce((s, d) => s + (d.total_amount || d.spend || d.cost || 0), 0) : 0;
        if (spent > 0) { total_spent = spent; found = true; }
      }
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_spent, available: found, advertiser_id, debug: reportDebug }),
    };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, error: e.message }) };
  }
};
