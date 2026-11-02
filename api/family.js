// API silsilah: GET mengambil data terbaru, PUT menyimpan data baru.
// Data disimpan di Upstash Redis (pasang dari Vercel → Storage / Marketplace).

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const KEY_VERSION = "{silsilah}:version";
const KEY_DATA = "{silsilah}:data";
const KEY_HISTORY = "{silsilah}:history";
const MAX_BYTES = 1000000;

// Simpan hanya kalau versi belum berubah sejak pengedit membuka halaman,
// dan sisihkan data lama ke riwayat (50 versi terakhir) untuk jaga-jaga.
const SAVE_SCRIPT = `
local v = tonumber(redis.call('GET', KEYS[1]) or '0')
if v ~= tonumber(ARGV[1]) then return {0, v} end
local old = redis.call('GET', KEYS[2])
if old then
  redis.call('LPUSH', KEYS[3], old)
  redis.call('LTRIM', KEYS[3], 0, 49)
end
redis.call('SET', KEYS[2], ARGV[2])
redis.call('SET', KEYS[1], v + 1)
return {1, v + 1}
`;

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

function isText(v, max) {
  return typeof v === "string" && v.length <= max;
}

function isValidPerson(node, depth) {
  if (depth > 40 || !node || typeof node !== "object") return false;
  if (!isText(node.id, 64) || !isText(node.name, 200)) return false;
  if (node.unions === undefined) return true;
  if (!Array.isArray(node.unions) || node.unions.length > 10) return false;
  return node.unions.every(
    (u) =>
      u &&
      isText(u.spouse, 200) &&
      (u.label === undefined || isText(u.label, 100)) &&
      Array.isArray(u.children) &&
      u.children.every((c) => isValidPerson(c, depth + 1))
  );
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({
      error: "Penyimpanan belum disiapkan. Hubungkan database Upstash Redis di dashboard Vercel.",
    });
  }

  try {
    if (req.method === "GET") {
      const [version, data] = await redis(["MGET", KEY_VERSION, KEY_DATA]);
      return res.status(200).json({ version: Number(version || 0), data: data ? JSON.parse(data) : null });
    }

    if (req.method === "PUT") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      if (!Number.isInteger(body.baseVersion) || !isValidPerson(body.data, 0)) {
        return res.status(400).json({ error: "Data tidak valid." });
      }
      const json = JSON.stringify(body.data);
      if (json.length > MAX_BYTES) return res.status(413).json({ error: "Data terlalu besar." });

      const [ok, version] = await redis(["EVAL", SAVE_SCRIPT, "3", KEY_VERSION, KEY_DATA, KEY_HISTORY, String(body.baseVersion), json]);
      if (!ok) return res.status(409).json({ error: "conflict", version });
      return res.status(200).json({ version });
    }

    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ error: "Metode tidak didukung." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Gagal menghubungi database." });
  }
};
