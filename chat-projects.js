(function(root){
  'use strict';
  function norm(v){return String(v||'').trim().normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/\s+/g,' ');}
  function empty(v){return !v||['-','sin asignar','sin cliente','sin fecha','sin monto','sin categoria','sin categoría','sin empresa'].includes(norm(v));}
  function resolve(value,list,label,line,getName){
    if(empty(value))return null;
    var matches=list.filter(function(x){return norm(getName(x))===norm(value);});
    if(matches.length!==1)throw Error('Línea '+line+': '+label+' “'+value+'” '+(matches.length?'es ambiguo.':'no existe.'));
    return matches[0];
  }
  function parse(text,data){
    if(typeof text!=='string'||text.length>20000)throw Error('El bloque es demasiado grande. Máximo 40 solicitudes.');
    var cats=(data.categories||[]).filter(function(c){return c.id!=='cotizaciones';});
    var members=data.teamMembers||[];
    var companies=data.companies||[];
    var items=[],errors=[];
    text.split(/\r?\n/).forEach(function(raw,i){
      var line=raw.trim();if(!line||/^```(?:text|txt)?$/.test(line))return;
      var parts=line.split('|').map(function(p){return p.trim();});
      if(parts.length===7&&norm(parts[0])==='nombre'&&norm(parts[2]).indexOf('categoria')===0)return; // fila de encabezado
      try{
        if(parts.length!==7)throw Error('Línea '+(i+1)+': usa Nombre | Cliente | Categoría | Empresa | Fecha límite | Monto | Responsable.');
        var name=parts[0];
        if(!name||name.length>200)throw Error('Línea '+(i+1)+': el nombre debe tener entre 1 y 200 caracteres.');
        var client=empty(parts[1])?null:parts[1];
        var cat=resolve(parts[2],cats,'la categoría',i+1,function(c){return c.label;});
        if(!cat)throw Error('Línea '+(i+1)+': la categoría es obligatoria (no puede ir “-”).');
        var co=resolve(parts[3],companies,'la empresa',i+1,function(c){return c.name;});
        var deadline=empty(parts[4])?null:parts[4];
        if(deadline&&(!/^\d{4}-\d{2}-\d{2}$/.test(deadline)||!Number.isFinite(Date.parse(deadline+'T12:00:00Z'))||new Date(deadline+'T12:00:00Z').toISOString().slice(0,10)!==deadline))throw Error('Línea '+(i+1)+': fecha inválida. Usa AAAA-MM-DD, no “viernes” ni “mañana”.');
        var monto=empty(parts[5])?'':parts[5];
        var member=resolve(parts[6],members,'el responsable',i+1,function(m){return m.name;});
        items.push({
          name:name,client:client||'—',tipoCatId:cat.id,tipoCatLabel:cat.label,
          empresaId:co?co.id:null,empresaName:co?co.name:'Sin empresa',
          deadline:deadline||'',monto:monto,resp:member?member.id:null,respName:member?member.name:'Sin asignar'
        });
      }catch(e){errors.push(e.message);}
    });
    if(items.length>40)errors.push('Máximo 40 solicitudes por bloque.');
    if(!items.length&&!errors.length)errors.push('Pega al menos una solicitud.');
    return {items:items,errors:errors};
  }
  function open(options){
    if(document.getElementById('chat-tasks-dialog'))return;
    var previous=document.activeElement,dlg=document.createElement('dialog');dlg.id='chat-tasks-dialog';dlg.className='chat-tasks-dialog';dlg.setAttribute('aria-labelledby','chat-projects-title');
    function el(tag,text,parent){var n=document.createElement(tag);if(text)n.textContent=text;(parent||dlg).appendChild(n);return n;}
    el('h2','Nueva solicitud de proyecto desde texto').id='chat-projects-title';
    el('p','Pega el bloque preparado (por ejemplo con ayuda de un chat). Cada línea genera una solicitud nueva en el kanban de Cotizaciones, en la primera fase.');
    var guide=el('details');el('summary','Formato y nombres disponibles',guide);
    el('p','Una solicitud por línea: Nombre | Cliente | Categoría | Empresa | Fecha límite | Monto | Responsable. Fecha: AAAA-MM-DD. Usa - para dejar un campo sin asignar (Categoría es obligatoria). No uses | dentro del texto.',guide);
    var names=el('p','',guide);
    var cats=(options.categories||[]).filter(function(c){return c.id!=='cotizaciones';});
    names.textContent='Categorías: '+cats.map(function(c){return c.label;}).join(', ')+'. Empresas: '+(options.companies||[]).map(function(c){return c.name;}).join(', ')+'. Responsables: '+(options.teamMembers||[]).map(function(m){return m.name;}).join(', ')+'.';
    var label=el('label','Bloque de solicitudes');label.htmlFor='chat-projects-input';
    var input=el('textarea');input.id=label.htmlFor;input.rows=7;input.maxLength=20000;
    input.placeholder='Nombre | Cliente | Categoría | Empresa | Fecha límite | Monto | Responsable\nPorta papeles Novo | Novo Nordisk | Branding | Dcoder Studio | 2026-10-15 | 12000 | -';
    var status=el('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    var preview=el('div');preview.className='chat-tasks-preview';
    var actions=el('div');actions.className='chat-tasks-actions';
    var cancel=el('button','Cerrar',actions),review=el('button','Revisar solicitudes',actions),create=el('button','Crear solicitudes',actions);create.className='chat-tasks-primary';create.disabled=true;
    var reviewed=null;
    function close(){dlg.close();dlg.remove();if(previous&&previous.isConnected)previous.focus();}
    cancel.onclick=close;dlg.addEventListener('cancel',function(e){e.preventDefault();close();});
    input.oninput=function(){reviewed=null;create.disabled=true;preview.replaceChildren();status.textContent='';};
    function dataFrom(){return {categories:options.categories||[],teamMembers:options.teamMembers||[],companies:options.companies||[]};}
    review.onclick=function(){
      preview.replaceChildren();status.textContent='';
      try{
        var result=parse(input.value,dataFrom());
        if(result.errors.length)throw Error(result.errors.join('\n'));
        var table=el('table','',preview),head=el('tr','',el('thead','',table));
        ['Nombre','Cliente','Categoría','Empresa','Fecha','Monto','Responsable'].forEach(function(v){el('th',v,head);});
        var body=el('tbody','',table);
        result.items.forEach(function(t){var row=el('tr','',body);[t.name,t.client,t.tipoCatLabel,t.empresaName,t.deadline||'Sin fecha',t.monto||'Sin monto',t.respName].forEach(function(v){el('td',v,row);});});
        status.textContent=result.items.length+' solicitud(es) lista(s) para crear.';
        reviewed=input.value;create.disabled=false;create.textContent='Crear '+result.items.length+' solicitud'+(result.items.length===1?'':'es');
      }catch(e){status.textContent=e.message||'No se pudo revisar el bloque.';}
    };
    create.onclick=function(){
      if(!reviewed||input.value!==reviewed)return;
      try{
        var result=parse(reviewed,dataFrom());
        if(result.errors.length)throw Error(result.errors.join('\n'));
        options.onCreate(result.items);
        close();
      }catch(e){status.textContent='No se pudo crear. '+(e.message||'');}
    };
    document.body.appendChild(dlg);dlg.showModal();input.focus();
  }
  var api={parse:parse,open:open};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TrazzoChatProjects=api;
})(typeof window!=='undefined'?window:this);
