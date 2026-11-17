import { configured, resourceUrl } from "../lib/auth.js";

// OAuth Protected Resource Metadata for ChatGPT's MCP client.
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }
  if (!configured()) {
    res.statusCode = 503;
    return res.end(JSON.stringify({ error: "Connector not configured" }));
  }
  const issuer = process.env.TRAZZO_OAUTH_ISSUER;
  res.statusCode = 200;
  res.end(JSON.stringify({
    resource: resourceUrl(),
    authorization_servers: [issuer],
    scopes_supported: ["trazzo:read"],
    bearer_methods_supported: ["header"]
  }));
}
