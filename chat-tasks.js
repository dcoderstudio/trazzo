(function(root){
  'use strict';
  var DEFAULT_AREAS=['Campo','Logística','Diseño','Dirección','Administración','Taller'];
  function norm(v){return String(v||'').trim().normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ');}
  function empty(v){return !v||['-','sin asignar','sin area','sin fecha','sin proyecto','otros'].includes(norm(v));}
  function resolve(value,list,label,line){
    if(empty(value))return null;
    var matches=list.filter(function(x){return norm(x.name)===norm(value);});
    if(matches.length!==1)throw Error('Línea '+line+': '+label+' “'+value+'” '+(matches.length?'es ambiguo.':'no existe.'));
    return matches[0];
  }
  function activeProjectsOf(data){
    return (data.projects||[]).filter(function(p){return p.catId!=='cotizaciones'&&!p.concluded&&!p.pendingApproval&&!p.quoteArchived;});
  }
  function key(t){return JSON.stringify([norm(t.text),t.deadline||'',String(t.resp||''),norm(t.area),String(t.projId||'')]);}
  function parse(text,data){
    if(typeof text!=='string'||text.length>60000)throw Error('El bloque es demasiado grande. Máximo 100 tareas.');
    var members=data.teamMembers||[],areas=(data.workAreas&&data.workAreas.length?data.workAreas:DEFAULT_AREAS.map(function(name){return {name:name};}));
    var activeProjects=activeProjectsOf(data);
    var seen=new Set((data.standaloneTasks||[]).map(function(t){return key(t);}));
    activeProjects.forEach(function(p){
      ((p.stageTasks&&p.stageTasks[p.stage])||[]).forEach(function(t){seen.add(key(Object.assign({},t,{projId:p.id})));});
    });
    var tasks=[],errors=[];
    text.split(/\r?\n/).forEach(function(raw,i){
      var line=raw.trim();if(!line||/^```(?:text|txt)?$/.test(line))return;
      var parts=line.split('|').map(function(p){return p.trim();});
      if(parts.length===6&&norm(parts[0])==='tarea'&&norm(parts[1])==='fecha'&&norm(parts[2])==='responsable'&&norm(parts[3])==='area')return;
      try{
        if(parts.length!==6)throw Error('Línea '+(i+1)+': usa Tarea | AAAA-MM-DD | Responsable | Área | Proyecto | Prioritaria.');
        var title=parts[0],date=empty(parts[1])?null:parts[1];
        if(!title||title.length>500)throw Error('Línea '+(i+1)+': el nombre debe tener entre 1 y 500 caracteres.');
        if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date))throw Error('Línea '+(i+1)+': fecha inválida. Usa AAAA-MM-DD, no “viernes” ni “mañana”.');
        var member=resolve(parts[2],members,'el responsable',i+1),area=resolve(parts[3],areas,'el área',i+1);
        var project=resolve(parts[4],activeProjects,'el proyecto',i+1);
        var priority=['si','x','true','1','yes'].indexOf(norm(parts[5]))!==-1;
        var t={text:title,deadline:date,resp:member?member.id:null,area:area?area.name:null,projId:project?project.id:null,projName:project?project.name:null,priority:priority};
        var signature=key(t);t.duplicate=seen.has(signature);seen.add(signature);tasks.push(t);
      }catch(e){errors.push(e.message);}
    });
    if(tasks.length>100)errors.push('Máximo 100 tareas por bloque.');
    if(!tasks.length&&!errors.length)errors.push('Pega al menos una tarea.');
    return {tasks:tasks,errors:errors};
  }
  async function save(db,doc,text,ids){
    return db.runTransaction(async function(tx){
      var snap=await tx.get(doc);if(!snap.exists)throw Error('No se encontró el espacio de trabajo.');
      var data=snap.data(),result=parse(text,data);
      if(result.errors.length)throw Error(result.errors.join('\n'));
      var addedStandalone=[],projectAdds={},created=0,skipped=0;
      result.tasks.forEach(function(t,i){
        if(t.duplicate){skipped++;return;}
        if(!ids[i])throw Error('Vuelve a revisar el bloque antes de guardarlo.');
        var task={id:ids[i],text:t.text,deadline:t.deadline,resp:t.resp,area:t.area,done:false,colStatus:null,priority:t.priority,notes:'',sortOrder:null};
        if(t.projId){
          task.sharedWithTeam=true;
          (projectAdds[t.projId]=projectAdds[t.projId]||[]).push(task);
        } else {
          addedStandalone.push(task);
        }
        created++;
      });
      var projects=(data.projects||[]).map(function(p){
        if(!projectAdds[p.id])return p;
        var st=Object.assign({},p.stageTasks||{});
        st[p.stage]=(st[p.stage]||[]).concat(projectAdds[p.id]);
        return Object.assign({},p,{stageTasks:st});
      });
      var allStandalone=(data.standaloneTasks||[]).concat(addedStandalone);
      var updates={};
      if(addedStandalone.length)updates.standaloneTasks=allStandalone;
      if(Object.keys(projectAdds).length)updates.projects=projects;
      if(Object.keys(updates).length)tx.update(doc,updates);
      return {created:created,skipped:skipped,tasks:allStandalone};
    });
  }
  function open(options){
    if(document.getElementById('chat-tasks-dialog'))return;
    var previous=document.activeElement,dlg=document.createElement('dialog');dlg.id='chat-tasks-dialog';dlg.className='chat-tasks-dialog';dlg.setAttribute('aria-labelledby','chat-tasks-title');
    function el(tag,text,parent){var n=document.createElement(tag);if(text)n.textContent=text;(parent||dlg).appendChild(n);return n;}
    el('h2','Agregar tareas desde chat').id='chat-tasks-title';
    el('p','Pega el bloque preparado en el chat. Revisa las fechas, los responsables y los proyectos antes de crear las tareas. Sin proyecto, se agregan como tareas libres; con proyecto, aparecen dentro de esa ficha (y en Equipo).');
    var guide=el('details');el('summary','Formato y nombres disponibles',guide);
    el('p','Una tarea por línea: Tarea | Fecha | Responsable | Área | Proyecto | Prioritaria. Fecha: AAAA-MM-DD. Usa - para dejar un campo sin asignar (Proyecto: - o "Otros" = tarea libre). Prioritaria: escribe Sí para marcarla como prioritaria, o - / No para dejarla normal. El nombre del proyecto debe coincidir exactamente con uno de los activos de abajo. No uses | dentro del nombre.',guide);
    var names=el('p','Cargando equipo…',guide);
    var label=el('label','Bloque de tareas');label.htmlFor='chat-tasks-input';
    var input=el('textarea');input.id=label.htmlFor;input.rows=7;input.maxLength=60000;input.placeholder='Tarea | Fecha | Responsable | Área | Proyecto | Prioritaria\nPreparar propuesta | 2026-09-25 | - | Diseño | Boda Fernández | Sí';
    var status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    var preview=el('div');preview.className='chat-tasks-preview';
    var actions=el('div');actions.className='chat-tasks-actions';
    var cancel=el('button','Cerrar',actions),review=el('button','Revisar tareas',actions),create=el('button','Crear tareas',actions);create.className='chat-tasks-primary';create.disabled=true;review.disabled=true;
    var ready=false,busy=false,reviewed=null,ids=[];
    function lock(value){busy=value;input.disabled=value;cancel.disabled=value;review.disabled=value||!ready;create.disabled=value||!reviewed;}
    function close(){if(busy)return;dlg.close();dlg.remove();if(previous&&previous.isConnected)previous.focus();}
    cancel.onclick=close;dlg.addEventListener('cancel',function(e){e.preventDefault();close();});
    input.oninput=function(){reviewed=null;create.disabled=true;preview.replaceChildren();status.textContent='';};
    async function read(){var snap=await options.doc.get({source:'server'});if(!snap.exists)throw Error('No se encontró el espacio de trabajo.');return snap.data();}
    function showNames(d){
      var projNames=activeProjectsOf(d).map(function(p){return p.name;});
      names.textContent='Responsables: '+(d.teamMembers||[]).map(function(m){return m.name;}).join(', ')+
        '. Áreas: '+(d.workAreas&&d.workAreas.length?d.workAreas.map(function(a){return a.name;}):DEFAULT_AREAS).join(', ')+
        '. Proyectos activos: '+(projNames.length?projNames.join(', '):'ninguno por ahora')+'.';
    }
    review.onclick=async function(){
      lock(true);reviewed=null;preview.replaceChildren();status.textContent='Revisando…';
      try{
        var data=await read();showNames(data);var result=parse(input.value,data);
        if(result.errors.length)throw Error(result.errors.join('\n'));
        var table=el('table','',preview),head=el('tr','',el('thead','',table));
        ['Tarea','Fecha','Responsable','Área','Proyecto','Prioritaria','Resultado'].forEach(function(v){el('th',v,head);});
        var body=el('tbody','',table);
        result.tasks.forEach(function(t){var row=el('tr','',body),m=(data.teamMembers||[]).find(function(m){return m.id===t.resp;});[t.text,t.deadline||'Sin fecha',m?m.name:'Sin asignar',t.area||'Sin área',t.projName||'Tarea libre',t.priority?'★ Sí':'No',t.duplicate?'Se omitirá: idéntica':'Nueva'].forEach(function(v){el('td',v,row);});});
        var count=result.tasks.filter(function(t){return !t.duplicate;}).length;
        status.textContent=count+' tareas nuevas; '+(result.tasks.length-count)+' idénticas se omitirán. Las fechas se muestran como año-mes-día.';
        if(count){reviewed=input.value;ids=result.tasks.map(function(t){return (t.projId?'pt_':'st_')+crypto.randomUUID();});create.textContent='Crear '+count+' tareas';}
      }catch(e){status.textContent=e.message||'No se pudo revisar. Comprueba la conexión.';}finally{lock(false);}
    };
    create.onclick=async function(){
      if(busy||!reviewed||input.value!==reviewed)return;
      lock(true);status.textContent='Guardando tareas…';
      try{
        var result=await save(options.db,options.doc,reviewed,ids);
        reviewed=null;preview.replaceChildren();input.value='';
        status.textContent='Guardado confirmado: '+result.created+' tareas creadas; '+result.skipped+' idénticas omitidas.';
        if(options.onSaved)options.onSaved(result.tasks);
      }catch(e){status.textContent='No se pudo confirmar el guardado. Puedes reintentar sin duplicar tareas. '+(e.message||'');}finally{lock(false);}
    };
    document.body.appendChild(dlg);dlg.showModal();input.focus();
    read().then(function(d){showNames(d);ready=true;review.disabled=false;}).catch(function(){names.textContent='No se pudo cargar el equipo. Al revisar se intentará de nuevo.';ready=true;review.disabled=false;});
  }
  var api={parse:parse,save:save,open:open};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TrazzoChatTasks=api;
})(typeof window!=='undefined'?window:this);
