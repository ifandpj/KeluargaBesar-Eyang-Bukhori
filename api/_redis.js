// Akses Upstash Redis lewat REST API (dipakai bersama oleh api/family.js dan api/log.js).

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const KEYS = {
  version: "{silsilah}:version",
  data: "{silsilah}:data",
  history: "{silsilah}:history",
  log: "{silsilah}:log",
  pinFail: (ip) => "{silsilah}:pinfail:" + ip,
};

async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error || "HTTP " + res.status);
  return body.result;
}

module.exports = { redis, KEYS, configured: Boolean(REDIS_URL && REDIS_TOKEN) };
