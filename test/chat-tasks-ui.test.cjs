const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../chat-tasks.js'),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
function setup(){
 const dom=new JSDOM('<!doctype html><body><button id="opener">Abrir</button></body>',{runScripts:'dangerously',url:'https://example.test'});
 const w=dom.window;w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.eval(source);
 let data={teamMembers:[{id:'g',name:'Gon'}],workAreas:[{name:'Diseño'}],standaloneTasks:[],untouched:{x:1}},fail=false,writes=0;
 const doc={get:async()=>({exists:true,data:()=>structuredClone(data)})};
 const db={runTransaction:async(fn)=>{if(fail)throw Error('permission-denied');return fn({get:doc.get,update:(_,patch)=>{data={...data,...patch};writes++;}});}};
 w.TrazzoChatTasks.open({db,doc});
 return {dom,w,doc,get data(){return data;},get writes(){return writes;},set fail(v){fail=v;},button:(name)=>[...w.document.querySelectorAll('button')].find(b=>b.textContent===name)};
}
test('paste, preview, safe rendering, confirmed save, repeat paste and recoverable failure',async()=>{
 const h=setup();await tick();const input=h.w.document.querySelector('textarea');
 input.value='<img src=x onerror=alert(1)> | 2026-09-25 | Gon | Diseño\nOtra | - | - | -';
 h.button('Revisar tareas').click();await tick();assert.equal(h.w.document.querySelectorAll('tbody tr').length,2);assert.equal(h.w.document.querySelectorAll('img').length,0);
 h.fail=true;h.button('Crear 2 tareas').click();await tick();assert.match(h.w.document.querySelector('[role=status]').textContent,/No se pudo confirmar/);assert.equal(h.writes,0);assert.ok(input.value);
 h.fail=false;h.button('Crear 2 tareas').click();h.button('Crear 2 tareas').click();await tick();assert.equal(h.data.standaloneTasks.length,2);assert.equal(h.writes,1);assert.match(h.w.document.querySelector('[role=status]').textContent,/Guardado confirmado/);assert.deepEqual(h.data.untouched,{x:1});
 input.value='Otra | - | - | -';input.dispatchEvent(new h.w.Event('input'));h.button('Revisar tareas').click();await tick();assert.match(h.w.document.querySelector('[role=status]').textContent,/0 tareas nuevas/);assert.ok(h.w.document.querySelector('.chat-tasks-primary').disabled);h.dom.window.close();
});
test('all-or-nothing validation and editing invalidates preview',async()=>{
 const h=setup();await tick();const input=h.w.document.querySelector('textarea');input.value='A | 2026-02-30 | Gon | Diseño\nB | - | - | -';h.button('Revisar tareas').click();await tick();assert.ok(h.w.document.querySelector('.chat-tasks-primary').disabled);assert.equal(h.writes,0);
 input.value='B | - | - | -';h.button('Revisar tareas').click();await tick();assert.equal(h.w.document.querySelector('.chat-tasks-primary').disabled,false);input.value='Changed';input.dispatchEvent(new h.w.Event('input'));assert.ok(h.w.document.querySelector('.chat-tasks-primary').disabled);h.dom.window.close();
});
