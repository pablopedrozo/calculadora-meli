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
      res.on("end", () => { try { resolve(JSON.parse(raw)); } catch (e) { resolve(null); } });
    });
    req.on("error", () => resolve(null));
    req.end();
  });
}

// Trae el desglose REAL de cargos desde MercadoPago (charges_details)
// comisión, financiación de cuotas, IIBB/impuestos y envío vienen separados acá
async function getPaymentBreakdown(paymentId, token) {
  const d = await apiGet("api.mercadopago.com", `/v1/payments/${paymentId}`, token);
  if (!d || !Array.isArray(d.charges_details)) return null;

  let commission = 0, financing = 0, iibb = 0, shipping = 0;
  for (const c of d.charges_details) {
    const amt = (c.amounts?.original || 0) - (c.amounts?.refunded || 0);
    const type = (c.type || "").toLowerCase();
    const name = (c.name || "").toLowerCase();

    if (type === "shipping" || name.includes("shp") || name.includes("shipping")) {
      shipping += amt;
    } else if (type === "tax" || name.includes("iibb") || name.includes("withholding") || name.includes("ingresos_brutos") || name.includes("percep")) {
      iibb += amt;
    } else if (name.includes("financing") || name.includes("financiac") || name.includes("cuota") || name.includes("installment")) {
      financing += amt;
    } else if (type === "fee") {
      commission += amt;
    }
  }

  const net = d.transaction_details?.net_received_amount || 0;
  return { commission, financing, iibb, shipping, net };
}

exports.handler = async (event) => {
  const { token, user_id, from, to, offset = "0" } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  try {
    const path = `/orders/search?seller=${user_id}&order.date_created.from=${from}T00:00:00.000-03:00&order.date_created.to=${to}T23:59:59.000-03:00&limit=50&offset=${offset}&sort=date_desc`;
    const data = await apiGet("api.mercadolibre.com", path, token);
    const orders = data.results || [];

    // Procesar en lotes de 10 para no saturar MercadoPago (evita rate limits y timeout)
    const enriched = [];
    const CONCURRENCY = 10;
    const buildOrder = async (order) => {
      const items = order.order_items || [];
      const payment = order.payments?.[0];
      const paymentId = payment?.id;

      // sale_fee = comisión + financiación (fallback si MP no responde)
      const sale_fee_total = items.reduce((s, i) => s + Math.abs(i.sale_fee || 0), 0);

      // Desglose real desde MercadoPago
      const bd = paymentId ? await getPaymentBreakdown(paymentId, token) : null;

      const commission   = bd ? bd.commission : sale_fee_total;
      const financing    = bd ? bd.financing  : 0;
      const shipping_cost = bd ? bd.shipping  : 0;
      const iibb_real    = bd ? bd.iibb       : 0;
      const net_received = bd ? bd.net        : 0;

      return {
        id: order.id,
        date: order.date_created,
        status: order.status,
        total_amount: order.total_amount || 0,
        commission,          // comisión MeLi pura (meli_percentage_fee, IVA incluido)
        financing,           // costo de cuotas sin interés (financing_add_on_fee)
        shipping_cost,       // envío real que paga el vendedor (type shipping)
        iibb_real,           // IIBB/impuestos retenidos (type tax) — varía por venta
        net_received,        // lo que MeLi realmente deposita
        shipment_id: order.shipping?.id || null,
        payment_method: payment?.payment_method_id || null,
        installments: payment?.installments || 1,
        breakdown_ok: !!bd,  // true si vino el desglose real de MP
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
      const chunk = orders.slice(i, i + CONCURRENCY);
      const built = await Promise.all(chunk.map(buildOrder));
      enriched.push(...built);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results: enriched, paging: data.paging }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message, results: [] }) };
  }
};
