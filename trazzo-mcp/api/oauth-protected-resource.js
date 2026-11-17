import { configured, resourceUrl } from "../lib/auth.js";
export default {
  async fetch(request) {
    if (!configured()) return new Response(JSON.stringify({ error: "Connector not configured" }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (request.method !== "GET") return new Response(null, { status: 405 });
    return new Response(JSON.stringify({
      resource: resourceUrl(),
      authorization_servers: [process.env.TRAZZO_OAUTH_ISSUER],
      scopes_supported: ["trazzo:read"],
      bearer_methods_supported: ["header"]
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
};
