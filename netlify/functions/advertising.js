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

  const debug = {};

  try {
    // Step 1: get available advertising products
    const products = await apiGet(`/advertising/products`, token);
    debug.products = { status: products.status, body: products.body };

    // Common product IDs to try for Argentina
    const productIds = ["PRODUCT_ADS", "product_ads", "1", "2", "3"];

    // If products endpoint worked, extract real IDs
    if (products.status === 200) {
      const list = products.body;
      if (Array.isArray(list)) list.forEach(p => { if (p.id) productIds.unshift(String(p.id)); });
      else if (list?.results) list.results.forEach(p => { if (p.id) productIds.unshift(String(p.id)); });
    }

    // Step 2: try each product_id
    let advertiser_id = null;
    for (const pid of [...new Set(productIds)]) {
      const r = await apiGet(`/advertising/advertisers?user_id=${user_id}&product_id=${pid}`, token);
      debug[`advertisers_product_${pid}`] = { status: r.status, body: r.body };
      if (r.status === 200) {
        const body = r.body;
        advertiser_id = body?.id || body?.advertiser_id ||
          (Array.isArray(body) ? body[0]?.id : null) ||
          body?.results?.[0]?.id;
        if (advertiser_id) { debug.found_with_product_id = pid; break; }
      }
    }

    if (!advertiser_id) {
      return {
        statusCode: 200,
        body: JSON.stringify({ total_spent: 0, available: false, debug }),
      };
    }

    // Step 3: get spending report
    const rep = await apiGet(
      `/advertising/product_ads/advertisers/${advertiser_id}/reports/daily_performance?date_from=${from}&date_to=${to}`,
      token
    );
    debug.report = { status: rep.status, body: rep.body };

    // Also try generic report endpoint
    if (rep.status !== 200) {
      const rep2 = await apiGet(
        `/advertising/advertisers/${advertiser_id}/reports/daily_performance?date_from=${from}&date_to=${to}`,
        token
      );
      debug.report2 = { status: rep2.status, body: rep2.body };
    }

    const reportBody = rep.status === 200 ? rep.body : null;
    const days = reportBody?.daily_performance || [];
    const total_spent = days.reduce((s, d) => s + (d.total_amount || 0), 0);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total_spent, available: total_spent > 0, advertiser_id, debug }),
    };
  } catch (e) {
    debug.exception = e.message;
    return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, debug }) };
  }
};
