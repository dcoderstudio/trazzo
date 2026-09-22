'use strict';
const {BridgeError}=require('./task-service.cjs');
const ALLOWED_EMAILS=['dcoderstudio@gmail.com','gonzonaveda@gmail.com','proyectos@dcoderstudio.com','ale@dcoderstudio.com','gonzalo@dcoderstudio.com'];
function config(env=process.env) {
  if(env.TRAZZO_BRIDGE_ENABLED!=='true') throw new BridgeError('not_configured','Conexión pendiente de activación.',503);
  const origin=new URL(env.TRAZZO_BRIDGE_ORIGIN);
  if(origin.protocol!=='https:' || origin.pathname!=='/' || origin.search || origin.hash) throw new Error('Invalid bridge origin');
  const redirects=JSON.parse(env.TRAZZO_OAUTH_REDIRECT_URIS || '[]');
  if(!Array.isArray(redirects) || !redirects.length || redirects.some(r=>typeof r!=='string'||new URL(r).protocol!=='https:')) throw new Error('Exact HTTPS redirect allowlist required');
  return {origin:origin.origin,resource:origin.origin+'/mcp',clientId:'trazzo-chatgpt',redirects,allowedEmails:ALLOWED_EMAILS,writesEnabled:env.TRAZZO_TASK_WRITES_ENABLED==='true'};
}
function services() {
  const {getApps,initializeApp,cert}=require('firebase-admin/app');
  const {getFirestore}=require('firebase-admin/firestore');
  const {getAuth}=require('firebase-admin/auth');
  let app=getApps().find(a=>a.name==='trazzo-bridge');
  if(!app) {
    const credentials=JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
    if(!credentials.project_id || !credentials.private_key || !credentials.client_email) throw new Error('Firebase server credentials missing');
    app=initializeApp({credential:cert(credentials)},'trazzo-bridge');
  }
  return {db:getFirestore(app),auth:getAuth(app)};
}
module.exports={config,services,ALLOWED_EMAILS};
