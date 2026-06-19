const https = require("https");

const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;

function exchange(shop, code) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code });
    const options = {
      hostname: shop,
      path: "/admin/oauth/access_token",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Accept: "application/json" },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => { let b = null; try { b = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: b, raw }); });
    });
    req.on("error", () => resolve({ status: 0, body: null }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, body: null }); });
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const { shop, code } = event.queryStringParameters || {};
  if (!shop || !code) return { statusCode: 400, body: JSON.stringify({ error: "Faltan shop o code" }) };
  // Validar que el shop sea un dominio myshopify
  if (!/^[a-z0-9-]+\.myshopify\.com$/i.test(shop)) return { statusCode: 400, body: JSON.stringify({ error: "shop inválido" }) };

  try {
    const r = await exchange(shop, code);
    if (r.status !== 200 || !r.body?.access_token) {
      return { statusCode: r.status || 400, body: JSON.stringify({ error: r.body?.error_description || r.body?.error || ("HTTP " + r.status) }) };
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: r.body.access_token, scope: r.body.scope, shop }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
