'use strict';
const {randomBytes}=require('node:crypto');
function consentPage(scope,env=process.env) {
  const raw=JSON.parse(env.FIREBASE_WEB_CONFIG_JSON||'{}');
  const config={};
  for(const k of ['apiKey','authDomain','projectId','appId']) {if(typeof raw[k]!=='string') throw new Error('Firebase web config missing');config[k]=raw[k];}
  const nonce=randomBytes(16).toString('base64');
  const encoded=JSON.stringify(config).replace(/</g,'\\u003c');
  const permissions=scope.includes('tasks:write')?'Consultar pendientes y crear tareas con fecha.':'Consultar pendientes.';
  return {nonce,html:`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar Trazzo</title>
<style nonce="${nonce}">body{background:#101321;color:#fff;font:16px system-ui;margin:0;padding:32px}main{max-width:480px;margin:8vh auto;padding:28px;border:1px solid #384154;border-radius:20px}button{padding:12px 18px;margin:8px 0;border-radius:8px;border:0;font:inherit;cursor:pointer}button:disabled{opacity:.5}p{line-height:1.6}#status{white-space:pre-wrap}a{color:#a8ceff}</style></head><body><main><h1>Conectar Trazzo con ChatGPT</h1><p>${permissions}</p><p>Se usarán los pendientes compartidos del estudio. Solo pueden autorizar esta conexión los miembros del equipo.</p><button id="login">Elegir cuenta de Google</button><p id="account"></p><button id="approve" disabled>Autorizar conexión</button><p id="status" role="status"></p><p>Puedes cerrar esta ventana para cancelar.</p></main>
<script nonce="${nonce}" src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script><script nonce="${nonce}" src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
<script nonce="${nonce}">
firebase.initializeApp(${encoded});
const auth=firebase.auth(), status=document.getElementById('status'), approve=document.getElementById('approve');
auth.onAuthStateChanged(u=>{document.getElementById('account').textContent=u?u.email:'';approve.disabled=!u;});
document.getElementById('login').onclick=async()=>{try{const provider=new firebase.auth.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await auth.signInWithPopup(provider);status.textContent='Revisa los permisos y pulsa Autorizar conexión.';}catch(e){status.textContent='No se pudo iniciar sesión. Verifica que este dominio esté autorizado en Firebase.';}};
approve.onclick=async()=>{approve.disabled=true;status.textContent='Conectando…';try{const idToken=await auth.currentUser.getIdToken(true);const r=await fetch('/oauth/approve',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({idToken})});const data=await r.json();if(!r.ok)throw new Error(data.error_description||'No se pudo autorizar');location.assign(data.redirect);}catch(e){status.textContent=e.message;approve.disabled=false;}};
</script></body></html>`};
}
module.exports={consentPage};
