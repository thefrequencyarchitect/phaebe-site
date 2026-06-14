// Vercel serverless function — adds waitlist signups to Kit (ConvertKit) server-side.
//
// Why this exists: the browser cannot reliably submit to Kit directly. A plain
// hidden-iframe form POST is silently dropped by Kit, and a browser fetch is
// blocked by CORS/CSP. Doing it server-side (no CORS, proper headers) is reliable.
//
// Kit form: "Phaebe waitlist"  form_id 9553614  uid 39a3954509
//
// TWO paths, most-reliable first:
//   1. If env var KIT_API_KEY is set -> Kit API v4 (api.kit.com/v4/forms/{id}/subscribers).
//      This is the official, guaranteed method. Set KIT_API_KEY in Vercel project
//      settings (Kit dashboard -> Settings -> Advanced/Developer -> API keys).
//   2. Otherwise -> public form-subscriptions endpoint (no key). Usually works.
//
// Double opt-in is ON in Kit, so new emails arrive as "Unconfirmed" until the
// person clicks the confirmation email. That is expected and correct.

const KIT_FORM_ID = "9553614";
const PUBLIC_ENDPOINT = `https://app.kit.com/forms/${KIT_FORM_ID}/subscriptions`;
const API_V4_ENDPOINT = `https://api.kit.com/v4/forms/${KIT_FORM_ID}/subscribers`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  let email = "";
  try {
    const body =
      typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    email = (body.email || body.email_address || "").trim();
  } catch {
    email = "";
  }

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: "invalid_email" });
  }

  const apiKey = process.env.KIT_API_KEY;

  try {
    if (apiKey) {
      // Path 1: official Kit API v4
      const kitRes = await fetch(API_V4_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Kit-Api-Key": apiKey,
        },
        body: JSON.stringify({ email_address: email }),
      });
      const text = await kitRes.text();
      if (kitRes.ok) return res.status(200).json({ ok: true });
      return res
        .status(502)
        .json({ ok: false, error: "kit_api_rejected", status: kitRes.status, detail: text.slice(0, 300) });
    }

    // Path 2: public form endpoint (no key)
    const params = new URLSearchParams();
    params.append("email_address", email);
    const kitRes = await fetch(PUBLIC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params,
    });
    const text = await kitRes.text();
    let data = {};
    try { data = JSON.parse(text); } catch { /* non-JSON */ }
    if (kitRes.ok && (data.status === "success" || data.status === "quarantined")) {
      return res.status(200).json({ ok: true });
    }
    return res
      .status(502)
      .json({ ok: false, error: "kit_public_rejected", status: kitRes.status, detail: text.slice(0, 300) });
  } catch (err) {
    return res.status(500).json({ ok: false, error: "request_failed", detail: String(err) });
  }
}
