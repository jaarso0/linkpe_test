// Public endpoint for payers, used in unique-amount mode (see _lib/unique.js).
//
//   POST /api/payments  { ref?, note? }        -> start a payment, get its amount
//   POST /api/payments  { id, action: "paid" } -> payer says they have paid
//   GET  /api/payments?id=...                  -> its status
//
// Statuses: awaiting (amount handed out) -> pending (payer tapped "I've paid")
// -> verified | rejected (you, on /admin.html, after checking your bank).
// "I've paid" is only a claim. Nothing here proves money arrived.

const crypto = require("crypto");
const store = require("./_lib/store");
const { SLOT_SECONDS, uniqueConfig } = require("./_lib/unique");

const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

/** What a payer may see. Never the list, never anyone else's payment. */
const publicView = (r) => ({
  id: r.id,
  amount: r.amount,
  status: r.status,
  expiresAt: r.expiresAt,
});

/** Paise 1..99 in random order, so amounts do not hand out predictably. */
function shuffledPaise() {
  const p = Array.from({ length: 99 }, (_, i) => i + 1);
  for (let i = p.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

async function start(req, res, base) {
  const body = req.body || {};
  for (const paise of shuffledPaise()) {
    const amount = base + "." + String(paise).padStart(2, "0");
    if (!(await store.claimSlot(amount, SLOT_SECONDS))) continue;

    const now = Date.now();
    const record = {
      id: crypto.randomBytes(9).toString("base64url"),
      amount,
      ref: clip(body.ref, 64),
      note: clip(body.note, 140),
      status: "awaiting",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SLOT_SECONDS * 1000).toISOString(),
      paidAt: null,
      reviewedAt: null,
    };
    await store.save(record);
    return res.status(201).json(publicView(record));
  }
  return res.status(503).json({
    error: "no_amounts",
    message: "Too many payments in progress right now. Please try again in a few minutes.",
  });
}

async function markPaid(req, res) {
  const r = await store.get(clip(req.body.id, 32));
  if (!r) return res.status(404).json({ error: "not_found", message: "Payment not found." });
  if (r.status === "awaiting") {
    r.status = "pending";
    r.paidAt = new Date().toISOString();
    await store.save(r);
  }
  return res.status(200).json(publicView(r));
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const unique = uniqueConfig();
    if (!unique || unique.error) {
      return res.status(400).json({
        error: "unique_off",
        message: (unique && unique.error) || "Set UPI_UNIQUE_AMOUNT=true to use payment tracking.",
      });
    }

    if (req.method === "GET") {
      const r = await store.get(clip(req.query && req.query.id, 32));
      if (!r) return res.status(404).json({ error: "not_found", message: "Payment not found." });
      return res.status(200).json(publicView(r));
    }

    if (req.method === "POST") {
      if (req.body && req.body.action === "paid") return await markPaid(req, res);
      return await start(req, res, unique.base);
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    return res.status(500).json({ error: e.code || "server_error", message: e.message });
  }
};
