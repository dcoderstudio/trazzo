import { createRemoteJWKSet, jwtVerify } from "jose";

const env = (name) => process.env[name]?.trim() || "";
const mandatory = [
  "TRAZZO_MCP_PUBLIC_URL",
  "TRAZZO_OAUTH_ISSUER",
  "TRAZZO_OAUTH_JWKS_URL",
  "TRAZZO_ALLOWED_SUBJECTS"
];

// Keep the read-only connector closed until both authorization and the
// Firebase service-account credential are configured.
export function configured() {
  return mandatory.every((key) => !!env(key)) &&
    !!env("TRAZZO_FIREBASE_SERVICE_ACCOUNT_JSON");
}

export function resourceUrl() {
  return env("TRAZZO_MCP_PUBLIC_URL").replace(/\/$/, "") + "/mcp";
}

export function metadataUrl() {
  return env("TRAZZO_MCP_PUBLIC_URL").replace(/\/$/, "") +
    "/.well-known/oauth-protected-resource";
}

function respond(status, message, challenge = false) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(challenge ? {
        "WWW-Authenticate": `Bearer error="unauthorized", resource_metadata="${metadataUrl()}"`
      } : {})
    }
  });
}

const list = (str) => str.split(",").map((x) => x.trim()).filter(Boolean);
export function authSettings() {
  return {
    issuer: env("TRAZZO_OAUTH_ISSUER"),
    audience: resourceUrl(), // RFC 8707: always bound to this MCP resource
    jwksUrl: env("TRAZZO_OAUTH_JWKS_URL"),
    allowedSubjects: list(env("TRAZZO_ALLOWED_SUBJECTS")),
    allowedClients: list(env("TRAZZO_ALLOWED_CLIENT_IDS") ||
      "https://chatgpt.com/oauth/client.json"),
    // WorkOS CIMD clients support standard OIDC scopes. Custom scopes are
    // not granted automatically; subject + client + audience are also enforced.
    requiredScope: env("TRAZZO_REQUIRED_SCOPE") || "openid"
  };
}

export async function authenticate(request) {
  if (!configured()) return { error: respond(503, "MCP configuration incomplete.") };
  const config = authSettings();
  if (![config.issuer, config.audience, config.jwksUrl].every((v) => {
    try { return new URL(v).protocol === "https:"; } catch { return false; }
  })) {
    return { error: respond(503, "Invalid OAuth configuration.") };
  }

  if (new URL(request.url).host !== new URL(env("TRAZZO_MCP_PUBLIC_URL")).host) {
    return { error: respond(400, "Invalid host.") };
  }
  const origin = request.headers.get("origin");
  const allowedOrigins = list(env("TRAZZO_ALLOWED_ORIGINS") || "https://chatgpt.com");
  if (origin && !allowedOrigins.includes(origin)) {
    return { error: respond(403, "Origin not allowed.") };
  }

  const match = /^Bearer (\S+)$/i.exec(request.headers.get("authorization") || "");
  if (!match) return { error: respond(401, "Authentication required.", true) };

  let payload;
  try {
    const jwks = createRemoteJWKSet(new URL(config.jwksUrl));
    ({ payload } = await jwtVerify(match[1], jwks, {
      issuer: config.issuer,
      audience: config.audience,
      clockTolerance: 5
    }));
  } catch {
    return { error: respond(401, "Invalid access token.", true) };
  }

  // Fail closed: tokens for agents, a different user, or a different OAuth
  // client cannot borrow this privileged service-account connection.
  if (payload.sub_profile === "ai_agent" ||
      !payload.sub || !config.allowedSubjects.includes(payload.sub)) {
    return { error: respond(403, "Account not authorized.") };
  }
  if (typeof payload.client_id !== "string" ||
      !config.allowedClients.includes(payload.client_id)) {
    return { error: respond(403, "Client not authorized.") };
  }
  const scopes = typeof payload.scope === "string" ? payload.scope.split(" ") :
    Array.isArray(payload.scp) ? payload.scp : [];
  // WorkOS Connect user access tokens include a space-delimited scope claim.
  // Deny missing or insufficient scopes rather than treating them as granted.
  if (!scopes.includes(config.requiredScope)) {
    return { error: respond(403, "Missing required scope.") };
  }
  return {
    authInfo: {
      token: match[1],
      clientId: payload.client_id,
      scopes,
      extra: { subject: payload.sub }
    }
  };
}
