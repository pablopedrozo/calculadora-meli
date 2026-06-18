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
      res.on("end", () => {
        let body;
        try { body = JSON.parse(raw); } catch (e) { body = raw.slice(0, 2000); }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", (e) => resolve({ status: 0, body: { error: e.message } }));
    req.end();
  });
}

const ML = "api.mercadolibre.com";
const MP = "api.mercadopago.com";

exports.handler = async (event) => {
  const { token, user_id, order_id, from, to } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  const out = {};

  try {
    // 1. Get a recent order (use provided order_id or fetch latest)
    let oid = order_id;
    if (!oid) {
      const f = from || "2026-05-01";
      const t = to || "2026-06-17";
      const search = await apiGet(ML, `/orders/search?seller=${user_id}&order.date_created.from=${f}T00:00:00.000-03:00&order.date_created.to=${t}T23:59:59.000-03:00&limit=1&sort=date_desc`, token);
      oid = search.body?.results?.[0]?.id;
      out._search_status = search.status;
    }
    if (!oid) {
      return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "No order found", out }) };
    }
    out.order_id = oid;

    // 2. Full order detail (individual endpoint has more than search)
    const order = await apiGet(ML, `/orders/${oid}`, token);
    out.order = { status: order.status, body: order.body };

    const paymentId = order.body?.payments?.[0]?.id;
    const shipmentId = order.body?.shipping?.id;
    out.payment_id = paymentId;
    out.shipment_id = shipmentId;

    // 3. Payment detail from BOTH MercadoLibre and MercadoPago endpoints
    if (paymentId) {
      const [pMl, pMp] = await Promise.all([
        apiGet(ML, `/payments/${paymentId}`, token),
        apiGet(MP, `/v1/payments/${paymentId}`, token),
      ]);
      out.payment_ML = { status: pMl.status, body: pMl.body };
      out.payment_MP = { status: pMp.status, body: pMp.body };
    }

    // 4. Shipment detail + costs breakdown
    if (shipmentId) {
      const [sh, costs, items] = await Promise.all([
        apiGet(ML, `/shipments/${shipmentId}`, token),
        apiGet(ML, `/shipments/${shipmentId}/costs`, token),
        apiGet(ML, `/shipments/${shipmentId}/items`, token),
      ]);
      out.shipment = { status: sh.status, body: sh.body };
      out.shipment_costs = { status: costs.status, body: costs.body };
      out.shipment_items = { status: items.status, body: items.body };
    }

    // 5. Billing / fee detail endpoints (per-sale fee breakdown)
    out.billing_attempts = {};
    const billPaths = [
      [ML, `/billing/integration/monthly/periods?group=ML&document_type=BILL`],
      [ML, `/users/${user_id}/mercadolibre/fees?order_id=${oid}`],
    ];
    for (const [h, p] of billPaths) {
      const r = await apiGet(h, p, token);
      out.billing_attempts[p] = { status: r.status, body: typeof r.body === "object" ? r.body : String(r.body).slice(0, 300) };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(out, null, 2),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message, out }) };
  }
};
