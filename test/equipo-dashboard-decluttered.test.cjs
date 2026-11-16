const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
function page(){
 let data={projects:[],standaloneTasks:[{id:'t1',text:'Tarea de hoy',resp:null,area:null,deadline:'2026-09-25',done:false}],teamMembers:[{id:'G',name:'Gon',area:'Diseño',color:'#336699'}],workAreas:[{id:'design',name:'Diseño',color:'#336699'}]};
 const errors=[];
 let html=fs.readFileSync(path.join(root,'equipo.html'),'utf8').replace(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g,(_,src)=>['equipo-mobile.js','chat-tasks.js'].includes(src)?'<script>'+fs.readFileSync(path.join(root,src),'utf8')+'</script>':'');
 const dom=new JSDOM(html,{runScripts:'dangerously',url:'https://test.invalid/equipo.html',pretendToBeVisual:true,beforeParse(w){
  w.matchMedia=()=>({matches:false,addEventListener(){}});
  w.addEventListener('error',e=>errors.push(e.error));
  const doc={onSnapshot(cb){Promise.resolve().then(()=>cb({exists:true,data:()=>data}));},set(p){data={...data,...p};return Promise.resolve();}};
  w.firebase={initializeApp(){},firestore:()=>({collection:()=>({doc:()=>doc})}),auth:()=>({onAuthStateChanged(cb){Promise.resolve().then(()=>cb({email:'dcoderstudio@gmail.com'}));}})};
 }});
 return {dom,w:dom.window,errors};
}
const tick=()=>new Promise(r=>setImmediate(r));

test('equipo landing page: logo removed, left panel decluttered, default tab is Hoy/Todas',async()=>{
 const h=page();await tick();const d=h.w.document;

 assert.equal(d.querySelector('.logo'),null,'the Dcoder Studio logo should no longer render in the nav bar');

 const left=d.querySelector('.eq-left');
 assert.ok(left,'left panel should still exist');
 const statsGrid=left.querySelector('.eq-left-top');
 assert.ok(statsGrid,'old Resumen stats block stays in the DOM (other code still writes to it)');
 assert.equal(h.w.getComputedStyle(statsGrid).display,'none','Resumen stats block should be hidden');
 const viewToggle=left.querySelector('.eq-view-toggle');
 assert.ok(viewToggle,'old Equipo/Por área toggle stays in the DOM');
 assert.equal(h.w.getComputedStyle(viewToggle).display,'none','Equipo/Por área toggle should be hidden');
 assert.ok(left.querySelector('#eqTeamList'),'compact member list should still render for selecting a person');
 assert.ok(left.querySelector('#eqAddBtn'),'add-member button should still be present');

 assert.equal(h.w._dashTab,'hoy','default dashboard tab should be Hoy');
 assert.equal(h.w._orgGroupBy,'general','default grouping should be Todas (general)');
 const activeTab=[...d.querySelectorAll('.eq-dash-tabs .eq-tab')].find(b=>b.className.includes('active'));
 assert.ok(activeTab&&activeTab.textContent.includes('Hoy'),'Hoy tab should render as the active tab on load');
 const activeGroup=[...d.querySelectorAll('.eq-org-groupbtn')].find(b=>b.className.includes('active'));
 assert.ok(activeGroup&&activeGroup.textContent.includes('Todas'),'Todas should render as the active "Ver por" option on load');

 assert.deepEqual(h.errors,[]);
 h.dom.window.close();
});
