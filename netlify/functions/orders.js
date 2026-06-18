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

async function getPaymentDetails(paymentId, token) {
  try {
    const d = await apiGet(`/payments/${paymentId}`, token);
    const fees = d.fee_details || [];

    let commission = 0, shipping = 0, iibb = 0, financing = 0;
    for (const f of fees) {
      const t = (f.type || "").toLowerCase();
      const amt = Math.abs(f.amount || 0);
      if (t.includes("mercadopago_fee") || t.includes("marketplace") || t.includes("commission") || t === "fee") {
        commission += amt;
      } else if (t.includes("shipping") || t.includes("envio") || t.includes("flete") || t.includes("logistic")) {
        shipping += amt;
      } else if (t.includes("iibb") || t.includes("ingresos") || t.includes("igj") || t.includes("withhold") || t.includes("retencion") || t.includes("tax") || t.includes("percep")) {
        iibb += amt;
      } else if (t.includes("financing") || t.includes("cuota") || t.includes("installment") || t.includes("credit")) {
        financing += amt;
      }
    }

    return {
      commission,
      shipping,
      iibb,
      financing,
      net_received: d.net_received_amount || 0,
      transaction_amount: d.transaction_amount || 0,
      installments: d.installments || 1,
      marketplace_fee_from_payment: Math.abs(d.marketplace_fee || 0),
      fee_details: fees,
    };
  } catch (e) {
    return { commission: 0, shipping: 0, iibb: 0, financing: 0, net_received: 0, transaction_amount: 0, installments: 1, marketplace_fee_from_payment: 0, fee_details: [] };
  }
}

async function getShipmentData(shipmentId, token) {
  try {
    const d = await apiGet(`/shipments/${shipmentId}`, token);
    return {
      base_cost: d.base_cost || 0,
      option_cost: d.shipping_option?.cost || 0,
      order_cost: d.order_cost || 0,
      raw: { base_cost: d.base_cost, order_cost: d.order_cost, option: d.shipping_option },
    };
  } catch (e) { return { base_cost: 0, option_cost: 0, order_cost: 0, raw: {} }; }
}

exports.handler = async (event) => {
  const { token, user_id, from, to, offset = "0" } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  try {
    const path = `/orders/search?seller=${user_id}&order.date_created.from=${from}T00:00:00.000-03:00&order.date_created.to=${to}T23:59:59.000-03:00&limit=50&offset=${offset}&sort=date_desc`;
    const data = await apiGet(path, token);
    const orders = data.results || [];

    const enriched = await Promise.all(orders.map(async (order, idx) => {
      const items = order.order_items || [];
      const payment = order.payments?.[0];
      const paymentId = payment?.id;
      const shipmentId = order.shipping?.id;

      const [paymentDetails, shipmentData] = await Promise.all([
        paymentId ? getPaymentDetails(paymentId, token) : Promise.resolve({ commission: 0, shipping: 0, iibb: 0, financing: 0, net_received: 0, transaction_amount: 0, installments: 1, marketplace_fee_from_payment: 0, fee_details: [] }),
        shipmentId ? getShipmentData(shipmentId, token) : Promise.resolve({ base_cost: 0, option_cost: 0, order_cost: 0, raw: {} }),
      ]);

      // sale_fee sum (includes everything MeLi charges per item)
      const sale_fee_total = items.reduce((s, i) => s + Math.abs(i.sale_fee || 0), 0);

      // Commission: try fee_details breakdown → payment.marketplace_fee → order.marketplace_fee → fallback
      const commission =
        paymentDetails.commission ||
        paymentDetails.marketplace_fee_from_payment ||
        Math.abs(order.marketplace_fee || 0) ||
        Math.abs(payment?.marketplace_fee || 0);

      // Shipping: try fee_details → shipping_option.cost → base_cost
      const shipping_from_fees = paymentDetails.shipping;
      const shipping_cost = shipping_from_fees || shipmentData.option_cost || shipmentData.base_cost;

      const iibb_real = paymentDetails.iibb;
      const financing = paymentDetails.financing;

      // Debug snapshot (only for first order to diagnose field names)
      const debug = idx === 0 ? {
        sale_fee_total,
        commission_from_fee_details: paymentDetails.commission,
        commission_from_payment_mp_fee: paymentDetails.marketplace_fee_from_payment,
        commission_from_order: Math.abs(order.marketplace_fee || 0),
        shipping_from_fee_details: paymentDetails.shipping,
        shipment_base_cost: shipmentData.base_cost,
        shipment_option_cost: shipmentData.option_cost,
        shipment_order_cost: shipmentData.order_cost,
        iibb: iibb_real,
        financing,
        net_received: paymentDetails.net_received,
        transaction_amount: paymentDetails.transaction_amount,
        fee_details: paymentDetails.fee_details,
      } : undefined;

      return {
        id: order.id,
        date: order.date_created,
        status: order.status,
        total_amount: order.total_amount || 0,
        commission: commission + financing,
        shipping_cost,
        shipment_id: shipmentId || null,
        payment_method: payment?.payment_method_id || null,
        installments: paymentDetails.installments || payment?.installments || 1,
        iibb_real,
        net_received: paymentDetails.net_received,
        debug,
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
