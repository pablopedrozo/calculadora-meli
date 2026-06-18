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

async function getShipmentData(shipmentId, token) {
  try {
    const d = await apiGet(`/shipments/${shipmentId}`, token);
    // base_cost = lo que paga el vendedor por el envío (independiente de si es gratis para el comprador)
    // list_cost = precio de lista sin descuentos
    // cost = costo final
    const sellerCost = d.base_cost || d.shipping_option?.list_cost || d.shipping_option?.cost || 0;
    return { cost: sellerCost, free_shipping: d.order_cost === 0 || sellerCost === 0 };
  } catch (e) { return { cost: 0 }; }
}

async function getPaymentDetails(paymentId, token) {
  try {
    const d = await apiGet(`/payments/${paymentId}`, token);
    const fees = d.fee_details || [];

    let iibb = 0;
    let financing = 0;

    for (const f of fees) {
      const t = (f.type || "").toLowerCase();
      const amt = Math.abs(f.amount || 0);
      // IIBB y retenciones impositivas
      if (t.includes("iibb") || t.includes("withhold") || t.includes("retencion") ||
          t.includes("retention") || t.includes("percep") || t === "tax" ||
          t.includes("ingresos_brutos") || t.includes("igj")) {
        iibb += amt;
      }
      // Cuotas sin interés - el vendedor absorbe el costo financiero
      if (t.includes("financing") || t.includes("cuota") || t.includes("installment") || t.includes("credit")) {
        financing += amt;
      }
    }

    return {
      iibb,
      financing,
      net_received: d.net_received_amount || 0,
      transaction_amount: d.transaction_amount || 0,
      installments: d.installments || 1,
      fee_details: fees,
    };
  } catch (e) {
    return { iibb: 0, financing: 0, net_received: 0, transaction_amount: 0, installments: 1, fee_details: [] };
  }
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

      // Comisión real por ítem (sale_fee ya incluye la comisión de MeLi según tipo de publicación)
      let commission = 0;
      if (items.length > 0) {
        commission = items.reduce((s, i) => s + Math.abs(i.sale_fee || 0), 0);
      }
      if (!commission) commission = Math.abs(order.marketplace_fee || 0);

      const payment = order.payments?.[0];
      const paymentId = payment?.id;
      const shipmentId = order.shipping?.id;

      const [shipment, paymentDetails] = await Promise.all([
        shipmentId ? getShipmentData(shipmentId, token) : Promise.resolve({ cost: 0 }),
        paymentId ? getPaymentDetails(paymentId, token) : Promise.resolve({ iibb: 0, financing: 0, net_received: 0, transaction_amount: 0, installments: 1, fee_details: [] }),
      ]);

      // Si hay cuotas sin interés, el costo financiero se suma a la comisión real
      const commissionTotal = commission + paymentDetails.financing;

      return {
        id: order.id,
        date: order.date_created,
        status: order.status,
        total_amount: order.total_amount || 0,
        commission: commissionTotal,
        shipping_cost: shipment.cost,
        shipment_id: shipmentId || null,
        payment_method: payment?.payment_method_id || null,
        installments: paymentDetails.installments || payment?.installments || 1,
        iibb_real: paymentDetails.iibb,
        net_received: paymentDetails.net_received,
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
