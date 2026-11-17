import test from "node:test";
import assert from "node:assert/strict";
import { authenticate, configured, resourceUrl, metadataUrl, authSettings } from "../lib/auth.js";
import resourceHandler from "../api/oauth-protected-resource.js";
import mcpHandler from "../api/mcp.js";

const keys = [
  "TRAZZO_MCP_PUBLIC_URL",
  "TRAZZO_OAUTH_ISSUER",
  "TRAZZO_OAUTH_JWKS_URL",
  "TRAZZO_ALLOWED_SUBJECTS",
  "TRAZZO_ALLOWED_CLIENT_IDS",
  "TRAZZO_REQUIRED_SCOPE",
  "TRAZZO_FIREBASE_SERVICE_ACCOUNT_JSON",
  "TRAZZO_ALLOWED_ORIGINS"
];
const prior = Object.fromEntries(keys.map(k => [k, process.env[k]]));
const base = "https://preview.example.org";
function reset(values = {}) {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
}
function ready() {
  reset({
    TRAZZO_MCP_PUBLIC_URL: base,
    TRAZZO_OAUTH_ISSUER: "https://login.authkit.app",
    TRAZZO_OAUTH_JWKS_URL: "https://login.authkit.app/oauth2/jwks",
    TRAZZO_ALLOWED_SUBJECTS: "user_owner",
    TRAZZO_FIREBASE_SERVICE_ACCOUNT_JSON: "not-a-real-credential"
  });
}
function post(url = base + "/mcp", headers = {}) {
  return new Request(url, { method: "POST", headers });
}

test("OAuth configuration fails closed and never exposes MCP tools", async () => {
  reset();
  assert.equal(configured(), false);
  const a = await authenticate(post());
  assert.equal(a.error.status, 503);
  const b = await mcpHandler.fetch(post());
  assert.equal(b.status, 503);
  const m = await resourceHandler.fetch(new Request(base + "/.well-known/oauth-protected-resource"));
  assert.equal(m.status, 503);
});

test("resource indicator and OAuth metadata agree exactly with WorkOS", async () => {
  ready();
  assert.equal(configured(), true);
  assert.equal(resourceUrl(), base + "/mcp");
  assert.equal(metadataUrl(), base + "/.well-known/oauth-protected-resource");
  const r = await resourceHandler.fetch(new Request(metadataUrl()));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.resource, resourceUrl());
  assert.deepEqual(body.authorization_servers, ["https://login.authkit.app"]);
  assert.equal(body.scopes_supported.includes("openid"), true);
  assert.equal(authSettings().allowedClients.includes("https://chatgpt.com/oauth/client.json"), true);
});

test("anonymous MCP returns OAuth challenge, never Firebase data", async () => {
  ready();
  const r = await mcpHandler.fetch(post());
  assert.equal(r.status, 401);
  assert.match(r.headers.get("www-authenticate"), /resource_metadata="https:\/\/preview\.example\.org\/\.well-known\/oauth-protected-resource"/);
  const text = await r.text();
  assert.doesNotMatch(text, /user_owner|not-a-real-credential/);
});

test("reject invalid origins, hosts, and invalid bearer tokens", async () => {
  ready();
  assert.equal((await authenticate(post(base + "/mcp", { origin: "https://attacker.example" }))).error.status, 403);
  assert.equal((await authenticate(post("https://other.example/mcp"))).error.status, 400);
  const r = await authenticate(post(base + "/mcp", { authorization: "Bearer invalid-not-jwt" }));
  assert.equal(r.error.status, 401);
});


test("WorkOS access tokens require an explicit granted scope for this resource", async () => {
  ready();
  assert.equal(authSettings().requiredScope, "openid");
  // Read-only tools must advertise the same required OAuth scope.
  const { tools } = await import("../lib/tools.js");
  assert.deepEqual(tools.map((t) => t.name),
    ["trazzo_resumen", "trazzo_proyectos", "trazzo_tareas"]);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.deepEqual(tool.securitySchemes[0].scopes, ["openid"]);
  }
});

test.after(() => {
  reset();
  for (const [key, value] of Object.entries(prior)) if (value !== undefined) process.env[key] = value;
});
