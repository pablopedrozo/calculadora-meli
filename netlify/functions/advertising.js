const https = require("https");

function apiGet(path, token, hostname = "api.mercadolibre.com") {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(`https://${hostname}${path}`);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "X-Caller-Id": "1877728575",
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw.slice(0, 300) }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

exports.handler = async (event) => {
  const { token, user_id, from, to } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  const debug = {};

  // Step 1: get advertiser ID (this endpoint is known to work with product_id=PADS)
  let advertiser_id = null;
  try {
    const r = await apiGet(`/advertising/advertisers?user_id=${user_id}&product_id=PADS`, token);
    debug.advertisers = { status: r.status, body: r.body };
    if (r.status === 200) {
      const results = r.body?.results || r.body?.advertisers || (Array.isArray(r.body) ? r.body : []);
      advertiser_id = results[0]?.id || results[0]?.advertiser_id || r.body?.id || null;
    }
  } catch (e) { debug.advertisers = { error: e.message }; }

  // Step 2: try money movements filtered by PADS (advertising charges appear as account debits)
  const movEndpoints = [
    `/users/${user_id}/movements?type=charge&category=product_ads&date_from=${from}&date_to=${to}&limit=200`,
    `/users/${user_id}/movements?tags=pads&date_from=${from}&date_to=${to}&limit=200`,
    `/users/${user_id}/balance/movements?type=PRODUCT_ADS&date_from=${from}T00:00:00-03:00&date_to=${to}T23:59:59-03:00&limit=200`,
    `/users/${user_id}/balance/movements?category=product_ads&date_from=${from}T00:00:00-03:00&date_to=${to}T23:59:59-03:00&limit=200`,
    `/users/${user_id}/payouts/search?type=product_ads&begin_date=${from}T00:00:00-03:00&end_date=${to}T23:59:59-03:00`,
  ];

  for (const path of movEndpoints) {
    try {
      const r = await apiGet(path, token);
      debug[path] = { status: r.status };
      if (r.status === 200) {
        const items = r.body?.movements || r.body?.results || r.body?.data || (Array.isArray(r.body) ? r.body : []);
        if (Array.isArray(items) && items.length > 0) {
          const total_spent = items.reduce((s, m) => s + Math.abs(m.amount || m.total || 0), 0);
          return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ total_spent, available: total_spent > 0, advertiser_id, endpoint: path, debug }),
          };
        }
      }
    } catch (e) { debug[path] = { error: e.message }; }
  }

  // Step 3: try direct campaign summary endpoints if we have an advertiser_id
  if (advertiser_id) {
    const advEndpoints = [
      `/advertising/advertisers/${advertiser_id}/summary?product_id=PADS&date_from=${from}&date_to=${to}`,
      `/advertising/advertisers/${advertiser_id}?product_id=PADS&date_from=${from}&date_to=${to}`,
      `/advertising/product_ads/advertisers/${advertiser_id}/summary?date_from=${from}&date_to=${to}`,
      `/advertising/product_ads/advertisers/${advertiser_id}/campaigns?status=ACTIVE,PAUSED&date_from=${from}&date_to=${to}&limit=50`,
    ];
    for (const path of advEndpoints) {
      try {
        const r = await apiGet(path, token);
        debug[path] = { status: r.status, body_preview: JSON.stringify(r.body).slice(0, 200) };
        if (r.status === 200) {
          const spend = r.body?.total_spent || r.body?.totalSpend || r.body?.spend || r.body?.daily_spent || 0;
          if (spend > 0) {
            return {
              statusCode: 200,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ total_spent: spend, available: true, advertiser_id, endpoint: path, debug }),
            };
          }
        }
      } catch (e) { debug[path] = { error: e.message }; }
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ total_spent: 0, available: false, advertiser_id, debug }),
  };
};
