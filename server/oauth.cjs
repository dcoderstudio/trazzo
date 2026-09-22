'use strict';
const {randomBytes,createHash}=require('node:crypto');
const {BridgeError,hash}=require('./task-service.cjs');
const random=()=>randomBytes(32).toString('base64url');
function oauthService(db,auth,cfg,{clock=()=>Date.now()}={}) {
  const ref=(kind,token)=>db.doc('trazzoBridgeOAuth/'+kind+'_'+hash(token));
  function scopeValue(value) {
    const scopes=String(value||'tasks:read').split(' ').filter(Boolean);
    if(!scopes.length || scopes.some(s=>!['tasks:read','tasks:write'].includes(s))) throw new BridgeError('invalid_scope','Permiso no admitido.');
    return [...new Set(scopes)].join(' ');
  }
  async function member(uid) {
    const user=await auth.getUser(uid);
    if(user.disabled || !user.emailVerified || !cfg.allowedEmails.includes(user.email)) throw new BridgeError('access_denied','Cuenta no autorizada.',403);
    return user;
  }
  function tokenRecord(uid,scope,clientId,grantId,expiresAt) {return {uid,scope,clientId,grantId,resource:cfg.resource,expiresAt};}
  return {
    async begin(params) {
      if(params.client_id!==cfg.clientId || !cfg.redirects.includes(params.redirect_uri)) throw new BridgeError('invalid_client','Cliente o dirección de retorno no autorizados.');
      if(params.response_type!=='code' || params.resource!==cfg.resource || params.code_challenge_method!=='S256' || !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge||'')) throw new BridgeError('invalid_request','Se requiere OAuth con PKCE S256 y recurso correcto.');
      if(typeof params.state!=='string'||params.state.length<1||params.state.length>1024) throw new BridgeError('invalid_request','Estado OAuth inválido.');
      const scope=scopeValue(params.scope);
      const session=random();
      await ref('consent',session).set({clientId:params.client_id,redirectUri:params.redirect_uri,challenge:params.code_challenge,state:params.state,scope,expiresAt:clock()+10*60*1000,used:false});
      return {session,scope};
    },
    async approve(session,idToken) {
      if(!session || typeof idToken!=='string') throw new BridgeError('invalid_request','Falta autorización.');
      const identity=await auth.verifyIdToken(idToken,true);
      await member(identity.uid);
      if(identity.email_verified!==true || !cfg.allowedEmails.includes(identity.email)) throw new BridgeError('access_denied','Cuenta no autorizada.',403);
      const code=random();
      return db.runTransaction(async tx=>{
        const consent=await tx.get(ref('consent',session));
        if(!consent.exists||consent.data().used||consent.data().expiresAt<=clock()) throw new BridgeError('invalid_request','La solicitud venció o ya fue utilizada.');
        const data=consent.data();
        tx.update(ref('consent',session),{used:true});
        tx.set(ref('code',code),{...data,uid:identity.uid,used:false,expiresAt:clock()+60*1000});
        const redirect=new URL(data.redirectUri);redirect.searchParams.set('code',code);redirect.searchParams.set('state',data.state);redirect.searchParams.set('iss',cfg.origin);
        return redirect.toString();
      });
    },
    async exchange(body) {
      if(body.client_id!==cfg.clientId || body.resource!==cfg.resource) throw new BridgeError('invalid_client','Cliente o recurso inválido.');
      const isCode=body.grant_type==='authorization_code';
      if(!isCode && body.grant_type!=='refresh_token') throw new BridgeError('unsupported_grant_type','Tipo de autorización no admitido.');
      const credential=isCode?body.code:body.refresh_token;
      if(typeof credential!=='string'||credential.length>512) throw new BridgeError('invalid_grant','Credencial inválida.');
      const source=ref(isCode?'code':'refresh',credential);
      const initial=await source.get();
      if(!initial.exists) throw new BridgeError('invalid_grant','Autorización inválida.');
      await member(initial.data().uid);
      const access=random(),refresh=random(),newGrant=random();
      const result=await db.runTransaction(async tx=>{
        const snap=await tx.get(source); const d=snap.exists?snap.data():null;
        if(!d||d.used||d.expiresAt<=clock()||d.clientId!==cfg.clientId) throw new BridgeError('invalid_grant','Autorización vencida o utilizada.');
        if(isCode) {
          if(body.redirect_uri!==d.redirectUri || !/^[A-Za-z0-9._~-]{43,128}$/.test(body.code_verifier||'')) throw new BridgeError('invalid_grant','Verificación inválida.');
          const challenge=createHash('sha256').update(body.code_verifier).digest('base64url');
          if(challenge!==d.challenge) throw new BridgeError('invalid_grant','Verificación inválida.');
        }
        const grantId=isCode?newGrant:d.grantId;
        const grantRef=ref('grant',grantId);
        const grant=isCode?null:await tx.get(grantRef);
        if(!isCode && (!grant.exists||grant.data().revoked||grant.data().expiresAt<=clock())) throw new BridgeError('invalid_grant','Conexión revocada o vencida.');
        const grantExpires=isCode?clock()+30*24*3600000:grant.data().expiresAt;
        tx.update(source,{used:true});
        if(isCode)tx.set(grantRef,{uid:d.uid,revoked:false,expiresAt:grantExpires});
        tx.set(ref('access',access),tokenRecord(d.uid,d.scope,cfg.clientId,grantId,Math.min(clock()+3600000,grantExpires)));
        tx.set(ref('refresh',refresh),{...tokenRecord(d.uid,d.scope,cfg.clientId,grantId,grantExpires),used:false});
        return {access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:Math.floor((Math.min(clock()+3600000,grantExpires)-clock())/1000),scope:d.scope};
      });
      return result;
    },
    async authenticate(token,scope) {
      if(typeof token!=='string'||token.length>512) throw new BridgeError('invalid_token','Inicia sesión para conectar Trazzo.',401);
      const snap=await ref('access',token).get(); const d=snap.exists?snap.data():null;
      if(!d||d.expiresAt<=clock()||d.resource!==cfg.resource||d.clientId!==cfg.clientId) throw new BridgeError('invalid_token','La conexión venció.',401);
      const grant=await ref('grant',d.grantId).get();
      if(!grant.exists||grant.data().revoked||grant.data().expiresAt<=clock()) throw new BridgeError('invalid_token','Conexión revocada.',401);
      if(scope && !d.scope.split(' ').includes(scope)) throw new BridgeError('insufficient_scope','Falta permiso para esta operación.',403);
      await member(d.uid);
      return {uid:d.uid,scope:d.scope};
    },
    async revoke(token,clientId) {
      if(clientId!==cfg.clientId) throw new BridgeError('invalid_client','Cliente inválido.');
      if(typeof token!=='string'||token.length>512) return;
      for(const kind of ['access','refresh']) {
        const snap=await ref(kind,token).get();
        if(snap.exists&&snap.data().clientId===clientId) await ref('grant',snap.data().grantId).update({revoked:true});
      }
    }
  };
}
module.exports={oauthService};
