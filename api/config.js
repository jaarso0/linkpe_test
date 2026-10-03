// Serves the payee configuration from environment variables.
// Vercel turns this file into a serverless function at /api/config.
//
// The VPA is NOT a secret: it necessarily ends up in the upi:// link and the
// QR that every payer sees. Env vars keep it out of source control and let you
// change it per deployment, nothing more.

const { uniqueConfig } = require("./_lib/unique");

const REQUIRED = ["UPI_VPA", "UPI_PAYEE_NAME"];

module.exports = (req, res) => {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    res.status(500).json({
      error: "missing_config",
      missing,
      message:
        "Set " + missing.join(" and ") + " in your environment. Locally that is .env.local; " +
        "on Vercel it is Project Settings, Environment Variables.",
    });
    return;
  }

  const amount = process.env.UPI_DEFAULT_AMOUNT || "";
  if (amount && !/^\d+(\.\d{1,2})?$/.test(amount)) {
    res.status(500).json({
      error: "bad_amount",
      message: 'UPI_DEFAULT_AMOUNT is "' + amount + '", which is not a valid UPI amount. Use digits with at most two decimal places.',
    });
    return;
  }

  const unique = uniqueConfig();
  if (unique && unique.error) {
    res.status(500).json({ error: "bad_unique", message: unique.error });
    return;
  }

  // Short cache: config changes only on redeploy, but a stale read should not
  // outlive a price change for long.
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=60");
  res.status(200).json({
    vpa: process.env.UPI_VPA,
    payeeName: process.env.UPI_PAYEE_NAME,
    currency: process.env.UPI_CURRENCY || "INR",
    defaultAmount: amount,
    note: process.env.UPI_NOTE || "",
    merchantCode: process.env.UPI_MERCHANT_CODE || "",
    // When true, the payer cannot change the amount in the UI.
    lockAmount: String(process.env.UPI_LOCK_AMOUNT || "").toLowerCase() === "true",
    // When true, the page asks /api/payments for a per-payment amount instead.
    uniqueAmount: Boolean(unique),
  });
};
