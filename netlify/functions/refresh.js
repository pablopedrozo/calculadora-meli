const https = require("https");
const querystring = require("querystring");

const CLIENT_ID = process.env.MELI_CLIENT_ID;
const CLIENT_SECRET = process.env.MELI_CLIENT_SECRET;

function httpsPost(url, data) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify(data);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        Accept: "application/json",
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => { try { resolve(JSON.parse(raw)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

exports.handler = async (event) => {
  const { refresh_token } = event.queryStringParameters || {};
  if (!refresh_token) return { statusCode: 400, body: JSON.stringify({ error: "No refresh_token" }) };

  try {
    const result = await httpsPost("https://api.mercadolibre.com/oauth/token", {
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token,
    });

    if (result.error) return { statusCode: 400, body: JSON.stringify(result) };

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_token: result.access_token,
        refresh_token: result.refresh_token, // MeLi rota el refresh_token: hay que guardarlo
        user_id: result.user_id,
        expires_in: result.expires_in || 21600,
      }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
