import { configured, resourceUrl } from "../lib/auth.js";

// RFC 9728 metadata. Public metadata is safe; no Firebase data is exposed.
export default {
  fetch(request) {
    if (request.method !== "GET") return new Response(null, { status: 405 });
    if (!configured()) {
      return Response.json({ error: "Connector not configured" }, {
        status: 503, headers: { "Cache-Control": "no-store" }
      });
    }
    return Response.json({
      resource: resourceUrl(),
      authorization_servers: [process.env.TRAZZO_OAUTH_ISSUER],
      scopes_supported: [process.env.TRAZZO_REQUIRED_SCOPE || "openid"],
      bearer_methods_supported: ["header"]
    }, { headers: { "Cache-Control": "no-store" } });
  }
};
