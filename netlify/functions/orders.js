const https = require("https");

function apiGet(host, path, token) {
  return new Promise((resolve) => {
    const options = {
      hostname: host,
      path,
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => { let b = null; try { b = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: b }); });
    });
    req.on("error", () => resolve({ status: 0, body: null }));
    req.setTimeout(9000, () => { req.destroy(); resolve({ status: 0, body: null }); });
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseCharges(d) {
  let commission = 0, financing = 0, iibb = 0, shipping = 0;
  for (const c of d.charges_details || []) {
    const amt = (c.amounts?.original || 0) - (c.amounts?.refunded || 0);
    const type = (c.type || "").toLowerCase();
    const name = (c.name || "").toLowerCase();
    if (type === "shipping" || name.includes("shp") || name.includes("shipping")) shipping += amt;
    else if (type === "tax" || name.includes("iibb") || name.includes("withholding") || name.includes("ingresos_brutos") || name.includes("percep")) iibb += amt;
    else if (name.includes("financing") || name.includes("financiac") || name.includes("cuota") || name.includes("installment")) financing += amt;
    else if (type === "fee") commission += amt;
  }
  return { commission, financing, iibb, shipping, net: d.transaction_details?.net_received_amount || 0 };
}

// Desglose REAL desde MercadoPago, con reintentos ante rate limit (429) / errores de red
async function getPaymentBreakdown(paymentId, token) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await apiGet("api.mercadopago.com", `/v1/payments/${paymentId}`, token);
    if (r.status === 200 && r.body && Array.isArray(r.body.charges_details)) {
      return parseCharges(r.body);
    }
    // 200 sin charges_details = no hay desglose real (no reintentar)
    if (r.status === 200) return null;
    // 429 / 5xx / red caída → esperar y reintentar
    await sleep(250 * (attempt + 1) + Math.floor(Math.random() * 200));
  }
  return null;
}

// Fallback de envío: costo real del vendedor desde /shipments/{id}/costs (senders[].cost)
async function getShipmentCost(shipmentId, token) {
  const r = await apiGet("api.mercadolibre.com", `/shipments/${shipmentId}/costs`, token);
  if (r.status === 200 && r.body) {
    const senders = r.body.senders || [];
    const cost = senders.reduce((s, x) => s + (x.cost || 0), 0);
    if (cost > 0) return cost;
  }
  // Segundo fallback: shipping_option.cost del shipment
  const r2 = await apiGet("api.mercadolibre.com", `/shipments/${shipmentId}`, token);
  if (r2.status === 200 && r2.body) return r2.body.shipping_option?.cost || 0;
  return 0;
}

exports.handler = async (event) => {
  const { token, user_id, from, to, offset = "0" } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  try {
    const path = `/orders/search?seller=${user_id}&order.date_created.from=${from}T00:00:00.000-03:00&order.date_created.to=${to}T23:59:59.000-03:00&limit=50&offset=${offset}&sort=date_desc`;
    const data = await apiGet("api.mercadolibre.com", path, token);
    // Si MeLi rechaza el token, surfacear el 401 (no ocultarlo como "0 ventas")
    if (data.status === 401 || data.status === 403) {
      return { statusCode: 401, body: JSON.stringify({ error: "unauthorized", results: [] }) };
    }
    const orders = data.body?.results || [];

    const enriched = [];
    const CONCURRENCY = 8;
    const buildOrder = async (order) => {
      const items = order.order_items || [];
      const payment = order.payments?.[0];
      const paymentId = payment?.id;
      const shipmentId = order.shipping?.id;

      // sale_fee = comisión + financiación (de la orden, siempre disponible)
      const sale_fee_total = items.reduce((s, i) => s + Math.abs(i.sale_fee || 0), 0);

      const bd = paymentId ? await getPaymentBreakdown(paymentId, token) : null;

      let commission, financing, shipping_cost, iibb_real, net_received, breakdown_ok;
      if (bd) {
        // Caso ideal: todo real desde MercadoPago
        commission = bd.commission || sale_fee_total - bd.financing; // si MP no separó la comisión, usar sale_fee
        financing = bd.financing;
        shipping_cost = bd.shipping;
        iibb_real = bd.iibb;
        net_received = bd.net;
        breakdown_ok = true;
        // Si por algún motivo MP no trajo el envío, completarlo desde la API de envíos
        if (!shipping_cost && shipmentId) shipping_cost = await getShipmentCost(shipmentId, token);
      } else {
        // Fallback: comisión+financiación = sale_fee; envío real desde la API de envíos
        commission = sale_fee_total;
        financing = 0;
        shipping_cost = shipmentId ? await getShipmentCost(shipmentId, token) : 0;
        iibb_real = 0;
        net_received = 0;
        breakdown_ok = false;
      }

      return {
        id: order.id,
        date: order.date_created,
        status: order.status,
        total_amount: order.total_amount || 0,
        commission,
        financing,
        shipping_cost,
        iibb_real,
        net_received,
        shipment_id: shipmentId || null,
        payment_method: payment?.payment_method_id || null,
        installments: payment?.installments || 1,
        breakdown_ok,
        items: items.map(i => ({
          title: i.item?.title || "—",
          item_id: i.item?.id || null,
          quantity: i.quantity || 1,
          unit_price: i.unit_price || 0,
          sale_fee: Math.abs(i.sale_fee || 0),
        })),
      };
    };

    for (let i = 0; i < orders.length; i += CONCURRENCY) {
      const built = await Promise.all(orders.slice(i, i + CONCURRENCY).map(buildOrder));
      enriched.push(...built);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: enriched, paging: data.body?.paging }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message, results: [] }) };
  }
};
