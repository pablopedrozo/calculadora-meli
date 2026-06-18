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
  } catch (e) { return 0; }
}

async function getPaymentFees(paymentId, token) {
  try {
    const data = await apiGet(`/payments/${paymentId}`, token);
    const fees = data.fee_details || [];
    // Look for IIBB / tax withholdings in fee details
    let iibb = 0;
    for (const f of fees) {
      const t = (f.type || "").toLowerCase();
      if (t.includes("iibb") || t.includes("tax") || t.includes("retencion") || t.includes("retention") || t.includes("withholding")) {
        iibb += Math.abs(f.amount || 0);
      }
    }
    return { iibb, fee_details: fees };
  } catch (e) { return { iibb: 0, fee_details: [] }; }
}

exports.handler = async (event) => {
  const { token, user_id, from, to, offset = "0" } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  try {
    const path = `/orders/search?seller=${user_id}&order.date_created.from=${from}T00:00:00.000-03:00&order.date_created.to=${to}T23:59:59.000-03:00&limit=50&offset=${offset}&sort=date_desc`;
    const data = await apiGet(path, token);
    const orders = data.results || [];

    const enriched = await Promise.all(orders.map(async (order) => {
      let commission = 0;
      const items = order.order_items || [];
      if (items.length > 0) {
        commission = items.reduce((s, i) => s + Math.abs(i.sale_fee || 0), 0);
      }
      if (!commission) commission = Math.abs(order.marketplace_fee || 0);

      const payment = order.payments?.[0];
      const paymentId = payment?.id;

      const [shippingCost, paymentFees] = await Promise.all([
        order.shipping?.id ? getShippingCost(order.shipping.id, token) : Promise.resolve(0),
        paymentId ? getPaymentFees(paymentId, token) : Promise.resolve({ iibb: 0, fee_details: [] }),
      ]);

      return {
        id: order.id,
        date: order.date_created,
        status: order.status,
        total_amount: order.total_amount || 0,
        commission,
        shipping_cost: shippingCost,
        shipment_id: order.shipping?.id || null,
        payment_method: payment?.payment_method_id || null,
        installments: payment?.installments || 1,
        iibb_real: paymentFees.iibb,
        fee_details: paymentFees.fee_details,
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
