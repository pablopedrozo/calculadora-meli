const https = require("https");

function apiGet(path, token) {
  return new Promise((resolve) => {
    const options = {
      hostname: "api.mercadolibre.com",
      path,
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => { let b; try { b = JSON.parse(raw); } catch (e) { b = null; } resolve({ status: res.statusCode, body: b }); });
    });
    req.on("error", () => resolve({ status: 0, body: null }));
    req.end();
  });
}

exports.handler = async (event) => {
  const { token, user_id } = event.queryStringParameters || {};
  if (!token || !user_id) return { statusCode: 401, body: JSON.stringify({ error: "No token" }) };

  try {
    // 1. Todos los IDs de publicaciones del vendedor (paginado, hasta 1000)
    let ids = [];
    let offset = 0;
    while (offset < 1000) {
      const r = await apiGet(`/users/${user_id}/items/search?limit=100&offset=${offset}`, token);
      const results = r.body?.results || [];
      ids = ids.concat(results);
      const total = r.body?.paging?.total || results.length;
      offset += 100;
      if (results.length < 100 || offset >= total) break;
    }

    // 2. Detalle en multiget (lotes de 20)
    const attrs = "id,title,status,price,available_quantity,sold_quantity,thumbnail,listing_type_id";
    const items = [];
    for (let i = 0; i < ids.length; i += 20) {
      const batch = ids.slice(i, i + 20).join(",");
      const r = await apiGet(`/items?ids=${batch}&attributes=${attrs}`, token);
      const arr = Array.isArray(r.body) ? r.body : [];
      for (const entry of arr) {
        const it = entry.body || entry;
        if (!it || !it.id) continue;
        items.push({
          id: it.id,
          title: it.title || "—",
          status: it.status || "",
          price: it.price || 0,
          available_quantity: it.available_quantity || 0,
          sold_quantity: it.sold_quantity || 0,
          thumbnail: it.thumbnail || "",
          listing_type_id: it.listing_type_id || "",
        });
      }
    }

    // Solo catálogo vivo (activas + pausadas), ordenado por estado y título
    const live = items
      .filter((i) => i.status === "active" || i.status === "paused")
      .sort((a, b) => (a.status === b.status ? a.title.localeCompare(b.title) : a.status === "active" ? -1 : 1));

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: live, total: live.length, fetched: ids.length }),
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message, items: [] }) };
  }
};
