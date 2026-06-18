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
  const { token, user_id, from, to, offset = "0" } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  try {
    const path = `/orders/search?seller=${user_id}&order.date_created.from=${from}T00:00:00.000-03:00&order.date_created.to=${to}T23:59:59.000-03:00&limit=50&offset=${offset}&sort=date_desc`;
    const data = await apiGet(path, token);
    const orders = data.results || [];

    const enriched = orders.map((order) => {
      const items = order.order_items || [];
      const payment = order.payments?.[0];

      // sale_fee = total real que cobra MeLi por orden (comisión + envío gratis + IIBB + cuotas sin interés)
      // Es el único campo confiable — MeLi no expone el desglose via API pública para esta cuenta
      const commission = items.reduce((s, i) => s + Math.abs(i.sale_fee || 0), 0);

      return {
        id: order.id,
        date: order.date_created,
        status: order.status,
        total_amount: order.total_amount || 0,
        commission,
        shipping_cost: 0, // incluido en commission (sale_fee)
        shipment_id: order.shipping?.id || null,
        payment_method: payment?.payment_method_id || null,
        installments: payment?.installments || 1,
        iibb_real: 0, // incluido en commission (sale_fee)
        items: items.map(i => ({
          title: i.item?.title || "—",
          item_id: i.item?.id || null,
          quantity: i.quantity || 1,
          unit_price: i.unit_price || 0,
          sale_fee: Math.abs(i.sale_fee || 0),
        })),
      };
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: enriched, paging: data.paging }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message, results: [] }) };
  }
};
