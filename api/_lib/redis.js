// Tiny Upstash Redis client over the REST API.
// We avoid an npm dependency so the project still has zero install steps —
// Node 18+ has fetch built in, which is what Vercel runs by default.
//
// Required env vars (set in Vercel → Project → Settings → Environment Variables):
//   UPSTASH_REDIS_REST_URL    e.g. https://xxxxx.upstash.io
//   UPSTASH_REDIS_REST_TOKEN  the matching token

async function exec(...args) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error("Upstash env vars missing (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN)");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type":  "application/json"
    },
    body: JSON.stringify(args)
  });

  let data;
  try { data = await res.json(); }
  catch { throw new Error("Upstash returned non-JSON: " + res.status); }

  if (data.error) throw new Error("Upstash: " + data.error);
  return data.result;
}

async function get(key) {
  const raw = await exec("GET", key);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

async function set(key, value) {
  const v = typeof value === "string" ? value : JSON.stringify(value);
  return await exec("SET", key, v);
}

module.exports = { get, set, exec };
