// API silsilah: GET mengambil data terbaru, PUT menyimpan data baru dan mencatatnya di log.
// Data disimpan di Upstash Redis (pasang dari Vercel → Storage / Marketplace).

const { redis, KEYS, configured } = require("./_redis");
const { describeChanges } = require("./_diff");

const MAX_BYTES = 1000000;

// Simpan hanya kalau versi belum berubah sejak pengedit membuka halaman,
// sisihkan data lama ke riwayat (50 versi terakhir), lalu tambahkan catatan ke log.
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
redis.call('LPUSH', KEYS[4], ARGV[3])
redis.call('LTRIM', KEYS[4], 0, 1999)
return {1, v + 1}
`;

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

function deviceName(ua) {
  ua = ua || "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua)) return "Mac";
  if (/Linux/.test(ua)) return "Linux";
  return "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!configured) {
    return res.status(503).json({
      error: "Penyimpanan belum disiapkan. Hubungkan database Upstash Redis di dashboard Vercel.",
    });
  }

  try {
    if (req.method === "GET") {
      const [version, data] = await redis(["MGET", KEYS.version, KEYS.data]);
      return res.status(200).json({ version: Number(version || 0), data: data ? JSON.parse(data) : null });
    }

    if (req.method === "PUT") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      if (!Number.isInteger(body.baseVersion) || !isValidPerson(body.data, 0)) {
        return res.status(400).json({ error: "Data tidak valid." });
      }
      const json = JSON.stringify(body.data);
      if (json.length > MAX_BYTES) return res.status(413).json({ error: "Data terlalu besar." });

      const [current, oldJson] = await redis(["MGET", KEYS.version, KEYS.data]);
      const currentVersion = Number(current || 0);
      if (currentVersion !== body.baseVersion) {
        return res.status(409).json({ error: "conflict", version: currentVersion });
      }

      const editor = typeof body.editor === "string" ? body.editor.trim().slice(0, 60) : "";
      const diff = oldJson ? describeChanges(JSON.parse(oldJson), body.data) : { changes: [{ kind: "edit", text: "Data awal disimpan" }], more: 0 };
      const entry = JSON.stringify({
        v: body.baseVersion + 1,
        t: new Date().toISOString(),
        by: editor,
        device: deviceName(req.headers["user-agent"]),
        changes: diff.changes,
        more: diff.more,
      });

      const [ok, version] = await redis([
        "EVAL", SAVE_SCRIPT, "4", KEYS.version, KEYS.data, KEYS.history, KEYS.log,
        String(body.baseVersion), json, entry,
      ]);
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
