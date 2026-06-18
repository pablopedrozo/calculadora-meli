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

// Categorize fee_details from a payment into commission, shipping, iibb, financing
function parseFeeDetails(fees) {
  let commission = 0, shipping = 0, iibb = 0, financing = 0;
  for (const f of fees) {
    const t = (f.type || "").toLowerCase();
    const amt = Math.abs(f.amount || 0);
    if (
      t.includes("mercadopago_fee") || t.includes("marketplace_fee") ||
      t.includes("commission") || t === "fee" || t.includes("sale_fee")
    ) { commission += amt; }
    else if (t.includes("shipping") || t.includes("envio") || t.includes("flete")) {
      shipping += amt;
    } else if (
      t.includes("iibb") || t.includes("ingresos_brutos") || t.includes("igj") ||
      t.includes("withhold") || t.includes("retencion") || t.includes("retention") ||
      t.includes("percep") || t.includes("tax")
    ) { iibb += amt; }
    else if (
      t.includes("financing") || t.includes("cuota") ||
      t.includes("installment") || t.includes("credit")
    ) { financing += amt; }
  }
  return { commission, shipping, iibb, financing };
}

async function getPaymentDetails(paymentId, token) {
  try {
    const d = await apiGet(`/payments/${paymentId}`, token);
    const fees = d.fee_details || [];
    const parsed = parseFeeDetails(fees);
    return {
      ...parsed,
      net_received: d.net_received_amount || 0,
      transaction_amount: d.transaction_amount || 0,
      installments: d.installments || 1,
      fee_details: fees,
    };
  } catch (e) {
    return { commission: 0, shipping: 0, iibb: 0, financing: 0, net_received: 0, transaction_amount: 0, installments: 1, fee_details: [] };
  }
}

async function getShipmentCost(shipmentId, token) {
  try {
    const d = await apiGet(`/shipments/${shipmentId}`, token);
    // shipping_option.cost = what the seller actually pays (after MeLi subsidies)
    // base_cost = list price before any discounts
    return d.shipping_option?.cost || d.base_cost || 0;
  } catch (e) { return 0; }
}

exports.handler = async (event) => {
  const { token, user_id, from, to, offset = "0" } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  try {
    const path = `/orders/search?seller=${user_id}&order.date_created.from=${from}T00:00:00.000-03:00&order.date_created.to=${to}T23:59:59.000-03:00&limit=50&offset=${offset}&sort=date_desc`;
    const data = await apiGet(path, token);
    const orders = data.results || [];

    const enriched = await Promise.all(orders.map(async (order) => {
      const items = order.order_items || [];
      const payment = order.payments?.[0];
      const paymentId = payment?.id;
      const shipmentId = order.shipping?.id;

      const [paymentDetails, shipmentCostFallback] = await Promise.all([
        paymentId ? getPaymentDetails(paymentId, token) : Promise.resolve({ commission: 0, shipping: 0, iibb: 0, financing: 0, net_received: 0, transaction_amount: 0, installments: 1, fee_details: [] }),
        shipmentId ? getShipmentCost(shipmentId, token) : Promise.resolve(0),
      ]);

      // Commission: prefer fee_details breakdown, fallback to marketplace_fee (NOT sale_fee which includes everything)
      const commission = paymentDetails.commission || Math.abs(order.marketplace_fee || 0);

      // Financing (cuotas sin interés) — seller absorbs this cost
      const financing = paymentDetails.financing;

      // Shipping: prefer fee_details (exact seller cost), fallback to shipments API
      const shipping_cost = paymentDetails.shipping || shipmentCostFallback;

      // IIBB: real from payment fee_details
      const iibb_real = paymentDetails.iibb;

      return {
        id: order.id,
        date: order.date_created,
        status: order.status,
        total_amount: order.total_amount || 0,
        // commission here is pure MeLi fee (NOT including shipping or IIBB)
        commission: commission + financing,
        shipping_cost,
        shipment_id: shipmentId || null,
        payment_method: payment?.payment_method_id || null,
        installments: paymentDetails.installments || payment?.installments || 1,
        iibb_real,
        net_received: paymentDetails.net_received,
        // debug info
        marketplace_fee: Math.abs(order.marketplace_fee || 0),
        fee_details: paymentDetails.fee_details,
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
