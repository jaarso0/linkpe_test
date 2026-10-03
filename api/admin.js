// Owner-only endpoint behind /admin.html.
//
//   GET  /api/admin                                  -> every claim, newest first
//   POST /api/admin  { id, status: "verified" | "rejected" | "pending" | "awaiting" }
//
// Requires  Authorization: Bearer <ADMIN_TOKEN>.

const crypto = require("crypto");
const store = require("./_lib/store");

const STATUSES = ["awaiting", "pending", "verified", "rejected"];

function authorized(req) {
  const expected = process.env.ADMIN_TOKEN || "";
  const header = req.headers.authorization || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return expected.length > 0 && crypto.timingSafeEqual(a, b);
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!process.env.ADMIN_TOKEN) {
    return res.status(500).json({
      error: "missing_config",
      message: "Set ADMIN_TOKEN in your environment (a long random string) to use the admin page.",
    });
  }
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized", message: "Wrong admin token." });

  try {
    if (req.method === "GET") {
      return res.status(200).json({ payments: await store.list() });
    }

    if (req.method === "POST") {
      const { id, status } = req.body || {};
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: "bad_status", message: "status must be one of " + STATUSES.join(", ") });
      }
      const r = await store.get(String(id || ""));
      if (!r) return res.status(404).json({ error: "not_found", message: "No payment with that id." });

      r.status = status;
      r.reviewedAt = status === "verified" || status === "rejected" ? new Date().toISOString() : null;
      await store.save(r);
      return res.status(200).json(r);
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.code || "server_error", message: e.message });
  }
};
