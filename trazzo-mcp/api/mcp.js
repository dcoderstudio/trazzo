import { authenticate } from "../lib/auth.js";
import { tools, callTool } from "../lib/tools.js";

const mcpVersion = "2025-06-18";
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });
}
function error(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function validOrigin(request) {
  const o = request.headers.get("origin");
  const allow = (process.env.TRAZZO_ALLOWED_ORIGINS || "https://chatgpt.com").split(",").map(x => x.trim());
  return !o || allow.includes(o);
}
async function handler(request) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Allow": "POST, OPTIONS, GET" } });
  if (!validOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  if (request.method === "GET") return json({ error: "SSE not supported; use Streamable HTTP POST" }, 405);
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const auth = await authenticate(request);
  if (auth.error) return auth.error;
  let data;
  try { data = await request.json(); } catch { return json(error(null, -32700, "Invalid JSON"), 400); }
  if (!data || data.jsonrpc !== "2.0" || typeof data.method !== "string" || Array.isArray(data)) return json(error(data?.id ?? null, -32600, "Invalid Request"), 400);
  if (data.id === undefined) return new Response(null, { status: 202 });
  const { id, method, params = {} } = data;
  try {
    if (method === "initialize") return json({ jsonrpc: "2.0", id, result: { protocolVersion: mcpVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "trazzo-readonly", version: "0.1.0" } } });
    if (method === "ping") return json({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools } });
    if (method === "tools/call") {
      if (typeof params.name !== "string" || (params.arguments != null && (typeof params.arguments !== "object" || Array.isArray(params.arguments)))) return json(error(id, -32602, "Invalid tool arguments"));
      return json({ jsonrpc: "2.0", id, result: await callTool(params.name, params.arguments || {}) });
    }
    return json(error(id, -32601, "Method not found"));
  } catch (e) {
    // Do not leak Firestore errors, service credentials, or stack traces into the MCP client.
    console.error("Trazo MCP request failed:", e?.message);
    return json({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: "La consulta no pudo completarse. Revisa la configuración del servidor." }] } });
  }
}
// Vercel Node.js Functions entrypoint (Node req/res, not Fetch API).
export default async function vercelHandler(req, res) {
  try {
    const base = process.env.TRAZZO_MCP_PUBLIC_URL;
    if (!base) {
      res.statusCode = 503;
      return res.end(JSON.stringify({ error: "Connector not configured" }));
    }
    const url = new URL(req.url || "/mcp", base);
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers || {})) {
      if (typeof value === "string") headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(", "));
    }
    const body = req.method === "POST"
      ? (typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? null))
      : undefined;
    const response = await handler(new Request(url, { method: req.method, headers, body }));
    res.statusCode = response.status;
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.end(await response.text());
  } catch (e) {
    console.error("MCP transport error:", e?.message);
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Transport error" }));
  }
}
