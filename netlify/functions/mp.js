const https = require("https");

function mpGet(path, token) {
  return new Promise((resolve) => {
    const options = {
      hostname: "api.mercadopago.com",
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
    req.setTimeout(15000, () => { req.destroy(); resolve({ status: 0, body: null }); });
    req.end();
  });
}

exports.handler = async (event) => {
  const { token, action, from, to } = event.queryStringParameters || {};
  if (!token) return { statusCode: 400, body: JSON.stringify({ error: "Falta token" }) };
  const json = (code, obj) => ({ statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) });

  try {
    // Test: valida el token y devuelve el nick de la cuenta MP
    if (action === "test") {
      const r = await mpGet("/users/me", token);
      if (r.status !== 200) return json(r.status || 400, { error: (r.body && r.body.message) || ("HTTP " + r.status) });
      return json(200, { nickname: r.body?.nickname || r.body?.first_name || "OK", ok: true });
    }

    // Pagos aprobados del período con su comisión real (amount - net = lo que MP descontó)
    const path = `/v1/payments/search?sort=date_created&criteria=desc&range=date_created&begin_date=${from}T00:00:00.000-03:00&end_date=${to}T23:59:59.000-03:00&limit=100`;
    const r = await mpGet(path, token);
    if (r.status !== 200) return json(r.status || 400, { error: (r.body && r.body.message) || ("HTTP " + r.status), results: [] });

    const payments = (r.body?.results || [])
      .filter((p) => p.status === "approved")
      .map((p) => {
        const amount = p.transaction_amount || 0;
        const net = p.transaction_details?.net_received_amount || 0;
        return {
          id: p.id,
          date: p.date_created,
          amount,
          net,
          mpCost: Math.max(0, amount - net), // comisión + impuestos reales del cobro
          order_ref: p.external_reference || (p.order && String(p.order.id)) || null,
          method: p.payment_method_id || null,
        };
      });
    return json(200, { results: payments, paging: r.body?.paging });
  } catch (e) {
    return json(500, { error: e.message, results: [] });
  }
};
