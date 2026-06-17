const https = require("https");
const querystring = require("querystring");

const CLIENT_ID = process.env.MELI_CLIENT_ID;
const CLIENT_SECRET = process.env.MELI_CLIENT_SECRET;

exports.handler = async (event) => {
  const { token } = event.queryStringParameters || {};
  if (!token) return { statusCode: 400, body: "" };

  try {
    const body = querystring.stringify({
      grant_type: "revoke",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      token,
    });
    await new Promise((resolve) => {
      const req = https.request({
        hostname: "api.mercadolibre.com",
        path: "/oauth/token",
        method: "DELETE",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body) },
      }, (res) => { res.on("data", ()=>{}); res.on("end", resolve); });
      req.on("error", resolve);
      req.write(body);
      req.end();
    });
  } catch(e) {}

  return { statusCode: 200, body: "" };
};
