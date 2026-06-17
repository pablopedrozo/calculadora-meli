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

  const paths = [
    ["GET", `/advertising/product_ads/${ADV_ID}/campaigns`],
    ["GET", `/pads/advertisers/${ADV_ID}/campaigns`],
    ["GET", `/pads/advertisers/${ADV_ID}/reports?date_from=${from}&date_to=${to}`],
    ["GET", `/advertising/product_ads/campaigns/${ADV_ID}`],
    ["GET", `/advertising/product_ads/advertisers/${ADV_ID}/campaigns/search`],
    ["POST", `/advertising/product_ads/advertisers/${ADV_ID}/campaigns/search`, { date_from: from, date_to: to }],
    ["GET", `/advertising/product_ads/advertisers/${ADV_ID}/summary?date_from=${from}&date_to=${to}`],
    ["GET", `/users/${user_id}/advertising/product_ads?date_from=${from}&date_to=${to}`],
    ["GET", `/billing/debts/users/${user_id}?category=advertising`],
    ["GET", `/users/${user_id}/payments?category=advertising&date_from=${from}&date_to=${to}`],
  ];

  for (const [method, path, body] of paths) {
    const r = await apiRequest(path, token, method, body || null);
    debug[`${method} ${path}`] = r.status === 404 ? 404 : { status: r.status, body: r.body };
  }

  const working = Object.entries(debug).find(([, v]) => v !== 404 && v.status === 200);
  if (!working) {
    return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, debug }) };
  }

  return { statusCode: 200, body: JSON.stringify({ total_spent: 0, available: false, working: working[0], data: working[1].body, debug }) };
};
