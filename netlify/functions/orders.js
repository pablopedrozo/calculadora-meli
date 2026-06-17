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

async function getShippingCost(shipmentId, token) {
  try {
    const data = await apiGet(`/shipments/${shipmentId}`, token);
    return data.shipping_option?.cost || data.base_cost || 0;
  } catch (e) {
    return 0;
  }
}

exports.handler = async (event) => {
  const { token, user_id, from, to, offset = "0" } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  try {
    const path = `/orders/search?seller=${user_id}&order.date_created.from=${from}T00:00:00.000-03:00&order.date_created.to=${to}T23:59:59.000-03:00&limit=50&offset=${offset}&sort=date_desc`;
    const data = await apiGet(path, token);
    const orders = data.results || [];

    // Fetch shipping costs in parallel (max 10 at a time to avoid timeout)
    const enriched = await Promise.all(orders.map(async (order) => {
      // Commission: sum of sale_fee from items (most accurate)
      let commission = 0;
      const items = order.order_items || [];
      if (items.length > 0) {
        commission = items.reduce((s, i) => s + Math.abs(i.sale_fee || 0), 0);
      }
      if (!commission) commission = Math.abs(order.marketplace_fee || 0);

      // Shipping cost
      let shippingCost = 0;
      const shipmentId = order.shipping?.id;
      if (shipmentId) {
        shippingCost = await getShippingCost(shipmentId, token);
      }

      // Payment info
      const payment = order.payments?.[0];

      return {
        id: order.id,
        date: order.date_created,
        status: order.status,
        total_amount: order.total_amount || 0,
        commission,
        shipping_cost: shippingCost,
        shipment_id: shipmentId || null,
        payment_method: payment?.payment_method_id || null,
        installments: payment?.installments || 1,
        items: items.map(i => ({
          title: i.item?.title || "—",
          item_id: i.item?.id || null,
          quantity: i.quantity || 1,
          unit_price: i.unit_price || 0,
          sale_fee: Math.abs(i.sale_fee || 0),
        })),
      };
    }));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: enriched, paging: data.paging }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message, results: [] }) };
  }
};
