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
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const { token, user_id, from, to } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  // Try every known MeLi advertising endpoint variant
  const attempts = await Promise.all([
    apiGet(`/advertising/product_ads/advertisers`, token),
    apiGet(`/advertising/product_ads/advertisers?user_id=${user_id}`, token),
    apiGet(`/advertising/product_ads/advertisers/${user_id}`, token),
    apiGet(`/advertising/product_ads/advertisers/${user_id}/reports/daily_performance?date_from=${from}&date_to=${to}`, token),
    apiGet(`/advertising/product_ads/advertisers?limit=10`, token),
  ]);

  const debug = {
    "GET /advertisers": { status: attempts[0].status, body: attempts[0].body },
    "GET /advertisers?user_id": { status: attempts[1].status, body: attempts[1].body },
    "GET /advertisers/{user_id}": { status: attempts[2].status, body: attempts[2].body },
    "GET /advertisers/{user_id}/reports": { status: attempts[3].status, body: attempts[3].body },
    "GET /advertisers?limit=10": { status: attempts[4].status, body: attempts[4].body },
  };

  // Try to find a working advertiser and report
  let total_spent = 0;
  let available = false;

  // Check if list endpoint works
  for (const attempt of [attempts[0], attempts[1], attempts[4]]) {
    if (attempt.status === 200) {
      const body = attempt.body;
      let advId = null;
      if (Array.isArray(body)) advId = body[0]?.id;
      else if (body?.advertisers) advId = body.advertisers[0]?.id;
      else if (body?.results) advId = body.results[0]?.id;
      else if (body?.id) advId = body.id;

      if (advId) {
        const rep = await apiGet(`/advertising/product_ads/advertisers/${advId}/reports/daily_performance?date_from=${from}&date_to=${to}`, token);
        debug.report_via_list = { advId, status: rep.status, body: rep.body };
        if (rep.status === 200) {
          const days = rep.body?.daily_performance || [];
          total_spent = days.reduce((s, d) => s + (d.total_amount || 0), 0);
          available = true;
        }
        break;
      }
    }
  }

  // Check direct report (attempt[3])
  if (!available && attempts[3].status === 200) {
    const days = attempts[3].body?.daily_performance || [];
    total_spent = days.reduce((s, d) => s + (d.total_amount || 0), 0);
    available = true;
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent, available, debug }),
  };
};
