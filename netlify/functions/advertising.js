const https = require("https");

function apiRequest(baseUrl, path, token, method = "GET", body = null) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${baseUrl}${path}`);
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
        try { resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, headers: res.headers, body: raw }); }
      });
    });
    req.on("error", reject);
    if (postBody) req.write(postBody);
    req.end();
  });
}

const ML = "https://api.mercadolibre.com";
const MP = "https://api.mercadopago.com";

exports.handler = async (event) => {
  const { token, user_id, from, to } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  const debug = {};

  // OPTIONS on the 405 endpoint to see what methods are allowed
  const opt = await apiRequest(ML, `/advertising/product_ads/campaigns`, token, "OPTIONS");
  debug["OPTIONS /advertising/product_ads/campaigns"] = { status: opt.status, allow: opt.headers?.allow, body: opt.body };

  // Try Mercado Pago API - same token works for both MeLi and MP in Argentina
  const mpPaths = [
    `/v1/account/movements?date_from=${from}T00:00:00.000-03:00&date_to=${to}T23:59:59.000-03:00`,
    `/v1/account/settlement-report/list`,
    `/v1/account/charges`,
    `/v1/users/${user_id}/account`,
    `/v1/account/balance`,
  ];

  for (const p of mpPaths) {
    const r = await apiRequest(MP, p, token);
    debug[`MP ${p}`] = r.status === 404 ? 404 : { status: r.status, body: r.body };
  }

  // MeLi seller movements
  const mlPaths = [
    `/users/${user_id}/mercadopago_account/movements?date_from=${from}&date_to=${to}`,
    `/users/${user_id}/mercadopago_account`,
    `/users/${user_id}/charges?date_from=${from}&date_to=${to}`,
  ];

  for (const p of mlPaths) {
    const r = await apiRequest(ML, p, token);
    debug[`ML ${p}`] = r.status === 404 ? 404 : { status: r.status, body: r.body };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent: 0, available: false, debug }),
  };
};
