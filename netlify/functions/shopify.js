const https = require("https");

function shopifyGet(shop, path, token) {
  return new Promise((resolve) => {
    const options = {
      hostname: shop,
      path,
      method: "GET",
      headers: { "X-Shopify-Access-Token": token, Accept: "application/json" },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => { let b = null; try { b = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: b }); });
    });
    req.on("error", () => resolve({ status: 0, body: null }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, body: null }); });
    req.end();
  });
}

const VER = "2024-07";

exports.handler = async (event) => {
  const { shop, token, action, from, to } = event.queryStringParameters || {};
  if (!shop || !token) return { statusCode: 400, body: JSON.stringify({ error: "Faltan shop o token" }) };
  const json = (code, obj) => ({ statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });

  try {
    // Test de conexión: valida el token y devuelve el nombre de la tienda
    if (action === "test") {
      const r = await shopifyGet(shop, `/admin/api/${VER}/shop.json`, token);
      if (r.status !== 200) return json(r.status || 400, { error: (r.body && (r.body.errors || r.body.error)) || ("HTTP " + r.status) });
      return json(200, { name: r.body?.shop?.name || shop, ok: true });
    }

    // Pedidos del período
    const path = `/admin/api/${VER}/orders.json?status=any&created_at_min=${from}T00:00:00-03:00&created_at_max=${to}T23:59:59-03:00&limit=250`;
    const r = await shopifyGet(shop, path, token);
    if (r.status !== 200) return json(r.status || 400, { error: (r.body && (r.body.errors || r.body.error)) || ("HTTP " + r.status), results: [] });

    const orders = (r.body?.orders || []).map((o) => ({
      id: o.id,
      name: o.name,
      date: o.created_at,
      total: parseFloat(o.total_price || 0),
      currency: o.currency,
      financial_status: o.financial_status,
      gateway: (o.payment_gateway_names || []).join(","),
      shipping: parseFloat(o.total_shipping_price_set?.shop_money?.amount || 0),
      discounts: parseFloat(o.total_discounts || 0),
      order_ref: String(o.id),
      items: (o.line_items || []).map((li) => ({
        title: li.title, qty: li.quantity, price: parseFloat(li.price || 0),
        sku: li.sku || null, product_id: li.product_id || null,
      })),
    }));
    return json(200, { results: orders });
  } catch (e) {
    return json(500, { error: e.message, results: [] });
  }
};
