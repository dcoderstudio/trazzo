const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
function page(mobile){
 let data={projects:[],standaloneTasks:[{id:'sample',text:'Tarea de prueba de pantalla pequeña',resp:null,area:null,deadline:'2026-09-25',done:false}],teamMembers:[{id:'G',name:'Gon',area:'Diseño',color:'#336699'}],workAreas:[{id:'design',name:'Diseño',color:'#336699'}]};
 const errors=[];let writes=0;
 let html=fs.readFileSync(path.join(root,'equipo.html'),'utf8').replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,(_,src)=>['equipo-mobile.js','chat-tasks.js'].includes(src)?'<script>'+fs.readFileSync(path.join(root,src),'utf8')+'</script>':'');
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://test.invalid/equipo.html',pretendToBeVisual:true,beforeParse(w){
  w.matchMedia=()=>({matches:mobile,addEventListener(){}});
  w.addEventListener('error',e=>errors.push(e.error));
  const doc={onSnapshot(cb){Promise.resolve().then(()=>cb({exists:true,data:()=>data}));},set(p){writes++;data={...data,...p};return Promise.resolve();}};
  w.firebase={initializeApp(){},firestore:()=>({collection:()=>({doc:()=>doc})}),auth:()=>({onAuthStateChanged(cb){Promise.resolve().then(()=>cb({email:'dcoderstudio@gmail.com'}));}})};
 }});
 return {dom,w:dom.window,errors,get writes(){return writes;},get data(){return data;}};
}
const tick=()=>new Promise(r=>setImmediate(r));
test('real mobile page: panels, selection, touch tap, task area edit and all dashboard tabs',async()=>{
 const h=page(true);await tick();const d=h.w.document;
 assert.ok(d.querySelector('.eq-org-task'));
 const people=d.getElementById('mobilePeople');people.click();assert.equal(people.getAttribute('aria-expanded'),'true');
 d.getElementById('mobileGoals').click();assert.equal(people.getAttribute('aria-expanded'),'false');
 people.click();d.querySelector('.eq-mrow').click();assert.equal(people.getAttribute('aria-expanded'),'false');
 h.w.showVistaGeneral();const card=d.querySelector('.eq-org-task');
 const e=new h.w.MouseEvent('pointerdown',{bubbles:true,cancelable:true,button:0});Object.defineProperty(e,'pointerType',{value:'touch'});card.dispatchEvent(e);assert.equal(e.defaultPrevented,false);assert.equal(d.querySelector('.eq-org-ghost'),null);
 card.click();assert.ok(d.querySelector('#taskEditOverlay'));d.getElementById('editTaskArea').value='Diseño';
 [...d.querySelectorAll('#taskEditOverlay button')].find(b=>b.textContent==='Guardar').click();assert.equal(h.data.standaloneTasks[0].area,'Diseño');assert.equal(h.writes,1);
 for(const tab of ['hoy','semana','tareas','organizar']){h.w._dashTab=tab;h.w.renderDashboard();assert.ok(d.getElementById('eqMain').children.length);}
 assert.deepEqual(h.errors,[]);
 if(process.env.MOBILE_FIXTURE_DIR){
  const main=d.getElementById('eqMain');main.replaceChildren();
  for(const kind of ['Hoy y prioridades','Semana']){
   const heading=d.createElement('h2');heading.textContent=kind;main.appendChild(heading);
   for(const [i,text] of ['Silvestre - Confirmación de ODC','Enviar render nuevo del reconocimiento Novo','Fumigación de la camioneta a las 12:00'].entries()){
    const task={id:'preview-'+i,text,deadline:'2026-09-23',member:{id:'G',name:'Gon',color:'#336699'},priority:i===1,color:'#5AB4E8'};
    main.appendChild(kind==='Semana'?h.w.buildTeamWeekCard(task):h.w.buildTeamHoyCard(task,i===1,{showTomorrow:true}));
   }
  }
  let snapshot=h.dom.serialize().replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/href="(chat-tasks.css|equipo-mobile.css)"/g,'href="../$1"');
  fs.writeFileSync(path.join(process.env.MOBILE_FIXTURE_DIR,'equipo-layout-fixture.html'),snapshot);
 }
 h.dom.window.close();
});
test('desktop initialization retains existing dashboard without data writes',async()=>{const h=page(false);await tick();assert.ok(h.w.document.querySelector('.eq-org-cols-wrap'));assert.equal(h.writes,0);assert.deepEqual(h.errors,[]);h.dom.window.close();});
