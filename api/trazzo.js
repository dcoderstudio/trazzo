'use strict';
const {config,services}=require('../server/config.cjs');
const {BridgeError,taskService}=require('../server/task-service.cjs');
const {oauthService}=require('../server/oauth.cjs');
const {consentPage}=require('../server/consent.cjs');
function json(res,status,data) {res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));}
function parseBody(req) {
  const value=req.body;
  if(value==null) return {};
  if(typeof value==='object' && !Buffer.isBuffer(value)) {if(JSON.stringify(value).length>16384)throw new BridgeError('too_large','Solicitud demasiado grande.',413);return value;}
  const text=Buffer.isBuffer(value)?value.toString():String(value);
  if(text.length>16384)throw new BridgeError('too_large','Solicitud demasiado grande.',413);
  return (req.headers['content-type']||'').includes('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(text)):JSON.parse(text);
}
function requireMethod(req,res,method) {if(req.method!==method){res.setHeader('Allow',method);throw new BridgeError('method_not_allowed','Método no permitido.',405);}}
module.exports=async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  let cfg;
  try {
    cfg=config();
    const requestURL=new URL(req.url,cfg.origin);
    const route=req.query?.route || requestURL.searchParams.get('route');
    if(route==='resource') {requireMethod(req,res,'GET');return json(res,200,{resource:cfg.resource,authorization_servers:[cfg.origin],scopes_supported:['tasks:read','tasks:write']});}
    if(route==='metadata') {requireMethod(req,res,'GET');return json(res,200,{issuer:cfg.origin,authorization_endpoint:cfg.origin+'/oauth/authorize',token_endpoint:cfg.origin+'/oauth/token',revocation_endpoint:cfg.origin+'/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],code_challenge_methods_supported:['S256'],token_endpoint_auth_methods_supported:['none'],scopes_supported:['tasks:read','tasks:write'],authorization_response_iss_parameter_supported:true});}
    const {db,auth}=services();const oauth=oauthService(db,auth,cfg);
    if(route==='authorize') {
      requireMethod(req,res,'GET');
      const query={...Object.fromEntries(requestURL.searchParams),...req.query};
      const {session,scope}=await oauth.begin(query);
      const page=consentPage(scope);
      res.setHeader('Set-Cookie','__Secure-trazzo_consent='+session+'; HttpOnly; Secure; SameSite=Lax; Path=/oauth; Max-Age=600');
      res.setHeader('Content-Security-Policy',`default-src 'none'; script-src 'nonce-${page.nonce}' https://www.gstatic.com; style-src 'nonce-${page.nonce}'; connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com; frame-src https://*.firebaseapp.com; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
      res.setHeader('Content-Type','text/html; charset=utf-8');res.statusCode=200;return res.end(page.html);
    }
    if(route==='approve') {
      requireMethod(req,res,'POST');
      if(req.headers.origin!==cfg.origin || !(req.headers['content-type']||'').includes('application/json'))throw new BridgeError('access_denied','Origen inválido.',403);
      const session=(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('__Secure-trazzo_consent='))?.split('=')[1];
      const redirect=await oauth.approve(session,parseBody(req).idToken);
      res.setHeader('Set-Cookie','__Secure-trazzo_consent=; HttpOnly; Secure; SameSite=Lax; Path=/oauth; Max-Age=0');
      return json(res,200,{redirect});
    }
    if(route==='token') {requireMethod(req,res,'POST');return json(res,200,await oauth.exchange(parseBody(req)));}
    if(route==='revoke') {requireMethod(req,res,'POST');const b=parseBody(req);await oauth.revoke(b.token,b.client_id);return json(res,200,{});}
    if(route==='mcp') {
      if(req.headers.origin && req.headers.origin!==cfg.origin)throw new BridgeError('access_denied','Origen inválido.',403);
      const header=req.headers.authorization||'';
      const token=header.startsWith('Bearer ')?header.slice(7):null;
      await oauth.authenticate(token);
      if(req.method!=='POST') {res.setHeader('Allow','POST');return json(res,405,{error:'method_not_allowed'});}
      const {handleMcp}=require('../server/mcp.cjs');
      return await handleMcp(req,res,parseBody(req),oauth,taskService(db,{writesEnabled:cfg.writesEnabled}),token);
    }
    return json(res,404,{error:'not_found'});
  }catch(e){
    if(res.headersSent)return res.end();
    if(e.status===401 && cfg)res.setHeader('WWW-Authenticate',`Bearer resource_metadata="${cfg.origin}/.well-known/oauth-protected-resource"`);
    return json(res,e.status||503,{error:e.code||'service_unavailable',error_description:e.code?e.message:'La conexión necesita configuración o está temporalmente indisponible.'});
  }
};
