'use strict';
const { createHash } = require('node:crypto');
class BridgeError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const hash = value => createHash('sha256').update(value).digest('hex');
function validateTask(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BridgeError('invalid_task','Datos de tarea inválidos.');
  if (Object.keys(input).some(k => !['requestId','text','deadline','responsibleId'].includes(k))) throw new BridgeError('invalid_task','Hay campos no admitidos.');
  if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(input.requestId)) throw new BridgeError('invalid_request_id','requestId debe ser un identificador estable de 16 a 100 caracteres.');
  if (typeof input.text !== 'string' || !input.text.trim() || input.text.trim().length > 500 || /[<>\x00-\x1f]/.test(input.text)) throw new BridgeError('invalid_text','Usa texto simple de 1 a 500 caracteres, sin etiquetas HTML.');
  if (typeof input.deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.deadline)) throw new BridgeError('invalid_date','Fecha requerida en formato AAAA-MM-DD.');
  const date = new Date(input.deadline + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== input.deadline) throw new BridgeError('invalid_date','La fecha no existe.');
  if (input.responsibleId != null && (typeof input.responsibleId !== 'string' || input.responsibleId.length > 100)) throw new BridgeError('invalid_member','Responsable inválido.');
  return { requestId:input.requestId, text:input.text.trim(), deadline:input.deadline, responsibleId:input.responsibleId || null };
}
function taskView(t) { return {id:t.id,text:t.text,deadline:t.deadline || null,responsibleId:t.resp || null,done:!!t.done}; }
function taskService(db, { writesEnabled = false, now = () => new Date().toISOString() } = {}) {
  const workspace = db.doc('workspace/proyectos');
  return {
    async list({limit=50,deadline=null}={}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new BridgeError('invalid_limit','Límite entre 1 y 100.');
      if (deadline !== null && (typeof deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deadline))) throw new BridgeError('invalid_date','Fecha inválida.');
      const snap=await workspace.get();
      if (!snap.exists) throw new BridgeError('workspace_missing','No existe el espacio de trabajo.',409);
      const tasks=(snap.data().standaloneTasks || []).filter(t=>!t.done && (!deadline || t.deadline===deadline));
      return {tasks:tasks.slice(0,limit).map(taskView),total:tasks.length,truncated:tasks.length>limit,scope:'standaloneTasks'};
    },
    async create(raw, actor) {
      if (!writesEnabled) throw new BridgeError('writes_disabled','La creación de tareas aún no está activada.',403);
      const input=validateTask(raw);
      const key=hash(actor.uid + ':' + input.requestId);
      const fingerprint=hash(JSON.stringify(input));
      const receipt=db.doc('trazzoBridgeOperations/'+key);
      const createdAt=now();
      const result=await db.runTransaction(async tx=>{
        const [ws,previous]=await Promise.all([tx.get(workspace),tx.get(receipt)]);
        if(previous.exists) {
          const saved=previous.data();
          if(saved.fingerprint!==fingerprint) throw new BridgeError('request_reused','Ese requestId ya se utilizó con otros datos.',409);
          return {task:saved.task,replayed:true};
        }
        if(!ws.exists) throw new BridgeError('workspace_missing','No existe el espacio de trabajo.',409);
        const data=ws.data();
        if(input.responsibleId && !(data.teamMembers||[]).some(m=>m.id===input.responsibleId)) throw new BridgeError('unknown_member','El responsable no existe.');
        const tasks=data.standaloneTasks || [];
        const task={id:'chat_'+key.slice(0,32),text:input.text,deadline:input.deadline,resp:input.responsibleId,area:null,done:false,colStatus:null,priority:false,doneAt:null,createdAt,createdBy:actor.uid,source:'chatgpt'};
        if(tasks.some(t=>t.id===task.id)) throw new BridgeError('id_conflict','Ya existe una tarea con ese identificador.',409);
        tx.update(workspace,{standaloneTasks:tasks.concat(task)});
        tx.set(receipt,{fingerprint,task:taskView(task),actorUid:actor.uid,createdAt,operation:'create_task'});
        return {task:taskView(task),replayed:false};
      });
      // Durable receipt and current state are both read back. A replay never resurrects a deleted task.
      const [proof,current]=await Promise.all([receipt.get(),workspace.get()]);
      if(!proof.exists || proof.data().fingerprint!==fingerprint) throw new BridgeError('verification_failed','No se pudo verificar el registro.',503);
      const live=(current.data()?.standaloneTasks||[]).find(t=>t.id===result.task.id);
      return {...result,presentNow:!!live,currentTask:live?taskView(live):null};
    }
  };
}
module.exports={BridgeError,hash,validateTask,taskService};
