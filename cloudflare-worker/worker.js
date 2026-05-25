/**
 * E-Story AI proxy (Cloudflare Worker)
 *
 * Why: GitHub Pages is static, and opencode.ai/zen sends no CORS headers, so a
 * browser cannot call it directly. This Worker sits in between: it adds CORS
 * headers and injects the API key from a secret, so the browser never sees the
 * key. Mirrors serve.py's mapping: /api/zen/<rest> -> https://opencode.ai/zen/<rest>.
 *
 * Setup:
 *   wrangler secret put OPENCODE_API_KEY
 *   wrangler deploy
 * Then in the app Settings, set API URL to:
 *   https://<your-worker>.workers.dev/api/zen/go/v1
 */

const PROXY_PREFIX = "/api/zen/";
const UPSTREAM_BASE = "https://opencode.ai/zen/";

// Restrict who may call the Worker. Add your own Pages origin here.
const ALLOWED_ORIGINS = [
  "https://boldmottt.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    if (!url.pathname.startsWith(PROXY_PREFIX)) {
      return json({ error: { code: "not_found", message: `No route for ${url.pathname}` } }, 404, cors);
    }
    if (!env.OPENCODE_API_KEY) {
      return json({ error: { code: "no_key", message: "OPENCODE_API_KEY secret is not set on the Worker" } }, 503, cors);
    }

    const upstream = UPSTREAM_BASE + url.pathname.slice(PROXY_PREFIX.length) + url.search;
    const init = {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENCODE_API_KEY}`,
        // Cloudflare (error 1010) blocks some default UAs.
        "User-Agent": "curl/8.7.1",
      },
      body: request.method === "POST" ? await request.text() : undefined,
    };

    try {
      const res = await fetch(upstream, init);
      const body = await res.text();
      return new Response(body, {
        status: res.status,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    } catch (e) {
      return json({ error: { code: "upstream_error", message: String(e) } }, 502, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
