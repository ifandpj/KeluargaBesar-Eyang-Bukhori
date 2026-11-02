// API log perubahan: hanya bisa dibaca dengan PIN (environment variable LOG_PIN di Vercel).

const crypto = require("crypto");
const { redis, KEYS, configured } = require("./_redis");

const MAX_FAILS = 10;
const LOCK_SECONDS = 900;
const PAGE_SIZE = 50;

const COUNT_FAIL = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1])) end
return n
`;

function samePin(given, expected) {
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Metode tidak didukung." });
  }
  const pin = process.env.LOG_PIN;
  if (!pin || !configured) {
    return res.status(503).json({ error: "PIN log belum diatur. Tambahkan LOG_PIN di pengaturan Vercel." });
  }

  try {
    const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
    const failKey = KEYS.pinFail(ip);
    if (Number((await redis(["GET", failKey])) || 0) >= MAX_FAILS) {
      return res.status(429).json({ error: "Terlalu banyak PIN salah. Coba lagi 15 menit lagi." });
    }
    if (!samePin(String(req.headers["x-log-pin"] || ""), pin)) {
      await redis(["EVAL", COUNT_FAIL, "1", failKey, String(LOCK_SECONDS)]);
      return res.status(401).json({ error: "PIN salah." });
    }

    const query = req.query || Object.fromEntries(new URL(req.url, "http://x").searchParams);
    const offset = Math.max(0, parseInt(query.offset, 10) || 0);
    const [rows, total] = await Promise.all([
      redis(["LRANGE", KEYS.log, String(offset), String(offset + PAGE_SIZE - 1)]),
      redis(["LLEN", KEYS.log]),
    ]);
    return res.status(200).json({ entries: rows.map((r) => JSON.parse(r)), total, offset });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Gagal menghubungi database." });
  }
};
