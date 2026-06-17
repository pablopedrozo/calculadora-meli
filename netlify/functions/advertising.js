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
    // Step 1: list advertisers for this user to get the real advertiser_id
    const list = await apiGet(`/advertising/product_ads/advertisers?user_id=${user_id}`, token);
    debug.list_status = list.status;
    debug.list_body = list.body;

    let advertiser_id = null;
    if (list.status === 200 && Array.isArray(list.body)) {
      advertiser_id = list.body[0]?.id || list.body[0]?.advertiser_id || null;
    } else if (list.status === 200 && list.body?.advertisers) {
      advertiser_id = list.body.advertisers[0]?.id || null;
    } else if (list.status === 200 && list.body?.id) {
      advertiser_id = list.body.id;
    }

    debug.advertiser_id_found = advertiser_id;

    // If no advertiser found via list, try direct with user_id as fallback
    if (!advertiser_id) {
      // Try user_id directly as advertiser_id (some accounts match)
      const direct = await apiGet(`/advertising/product_ads/advertisers/${user_id}`, token);
      debug.direct_status = direct.status;
      debug.direct_body = direct.body;
      if (direct.status === 200 && !direct.body?.error) {
        advertiser_id = direct.body?.id || user_id;
      }
    }

    if (!advertiser_id) {
      return {
        statusCode: 200,
        body: JSON.stringify({ total_spent: 0, available: false, reason: "no_advertiser", debug }),
      };
    }

    // Step 2: daily performance report using real advertiser_id
    const rep = await apiGet(
      `/advertising/product_ads/advertisers/${advertiser_id}/reports/daily_performance?date_from=${from}&date_to=${to}`,
      token
    );
    debug.report_status = rep.status;
    debug.report_body = rep.body;

    const days = rep.body?.daily_performance || [];
    const total_spent = days.reduce((s, d) => s + (d.total_amount || 0), 0);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_spent, available: total_spent > 0, days, debug }),
    };
  } catch (e) {
    debug.exception = e.message;
    return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, debug }) };
  }
};
