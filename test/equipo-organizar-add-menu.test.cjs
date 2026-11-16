const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');
function page(){
 let data={projects:[],standaloneTasks:[],teamMembers:[],workAreas:[]};
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

test('organizar left panel: consolidated "+ Agregar" menu replaces the three stacked buttons',async()=>{
 const h=page();await tick();const d=h.w.document;
 h.w._dashTab='organizar';h.w.renderDashboard();

 const lp=d.querySelector('.eq-org-left-panel');
 assert.ok(lp,'left panel should render');

 // The old full-width buttons are gone.
 const oldLabels=['Nueva tarea','Agregar tareas desde chat','📦 Nueva entrega'];
 const lpButtons=[...lp.querySelectorAll('button')].map(b=>b.textContent.trim());
 for(const label of oldLabels)assert.ok(!lpButtons.some(t=>t===label||t.endsWith(label)),'old button "'+label+'" should no longer render as its own full-width button');

 // Exactly one consolidated add button.
 const addBtns=lp.querySelectorAll('.eq-org-add-btn');
 assert.equal(addBtns.length,1);
 const addBtn=addBtns[0];
 assert.ok(!lp.querySelector('.eq-org-add-popup'),'popup closed initially');

 // Opening reveals the three options in order.
 addBtn.click();
 let popup=lp.querySelector('.eq-org-add-popup');
 assert.ok(popup,'popup should open on click');
 let opts=[...popup.querySelectorAll('.eq-org-add-opt')];
 assert.equal(opts.length,3);
 assert.ok(opts[0].textContent.includes('Nueva tarea'));
 assert.ok(opts[1].textContent.includes('chat'));
 assert.ok(opts[2].textContent.includes('Nueva entrega'));

 // Clicking the button again while open closes it.
 addBtn.click();
 assert.ok(!lp.querySelector('.eq-org-add-popup'),'second click on the button toggles the popup closed');

 // Option 1 -> showNewTaskModal()
 let calledNewTask=false;h.w.showNewTaskModal=()=>{calledNewTask=true;};
 addBtn.click();
 lp.querySelector('.eq-org-add-popup .eq-org-add-opt:nth-child(1)').click();
 assert.ok(calledNewTask,'first option should call showNewTaskModal');
 assert.ok(!lp.querySelector('.eq-org-add-popup'),'popup closes after choosing an option');

 // Option 2 -> TrazzoChatTasks.open({...})
 let chatOpenArgs=null;h.w.TrazzoChatTasks.open=(args)=>{chatOpenArgs=args;};
 addBtn.click();
 lp.querySelector('.eq-org-add-popup .eq-org-add-opt:nth-child(2)').click();
 assert.ok(chatOpenArgs,'second option should call TrazzoChatTasks.open');
 assert.equal(typeof chatOpenArgs.onSaved,'function');

 // Option 3 -> showNewDeliveryModal()
 let calledDelivery=false;h.w.showNewDeliveryModal=()=>{calledDelivery=true;};
 addBtn.click();
 lp.querySelector('.eq-org-add-popup .eq-org-add-opt:nth-child(3)').click();
 assert.ok(calledDelivery,'third option should call showNewDeliveryModal');

 // Clicking outside the menu closes it without triggering anything.
 addBtn.click();
 assert.ok(lp.querySelector('.eq-org-add-popup'),'popup open before outside click');
 await tick();
 d.body.dispatchEvent(new h.w.MouseEvent('mousedown',{bubbles:true}));
 assert.ok(!lp.querySelector('.eq-org-add-popup'),'outside click should close the popup');

 // Express quick-add bar is untouched.
 const expInp=lp.querySelector('.eq-org-new-inp');
 assert.ok(expInp,'express input should still be present');
 assert.equal(expInp.placeholder,'Tarea rápida... (Enter)');

 assert.deepEqual(h.errors,[]);
 h.dom.window.close();
});
