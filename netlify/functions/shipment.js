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
  const { token, shipment_id } = event.queryStringParameters || {};
  if (!token || !shipment_id) return { statusCode: 400, body: JSON.stringify({ error: "Missing params" }) };
  try {
    const data = await apiGet(`/shipments/${shipment_id}`, token);
    // Try to get the cost charged to the seller
    const cost = data.shipping_option?.cost || data.base_cost || 0;
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cost, status: data.status }) };
  } catch (e) {
    return { statusCode: 200, body: JSON.stringify({ cost: 0 }) };
  }
};
