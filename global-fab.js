(function(){
  'use strict';
  if (document.getElementById('gfabWrap')) return;

  var _db = null, _doc = null;
  function fsDoc() {
    if (!_doc) { _db = firebase.firestore(); _doc = _db.collection('workspace').doc('proyectos'); }
    return _doc;
  }

  // ── FAB BUTTON + MENU ──────────────────────────────────────────
  var wrap = document.createElement('div');
  wrap.id = 'gfabWrap';
  wrap.style.cssText = 'position:fixed;right:24px;bottom:24px;z-index:480;display:flex;flex-direction:column;align-items:flex-end;gap:10px;font-family:Inter,sans-serif;';

  var menu = document.createElement('div');
  menu.style.cssText = 'display:none;flex-direction:column;gap:5px;align-items:flex-end;';

  function sep(text) {
    var s = document.createElement('div');
    s.textContent = text;
    s.style.cssText = 'font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.3);padding:2px 8px 0;align-self:flex-end;';
    return s;
  }
  function item(label, fn) {
    var b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'background:#1C2840;border:.5px solid rgba(255,255,255,.12);color:rgba(255,255,255,.85);font-size:12px;font-weight:600;padding:9px 14px;border-radius:10px;cursor:pointer;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.4);font-family:inherit;transition:background .15s;';
    b.onmouseenter = function(){ b.style.background = '#243252'; };
    b.onmouseleave = function(){ b.style.background = '#1C2840'; };
    b.onclick = function(){ menu.style.display = 'none'; fn(); };
    return b;
  }

  menu.appendChild(sep('Tarea'));
  menu.appendChild(item('💬 Con chat', taskChatHandler));
  menu.appendChild(item('✏️ Manualmente', taskManualHandler));
  menu.appendChild(sep('Proyecto'));
  menu.appendChild(item('💬 Con chat', function(){ location.href = 'proyectos.html?fabAction=proj-chat'; }));
  menu.appendChild(item('✏️ Manualmente', function(){ location.href = 'proyectos.html?fabAction=proj-manual'; }));

  var btn = document.createElement('button');
  btn.title = 'Agregar';
  btn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>';
  btn.style.cssText = 'width:52px;height:52px;border-radius:50%;background:#1A6FD4;border:none;color:#fff;cursor:pointer;box-shadow:0 8px 24px rgba(26,111,212,.4);display:flex;align-items:center;justify-content:center;transition:transform .15s,background .15s;flex-shrink:0;';
  btn.onmouseenter = function(){ btn.style.background = '#1e7fe8'; btn.style.transform = 'scale(1.06)'; };
  btn.onmouseleave = function(){ btn.style.background = '#1A6FD4'; btn.style.transform = ''; };
  btn.onclick = function(){ menu.style.display = (menu.style.display === 'flex') ? 'none' : 'flex'; };

  document.addEventListener('click', function(e) {
    if (!e.target.closest('#gfabWrap')) menu.style.display = 'none';
  });

  wrap.appendChild(menu);
  wrap.appendChild(btn);
  document.body.appendChild(wrap);

  // ── TAREA: usa la UI propia de la página si existe (Equipo ya tiene
  // showNewTaskModal / TrazzoChatTasks bien integrados); si no, recurre
  // al modal genérico autosuficiente de abajo, que lee y escribe
  // directo en Firestore sin depender del estado local de la página ──
  function taskChatHandler() {
    if (typeof window.TrazzoChatTasks === 'undefined') { alert('El chat de tareas no está disponible en esta página todavía.'); return; }
    fsDoc();
    var db = window.db || _db;
    var doc = window.DOC || _doc;
    window.TrazzoChatTasks.open({ db: db, doc: doc, onSaved: function(){} });
  }
  function taskManualHandler() {
    if (typeof window.showNewTaskModal === 'function') { window.showNewTaskModal(); return; }
    openGenericTaskModal();
  }

  // ── MODAL GENÉRICO DE TAREA — autosuficiente, funciona en cualquier
  // página: lee datos frescos de Firestore y escribe con una
  // transacción, sin tocar el estado local de la página anfitriona ──
  var genOverlay = null;
  function buildGenericModal() {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(8px);z-index:9970;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = function(e){ if (e.target === overlay) closeGenericModal(); };
    var modal = document.createElement('div');
    modal.style.cssText = 'background:#141c2e;border:.5px solid rgba(255,255,255,.14);border-radius:14px;width:340px;padding:18px 18px 16px;box-shadow:0 24px 64px rgba(0,0,0,.85);font-family:Inter,sans-serif;';
    modal.onclick = function(e){ e.stopPropagation(); };

    function lbl(text) { var d = document.createElement('div'); d.textContent = text; d.style.cssText = 'font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:rgba(255,255,255,.3);margin-bottom:5px;margin-top:10px;'; return d; }

    var title = document.createElement('div'); title.textContent = 'Nueva tarea'; title.style.cssText = 'font-size:13px;font-weight:800;color:#fff;margin-bottom:4px;';
    var status = document.createElement('div'); status.style.cssText = 'font-size:9px;color:rgba(255,255,255,.28);margin-bottom:14px;'; status.textContent = 'Cargando…';
    modal.appendChild(title); modal.appendChild(status);

    var inp = document.createElement('input'); inp.placeholder = '¿Qué hay que hacer?';
    inp.style.cssText = 'width:100%;background:rgba(255,255,255,.07);border:.5px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px;font-size:12px;color:#fff;font-family:inherit;outline:none;box-sizing:border-box;';
    modal.appendChild(inp);

    function select() {
      var s = document.createElement('select');
      s.style.cssText = 'width:100%;background:rgba(255,255,255,.07);border:.5px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px;font-size:12px;color:rgba(255,255,255,.8);font-family:inherit;outline:none;cursor:pointer;box-sizing:border-box;';
      return s;
    }
    modal.appendChild(lbl('Proyecto'));
    var projSel = select(); modal.appendChild(projSel);
    modal.appendChild(lbl('Área de trabajo'));
    var areaSel = select(); modal.appendChild(areaSel);
    modal.appendChild(lbl('Encargado'));
    var respSel = select(); modal.appendChild(respSel);
    modal.appendChild(lbl('Fecha de entrega'));
    var dateInp = document.createElement('input'); dateInp.type = 'date';
    dateInp.style.cssText = 'width:100%;background:rgba(255,255,255,.07);border:.5px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px;font-size:12px;color:#fff;font-family:inherit;outline:none;box-sizing:border-box;';
    modal.appendChild(dateInp);

    var btns = document.createElement('div'); btns.style.cssText = 'display:flex;gap:7px;margin-top:16px;';
    var cancel = document.createElement('button'); cancel.textContent = 'Cancelar';
    cancel.style.cssText = 'background:rgba(255,255,255,.06);border:.5px solid rgba(255,255,255,.1);border-radius:8px;padding:9px 14px;font-size:11.5px;color:rgba(255,255,255,.4);cursor:pointer;font-family:inherit;';
    cancel.onclick = closeGenericModal;
    var save = document.createElement('button'); save.textContent = 'Crear tarea'; save.disabled = true;
    save.style.cssText = 'flex:1;background:#1A6FD4;border:none;border-radius:8px;padding:9px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;transition:background .15s;opacity:.5;';
    btns.appendChild(cancel); btns.appendChild(save); modal.appendChild(btns);

    overlay.appendChild(modal); document.body.appendChild(overlay);
    inp.focus();
    genOverlay = overlay;

    fsDoc().get().then(function(snap) {
      var d = snap.exists ? snap.data() : {};
      var projects = (d.projects || []).filter(function(p){ return p.catId !== 'cotizaciones' && !p.concluded && !p.pendingApproval && !p.quoteArchived; });
      var areas = (d.workAreas && d.workAreas.length) ? d.workAreas : [{name:'Campo'},{name:'Logística'},{name:'Diseño'},{name:'Dirección'},{name:'Administración'},{name:'Taller'}];
      var members = d.teamMembers || [];

      var o0 = document.createElement('option'); o0.value = ''; o0.textContent = 'Otros (sin proyecto)'; projSel.appendChild(o0);
      projects.forEach(function(p){ var o = document.createElement('option'); o.value = String(p.id); o.textContent = p.name; projSel.appendChild(o); });

      var a0 = document.createElement('option'); a0.value = ''; a0.textContent = 'Sin área'; areaSel.appendChild(a0);
      areas.forEach(function(a){ var o = document.createElement('option'); o.value = a.name; o.textContent = a.name; areaSel.appendChild(o); });

      var r0 = document.createElement('option'); r0.value = ''; r0.textContent = 'Sin asignar'; respSel.appendChild(r0);
      members.forEach(function(m){ var o = document.createElement('option'); o.value = m.id; o.textContent = m.name; respSel.appendChild(o); });

      status.textContent = '';
      save.disabled = false; save.style.opacity = '1';
    }).catch(function(){ status.textContent = 'No se pudo cargar el equipo, pero puedes crear la tarea igual.'; save.disabled = false; save.style.opacity = '1'; });

    inp.addEventListener('keydown', function(e){ if (e.key === 'Enter') save.click(); if (e.key === 'Escape') closeGenericModal(); });

    save.onclick = function() {
      var text = inp.value.trim(); if (!text) { inp.focus(); return; }
      if (save.disabled) return;
      save.disabled = true; status.textContent = 'Guardando…';
      var projId = projSel.value ? parseInt(projSel.value) : null;
      var task = { id: 'gfab_' + Date.now() + '_' + Math.random().toString(36).slice(2,7), text: text, done: false, deadline: dateInp.value || '', resp: respSel.value || '', area: areaSel.value || '', colStatus: null, priority: false, notes: '' };
      var docRef = fsDoc();
      _db.runTransaction(function(tx) {
        return tx.get(docRef).then(function(snap) {
          var d = snap.exists ? snap.data() : {};
          if (projId) {
            var projects = (d.projects || []).map(function(p) {
              if (p.id !== projId) return p;
              var st = Object.assign({}, p.stageTasks || {});
              task.sharedWithTeam = true;
              st[p.stage] = (st[p.stage] || []).concat([task]);
              return Object.assign({}, p, { stageTasks: st });
            });
            tx.update(docRef, { projects: projects });
          } else {
            var standaloneTasks = (d.standaloneTasks || []).concat([task]);
            tx.update(docRef, { standaloneTasks: standaloneTasks });
          }
        });
      }).then(function() {
        closeGenericModal();
      }).catch(function(e) {
        status.textContent = 'No se pudo guardar. ' + (e && e.message || '');
        save.disabled = false;
      });
    };
  }
  function closeGenericModal() {
    if (genOverlay && genOverlay.parentNode) genOverlay.parentNode.removeChild(genOverlay);
    genOverlay = null;
  }
  function openGenericTaskModal() {
    closeGenericModal();
    buildGenericModal();
  }
})();
