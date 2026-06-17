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

    // Enrich orders with fee details
    const results = (data.results || []).map(order => {
      // Get commission from fee_details or marketplace_fee
      let commission = 0;
      if (order.fee_details && order.fee_details.length > 0) {
        commission = order.fee_details.reduce((sum, fee) => sum + Math.abs(fee.amount || 0), 0);
      } else {
        commission = Math.abs(order.marketplace_fee || 0);
      }

      // Shipping cost
      let shippingCost = 0;
      if (order.shipping && order.shipping.cost) {
        shippingCost = order.shipping.cost;
      }

      // Payment info
      const payment = order.payments && order.payments[0];
      const paymentMethod = payment ? payment.payment_method_id : null;
      const installments = payment ? (payment.installments || 1) : 1;

      return {
        id: order.id,
        date: order.date_created,
        status: order.status,
        total_amount: order.total_amount || 0,
        commission,
        shipping_id: order.shipping ? order.shipping.id : null,
        shipping_cost: shippingCost,
        payment_method: paymentMethod,
        installments,
        items: (order.order_items || []).map(i => ({
          title: i.item ? i.item.title : "—",
          item_id: i.item ? i.item.id : null,
          quantity: i.quantity || 1,
          unit_price: i.unit_price || 0,
          sale_fee: i.sale_fee || 0,
        })),
      };
    });

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results, paging: data.paging }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message, results: [] }) };
  }
};
