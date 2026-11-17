import { createRemoteJWKSet, jwtVerify } from "jose";

const env = (name) => process.env[name]?.trim() || "";
const mandatory = [
  "TRAZZO_MCP_PUBLIC_URL",
  "TRAZZO_OAUTH_ISSUER",
  "TRAZZO_OAUTH_AUDIENCE",
  "TRAZZO_OAUTH_JWKS_URL",
  "TRAZZO_ALLOWED_SUBJECTS"
];

export function configured() {
  return mandatory.every((key) => !!env(key)) && !!env("TRAZZO_FIREBASE_SERVICE_ACCOUNT_JSON");
}

export function resourceUrl() {
  return env("TRAZZO_MCP_PUBLIC_URL").replace(/\/$/, "") + "/mcp";
}
export function metadataUrl() {
  return env("TRAZZO_MCP_PUBLIC_URL").replace(/\/$/, "") + "/.well-known/oauth-protected-resource";
}
const fail = (status, message, challenge = false) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(challenge ? { "WWW-Authenticate": 'Bearer resource_metadata="' + metadataUrl() + '"' } : {})
    }
  });

export async function authenticate(request) {
  if (!configured()) return { error: fail(503, "MCP configuration incomplete.") };
  const expectedHost = new URL(env("TRAZZO_MCP_PUBLIC_URL")).host;
  if (new URL(request.url).host !== expectedHost) return { error: fail(400, "Invalid host.") };
  const origin = request.headers.get("origin");
  const allowedOrigins = (env("TRAZZO_ALLOWED_ORIGINS") || "https://chatgpt.com").split(",").map((s) => s.trim());
  if (origin && !allowedOrigins.includes(origin)) return { error: fail(403, "Origin not allowed.") };
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer (\S+)$/i.exec(header);
  if (!match) return { error: fail(401, "Authentication required.", true) };
  try {
    const jwks = createRemoteJWKSet(new URL(env("TRAZZO_OAUTH_JWKS_URL")));
    const verified = await jwtVerify(match[1], jwks, {
      issuer: env("TRAZZO_OAUTH_ISSUER"),
      audience: env("TRAZZO_OAUTH_AUDIENCE"),
      clockTolerance: 5
    });
    const subject = verified.payload.sub;
    const allow = env("TRAZZO_ALLOWED_SUBJECTS").split(",").map((x) => x.trim()).filter(Boolean);
    if (!subject || !allow.includes(subject)) return { error: fail(403, "Account not authorized.") };
    const scope = verified.payload.scope;
    const scopes = typeof scope === "string" ? scope.split(" ") : Array.isArray(verified.payload.scp) ? verified.payload.scp : [];
    if (!scopes.includes("trazzo:read")) return { error: fail(403, "Missing trazzo:read scope.") };
    return { authInfo: { token: match[1], clientId: subject, scopes, extra: { subject } } };
  } catch (_) {
    return { error: fail(401, "Invalid access token.", true) };
  }
}
