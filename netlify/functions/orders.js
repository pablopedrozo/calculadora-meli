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

async function getShipmentCost(shipmentId, token) {
  try {
    const d = await apiGet(`/shipments/${shipmentId}`, token);
    // option_cost = lo que paga el vendedor realmente (0 si está incluido en sale_fee)
    // base_cost = precio de lista, NO lo que paga el vendedor
    const cost = d.shipping_option?.cost ?? d.shipping_option?.list_cost ?? 0;
    return cost;
  } catch (e) { return 0; }
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
      const shipmentId = order.shipping?.id;

      // sale_fee = total de lo que cobra MeLi (comisión + envío + IIBB + cuotas, todo bundleado)
      // Es el campo más confiable disponible para esta cuenta
      const sale_fee_total = items.reduce((s, i) => s + Math.abs(i.sale_fee || 0), 0);

      // Shipping: option_cost es lo que paga el vendedor por envío SEPARADO de sale_fee
      // Si es 0 = el envío ya está incluido en sale_fee (no se suma dos veces)
      const shipping_cost = shipmentId ? await getShipmentCost(shipmentId, token) : 0;

      // Datos de pago disponibles directamente en la orden (sin llamar /payments/{id})
      const transaction_amount = payment?.transaction_amount || order.total_amount || 0;
      const net_received = payment?.net_received_amount || 0;
      const installments = payment?.installments || 1;

      // Debug solo para la primera orden
      const debug = idx === 0 ? {
        sale_fee_total,
        shipping_from_shipment: shipping_cost,
        transaction_amount,
        net_received,
        installments,
        payment_fields: payment ? Object.keys(payment) : [],
        payment_status: payment?.status,
        payment_type: payment?.payment_type,
        payment_method: payment?.payment_method_id,
      } : undefined;

      return {
        id: order.id,
        date: order.date_created,
        status: order.status,
        total_amount: order.total_amount || 0,
        // commission = sale_fee total: incluye comisión MeLi + envío (si aplica) + financiación cuotas
        commission: sale_fee_total,
        // shipping_cost = costo envío cobrado APARTE de sale_fee (0 para Mercado Envíos Full/gratis)
        shipping_cost,
        shipment_id: shipmentId || null,
        payment_method: payment?.payment_method_id || null,
        installments,
        iibb_real: 0, // fee_details no disponible para esta cuenta — usar % configurado
        net_received,
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
