// Unique-amount mode: every payment gets its own amount, base.01 to base.99,
// so a credit in your bank can be matched to one payment by amount alone.
//
//   UPI_UNIQUE_AMOUNT=true
//   UPI_DEFAULT_AMOUNT=10      whole rupees -> payers see 10.01 ... 10.99
//
// An amount stays reserved for SLOT_SECONDS after it is handed out, then it
// can be given to someone else.

const SLOT_SECONDS = 60 * 60;

/** null when the mode is off; { base } when on; { error } when misconfigured. */
function uniqueConfig() {
  if (String(process.env.UPI_UNIQUE_AMOUNT || "").toLowerCase() !== "true") return null;
  const base = process.env.UPI_DEFAULT_AMOUNT || "";
  if (!/^\d+$/.test(base)) {
    return {
      error:
        'UPI_UNIQUE_AMOUNT needs UPI_DEFAULT_AMOUNT set to whole rupees, like 10. It is "' +
        base + '".',
    };
  }
  return { base: Number(base) };
}

module.exports = { SLOT_SECONDS, uniqueConfig };
