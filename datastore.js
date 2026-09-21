// ── TrazzoStore ──────────────────────────────────────────────────────
// Escritura segura y compartida sobre el documento único de Firestore
// (workspace/proyectos). Cargado por las páginas de Trazzo.
//
// Todas las funciones de este archivo son puras (sin Firestore, sin
// DOM) salvo withFreshDoc/notifySaveError/notifyConflict/showConflict
// Modal, marcadas explícitamente. Eso permite probarlas en Node contra
// el mock de test/mock-firestore.js sin reimplementar la lógica en
// los propios tests (Node: module.exports; navegador: window.TrazzoStore).
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrazzoStore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  function keyOf(item, idKey) { return String(item[idKey]); }

  function sameValue(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch (e) { return false; }
  }

  function diffByLocalIntent(lastSynced, local, idKey) {
    var lastMap = {}, localMap = {};
    (lastSynced || []).forEach(function (x) { lastMap[keyOf(x, idKey)] = x; });
    (local || []).forEach(function (x) { localMap[keyOf(x, idKey)] = x; });
    var upserts = [], removals = [];
    Object.keys(localMap).forEach(function (k) {
      if (!lastMap.hasOwnProperty(k) || !sameValue(lastMap[k], localMap[k])) upserts.push(localMap[k]);
    });
    Object.keys(lastMap).forEach(function (k) { if (!localMap.hasOwnProperty(k)) removals.push(k); });
    return { upserts: upserts, removals: removals };
  }

  // ── Reconciliación con retención explícita de conflictos ──────────
  // Aplica la intención de este cliente (upserts/removals, calculada
  // contra lastSynced) sobre freshServer — el estado VIGENTE del
  // servidor, que puede incluir registros que este cliente nunca vio.
  //
  // Si detecta que el MISMO registro cambió en ambos lados desde el
  // último punto de sincronización, NO decide por su cuenta: deja ese
  // registro tal como está en el servidor (no se pierde nada de
  // nadie) y lo reporta en `conflicts` para que quien llamó decida
  // (ver resolveConflict). También distingue edición-vs-borrado:
  //  - 'edit-edit'   : ambos lados editaron el mismo registro distinto
  //  - 'edit-delete' : yo lo edité, el servidor ya no lo tiene (lo
  //                    borró alguien más) -> no se resucita solo
  //  - 'delete-edit' : yo lo quería borrar, el servidor lo tiene
  //                    editado distinto a lo que yo conocía -> no se
  //                    borra solo
  // opts.mergeConflict(mine, theirs, lastKnown) -> {resolved:x} | {conflicts:[...]}
  // Permite intentar una reconciliación más fina ANTES de rendirse y
  // reportar un conflicto crudo sobre todo el registro — lo usa el
  // campo projects para no marcar como "conflicto" el que dos personas
  // editen tareas DISTINTAS dentro del mismo proyecto (ver
  // reconcileProjectRecord).
  function reconcileArrayField(freshServer, lastSynced, local, idKey, opts) {
    idKey = idKey || 'id';
    opts = opts || {};
    var diff = diffByLocalIntent(lastSynced, local, idKey);
    var lastMap = {}; (lastSynced || []).forEach(function (x) { lastMap[keyOf(x, idKey)] = x; });
    var freshMap = {}, order = [];
    (freshServer || []).forEach(function (x) { var k = keyOf(x, idKey); freshMap[k] = x; order.push(k); });
    var conflicts = [];

    diff.upserts.forEach(function (item) {
      var k = keyOf(item, idKey);
      var lastKnown = lastMap[k];
      var theirsExists = freshMap.hasOwnProperty(k);
      var theirs = freshMap[k];
      if (!lastKnown) {
        // Yo lo estoy creando. Si el servidor YA tiene ese id (otra
        // persona/proceso creó algo distinto con el mismo id, p.ej.
        // colisión de contador), no lo piso: se reporta el conflicto.
        if (theirsExists && !sameValue(theirs, item)) {
          conflicts.push({ id: k, type: 'edit-edit', mine: item, theirs: theirs, lastKnown: null });
          return;
        }
        if (!theirsExists) order.push(k);
        freshMap[k] = item;
        return;
      }
      if (!theirsExists) {
        // Yo lo edité; el servidor ya no lo tiene -> alguien lo borró.
        conflicts.push({ id: k, type: 'edit-delete', mine: item, theirs: null, lastKnown: lastKnown });
        return; // no se resucita solo: se deja borrado hasta que se resuelva
      }
      if (!sameValue(theirs, lastKnown) && !sameValue(theirs, item)) {
        if (opts.mergeConflict) {
          var merged = opts.mergeConflict(item, theirs, lastKnown);
          if (merged && merged.resolved !== undefined) { freshMap[k] = merged.resolved; return; }
          if (merged && merged.conflicts && merged.conflicts.length) { conflicts = conflicts.concat(merged.conflicts); return; }
        }
        // El servidor cambió ese registro de forma distinta a lo que
        // yo sabía Y distinta a lo que yo quiero guardar.
        conflicts.push({ id: k, type: 'edit-edit', mine: item, theirs: theirs, lastKnown: lastKnown });
        return; // se deja el valor vigente del servidor, no se pisa
      }
      freshMap[k] = item; // sin conflicto: se aplica mi cambio
    });

    diff.removals.forEach(function (k) {
      var theirsExists = freshMap.hasOwnProperty(k);
      var theirs = freshMap[k];
      var lastKnown = lastMap[k];
      if (!theirsExists) return; // alguien más ya lo borró también: nada que hacer
      if (lastKnown && !sameValue(theirs, lastKnown)) {
        // Alguien cambió (no solo mantuvo) el registro que yo quería borrar.
        conflicts.push({ id: k, type: 'delete-edit', mine: null, theirs: theirs, lastKnown: lastKnown });
        return; // no se borra solo: se conserva la edición vigente
      }
      delete freshMap[k];
    });

    var seen = {}, result = [];
    order.forEach(function (k) {
      if (freshMap.hasOwnProperty(k) && !seen[k]) { seen[k] = true; result.push(freshMap[k]); }
    });
    return { result: result, conflicts: conflicts };
  }

  // Aplica la resolución que la persona eligió para un conflicto ya
  // reportado por reconcileArrayField, sobre el arreglo VIGENTE actual
  // (debe releerse otra vez dentro de una transacción nueva, porque
  // pudo cambiar de nuevo entre que se mostró el conflicto y se
  // resolvió). choice: 'mine' | 'theirs'.
  function resolveConflict(freshServer, conflict, choice, idKey) {
    idKey = idKey || 'id';
    var arr = (freshServer || []).slice();
    var i = arr.findIndex(function (x) { return keyOf(x, idKey) === conflict.id; });
    if (choice === 'theirs') return arr; // no cambiar nada: se deja lo que ya está
    // choice === 'mine'
    if (conflict.type === 'delete-edit') {
      if (i > -1) arr.splice(i, 1); // ahora sí se borra
      return arr;
    }
    // edit-edit o edit-delete -> se escribe (o re-escribe) mi versión
    if (i > -1) arr[i] = conflict.mine; else arr.push(conflict.mine);
    return arr;
  }

  // ── Reconciliación anidada de un proyecto ─────────────────────────
  // Se usa como mergeConflict al reconciliar el campo `projects`. Antes
  // de rendirse y marcar "conflicto" porque el proyecto entero difiere
  // en ambos lados, compara campo por campo: si dos personas editaron
  // TAREAS DISTINTAS dentro del mismo proyecto (stageTasks de una
  // misma etapa, o etapas distintas), eso no es un conflicto real y se
  // combinan ambos cambios. Solo se reporta conflicto cuando el mismo
  // campo escalar o la MISMA tarea anidada cambiaron de forma distinta
  // en ambos lados.
  var PROJECT_SCALAR_FIELDS = ['name','client','catId','stage','deadline','team','empresa','monto','tipoCat','converted','convertedProjectId','finStatus','paymentsDone'];
  function reconcileProjectRecord(mine, theirs, lastKnown) {
    var conflicts = [];
    var merged = Object.assign({}, theirs);
    PROJECT_SCALAR_FIELDS.forEach(function (f) {
      var lv = lastKnown ? lastKnown[f] : undefined;
      var mv = mine[f], tv = theirs[f];
      var iChanged = !sameValue(lv, mv);
      var theyChanged = !sameValue(lv, tv);
      if (iChanged && theyChanged && !sameValue(mv, tv)) {
        conflicts.push({ id: String(mine.id) + '.' + f, type: 'edit-edit', field: f, mine: mv, theirs: tv, lastKnown: lv, projectId: mine.id });
      } else if (iChanged) {
        merged[f] = mv;
      }
    });
    var stages = {};
    Object.keys(mine.stageTasks || {}).forEach(function (s) { stages[s] = 1; });
    Object.keys(theirs.stageTasks || {}).forEach(function (s) { stages[s] = 1; });
    Object.keys((lastKnown && lastKnown.stageTasks) || {}).forEach(function (s) { stages[s] = 1; });
    merged.stageTasks = Object.assign({}, theirs.stageTasks || {});
    Object.keys(stages).forEach(function (stage) {
      var mArr = (mine.stageTasks || {})[stage] || [];
      var tArr = (theirs.stageTasks || {})[stage] || [];
      var lArr = ((lastKnown && lastKnown.stageTasks) || {})[stage] || [];
      var rec = reconcileArrayField(tArr, lArr, mArr, 'id');
      merged.stageTasks[stage] = rec.result;
      rec.conflicts.forEach(function (c) {
        conflicts.push(Object.assign({}, c, { id: mine.id + '.' + stage + '.' + c.id, projectId: mine.id, stage: stage }));
      });
    });
    if (conflicts.length) return { conflicts: conflicts };
    return { resolved: merged };
  }

  function fieldOrDefault(freshDoc, key, defaultValue) {
    if (freshDoc && Object.prototype.hasOwnProperty.call(freshDoc, key) && freshDoc[key] !== undefined && freshDoc[key] !== null) {
      return freshDoc[key];
    }
    return defaultValue;
  }

  // ── Campos tipo mapa (memberGoals, dailyBlocks, mealPlan, ...) ────
  // A diferencia de projects/standaloneTasks, estos campos son objetos
  // donde cada llave (id de miembro, fecha, etc.) suele editarse desde
  // un solo lugar a la vez. Aun así, "merge:true" a nivel de todo el
  // campo seguiría reemplazando TODO el objeto si dos llaves distintas
  // se editan casi al mismo tiempo -- esto aplica solo la llave que
  // este cliente tocó, sobre el mapa vigente del servidor.
  // Reconciliación de un campo tipo mapa completo (memberGoals,
  // memberAreas, memberReminders...) donde cada LLAVE es su propio
  // registro independiente. Reutiliza reconcileArrayField envolviendo
  // cada llave como {id:llave, v:valor} — misma detección de
  // conflictos edición-edición / edición-borrado, pero por llave en
  // vez de por id de arreglo.
  function reconcileMapField(freshMap, lastSyncedMap, localMap) {
    function toArr(m) { return Object.keys(m || {}).map(function (k) { return { id: k, v: m[k] }; }); }
    var rec = reconcileArrayField(toArr(freshMap), toArr(lastSyncedMap), toArr(localMap), 'id');
    var result = {};
    rec.result.forEach(function (x) { result[x.id] = x.v; });
    var conflicts = rec.conflicts.map(function (c) {
      return Object.assign({}, c, {
        mine: c.mine ? c.mine.v : null,
        theirs: c.theirs ? c.theirs.v : null,
        lastKnown: c.lastKnown ? c.lastKnown.v : null
      });
    });
    return { result: result, conflicts: conflicts };
  }

  function patchMapField(freshMap, key, newValue) {
    var next = Object.assign({}, freshMap || {});
    if (newValue === undefined) delete next[key]; else next[key] = newValue;
    return next;
  }
  function patchMapFields(freshMap, patches) {
    var next = Object.assign({}, freshMap || {});
    Object.keys(patches || {}).forEach(function (k) {
      if (patches[k] === undefined) delete next[k]; else next[k] = patches[k];
    });
    return next;
  }

  // ── Ids concurrentes (nextId/catIdCounter) ─────────────────────────
  // pendingNewItems: [{id, ...registro}] construidos con un id
  // "optimista" tomado de la copia local del contador. Si ese id ya
  // existe en freshArr (alguien más lo tomó primero) o quedó por
  // debajo del contador vigente del servidor, se reasigna a partir de
  // freshNextId — nunca se pierde el registro, solo cambia su id antes
  // de guardarse por primera vez. Devuelve el mapeo id-viejo -> id-
  // nuevo para que quien llamó pueda actualizar cualquier referencia
  // que ya hubiera creado en memoria (p.ej. un modal abierto).
  function reconcileNewIds(freshArr, freshNextId, pendingNewItems, idKey) {
    idKey = idKey || 'id';
    var freshIds = {};
    (freshArr || []).forEach(function (x) { freshIds[String(x[idKey])] = true; });
    var counter = freshNextId;
    var remapped = [];
    var items = (pendingNewItems || []).map(function (rec) {
      var curId = rec[idKey];
      var collides = freshIds.hasOwnProperty(String(curId)) || (typeof curId === 'number' && curId < freshNextId);
      if (collides) {
        var newId = counter++;
        remapped.push({ oldId: curId, newId: newId });
        var patched = Object.assign({}, rec);
        patched[idKey] = newId;
        freshIds[String(newId)] = true;
        return patched;
      }
      freshIds[String(curId)] = true;
      if (typeof curId === 'number' && curId >= counter) counter = curId + 1;
      return rec;
    });
    return { items: items, nextNextId: counter, remapped: remapped };
  }

  // ── done/colStatus/doneAt — un solo lugar que decide los tres ─────
  function taskDoneChanges(isDone, colStatusOverride, doneAtValue) {
    if (isDone) return { done: true, colStatus: colStatusOverride !== undefined ? colStatusOverride : 'done', doneAt: doneAtValue };
    return { done: false, colStatus: colStatusOverride !== undefined ? colStatusOverride : null, doneAt: null };
  }

  // ── Archivo de tareas hechas (cleanOldDoneTasks) ──────────────────
  // Antes se borraban; ahora se mueven a archivedTasks conservando el
  // registro completo. Pura: recibe los arreglos y el corte, no toca
  // Firestore ni fechas reales (facilita probarla).
  function computeArchive(standaloneTasks, cutoffDs, archivedAtValue) {
    var toArchive = (standaloneTasks || []).filter(function (t) { return t.done && t.deadline && t.deadline < cutoffDs; });
    var kept = (standaloneTasks || []).filter(function (t) { return !(t.done && t.deadline && t.deadline < cutoffDs); });
    var archived = toArchive.map(function (t) { return Object.assign({}, t, { archivedAt: archivedAtValue }); });
    return { kept: kept, archived: archived, archivedCount: archived.length };
  }

  // ── Asignar una tarea a un área (dropTaskOnArea) ──────────────────
  // Nunca crea un segundo registro mutable para una tarea de proyecto:
  // si task._type es 'project', el área se escribe DIRECTO sobre el
  // registro original dentro de project.stageTasks — así solo existe
  // un campo `done` para esa tarea, sin nada que pueda desincronizarse
  // entre una "copia" y su "original".
  function buildAreaAssignPatch(task, areaId, workAreas) {
    var area = null;
    for (var i = 0; i < (workAreas || []).length; i++) { if (workAreas[i].id === areaId) { area = workAreas[i]; break; } }
    var areaName = area ? area.name : areaId;
    if (task._type === 'standalone') {
      return { target: 'standaloneTasks', taskId: task.id, patch: { area: areaName } };
    }
    return { target: 'projectStageTask', projectId: task._projId, stage: task._stage, taskId: task.id, patch: { area: areaName } };
  }

  // ── Plantillas de servicio (categories) ───────────────────────────
  // Nunca sobrescribe automáticamente una categoría que YA tiene
  // plantilla, sin importar si el campo `customized` está presente o
  // no -- su ausencia no prueba que nadie la haya editado a mano
  // (categorías personalizadas antes de que este campo existiera no
  // lo tendrían). Solo se siembra sola una categoría verdaderamente
  // nueva o sin ninguna plantilla todavía (no hay nada que perder).
  function shouldSeedCategory(freshCat, cfg) {
    if (!freshCat) return { seed: true, reason: 'no-existe' };
    var hasTpl = !!(freshCat.templates && Object.keys(freshCat.templates).length > 0);
    if (!hasTpl) return { seed: true, reason: 'sin-plantillas' };
    var stagesDiffer = (freshCat.stages || []).join('|') !== (cfg.stages || []).join('|');
    var versionDiffers = !!(cfg.tplVersion && freshCat.tplVersion !== cfg.tplVersion);
    if (stagesDiffer || versionDiffers) return { seed: false, updateAvailable: true, reason: 'actualizacion-disponible-no-aplicada' };
    return { seed: false, reason: 'al-dia' };
  }

  // ── Checklist de una etapa (stageTasks) ───────────────────────────
  function shouldSeedStageTasks(project, stage, templateItems) {
    if (!templateItems || !templateItems.length) return false;
    if (project.stageTasksSeeded && project.stageTasksSeeded[stage]) return false;
    var existing = project.stageTasks && project.stageTasks[stage];
    return !existing || existing.length === 0;
  }

  // ── Conversión de cotización a proyecto (idempotente) ─────────────
  // Pura: recibe el estado VIGENTE (freshProjects/freshNextId, leídos
  // dentro de una transacción) y decide qué escribir. Si la cotización
  // YA está marcada convertida en los datos vigentes -- así lo haya
  // hecho esta misma sesión hace un segundo o OTRA sesión en paralelo
  // -- no crea un segundo proyecto: devuelve el existente.
  function buildQuoteConversionPatch(freshProjects, freshNextId, quoteId, categories) {
    var quote = (freshProjects || []).find(function (x) { return x.id === quoteId; });
    if (!quote) return { ok: false, reason: 'no-existe' };
    if (quote.converted) {
      return { ok: false, reason: 'ya-convertida', existingProjectId: quote.convertedProjectId };
    }
    if (!quote.tipoCat) return { ok: false, reason: 'sin-tipo' };
    var cat = (categories || []).find(function (c) { return c.id === quote.tipoCat; });
    if (!cat) return { ok: false, reason: 'sin-categoria' };
    var newId = freshNextId;
    var newProj = {
      id: newId, name: quote.name, client: quote.client, catId: quote.tipoCat, stage: cat.stages[0],
      deadline: quote.deadline || '', team: quote.team, empresa: quote.empresa || null,
      monto: quote.monto || '',
      docs: quote.docs ? Object.assign({}, quote.docs) : undefined,
      customFieldValues: quote.customFieldValues ? Object.assign({}, quote.customFieldValues) : undefined,
      sourceQuoteId: quote.id,
      stageEntryDates: {}
    };
    newProj.stageEntryDates[cat.stages[0]] = null; // el llamador pone la fecha real (evita depender de Date aquí)
    var updatedProjects = freshProjects.map(function (x) {
      return x.id === quoteId ? Object.assign({}, x, { converted: true, convertedProjectId: newId }) : x;
    }).concat([newProj]);
    return { ok: true, projects: updatedProjects, nextId: newId + 1, newProj: newProj };
  }

  return {
    sameValue: sameValue,
    diffByLocalIntent: diffByLocalIntent,
    reconcileArrayField: reconcileArrayField,
    reconcileProjectRecord: reconcileProjectRecord,
    resolveConflict: resolveConflict,
    fieldOrDefault: fieldOrDefault,
    reconcileMapField: reconcileMapField,
    patchMapField: patchMapField,
    patchMapFields: patchMapFields,
    reconcileNewIds: reconcileNewIds,
    taskDoneChanges: taskDoneChanges,
    computeArchive: computeArchive,
    buildAreaAssignPatch: buildAreaAssignPatch,
    shouldSeedCategory: shouldSeedCategory,
    shouldSeedStageTasks: shouldSeedStageTasks,
    buildQuoteConversionPatch: buildQuoteConversionPatch,

    // ── Envoltura de Firestore ─────────────────────────────────────
    withFreshDoc: function (db, docRef, mutate) {
      return db.runTransaction(function (tx) {
        return tx.get(docRef).then(function (snap) {
          var fresh = snap.exists ? snap.data() : {};
          var patch = mutate(fresh) || {};
          if (Object.keys(patch).length) tx.set(docRef, patch, { merge: true });
          return patch;
        });
      });
    },

    notifySaveError: function (action, err) {
      try { console.error('[Trazzo] Error al guardar (' + action + '):', err); } catch (e) {}
      if (typeof document === 'undefined') return;
      var el = document.getElementById('trazzoStoreError');
      if (!el) {
        el = document.createElement('div');
        el.id = 'trazzoStoreError';
        el.setAttribute('data-trazzo-error', '1');
        el.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:99999;background:#D4537E;color:#fff;padding:10px 16px;border-radius:10px;font:600 12px Inter,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:320px;';
        document.body.appendChild(el);
      }
      el.textContent = '⚠ No se pudo guardar (' + action + '). Reintenta o recarga la página.';
      el.style.display = 'block';
      clearTimeout(el._t);
      el._t = setTimeout(function () { el.style.display = 'none'; }, 7000);
    },

    notifyConflict: function (conflicts, label) {
      if (!conflicts || !conflicts.length) return;
      try { console.warn('[Trazzo] Conflicto de edición concurrente en ' + label + ':', conflicts); } catch (e) {}
      if (typeof document === 'undefined') return;
      this.showConflictModal(conflicts, label);
    },

    // Modal mínimo (sin depender del CSS de cada página) para resolver
    // conflictos edición-edición / edición-borrado uno por uno. onResolve
    // recibe (conflict, choice) y debe devolver una Promise; una vez
    // resuelto se quita de la lista.
    showConflictModal: function (conflicts, label, onResolve) {
      if (typeof document === 'undefined' || !conflicts || !conflicts.length) return;
      var old = document.getElementById('trazzoConflictModal');
      if (old) old.remove();
      var overlay = document.createElement('div');
      overlay.id = 'trazzoConflictModal';
      overlay.setAttribute('data-trazzo-conflict-modal', '1');
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:99998;display:flex;align-items:center;justify-content:center;font-family:Inter,sans-serif;';
      var box = document.createElement('div');
      box.style.cssText = 'background:#141c2e;border:.5px solid rgba(255,255,255,.14);border-radius:14px;width:380px;max-height:80vh;overflow-y:auto;padding:16px 18px;color:#fff;';
      var title = document.createElement('div');
      title.textContent = '⚠ Conflicto al guardar: ' + label;
      title.style.cssText = 'font-size:14px;font-weight:800;margin-bottom:10px;';
      box.appendChild(title);
      conflicts.forEach(function (c) {
        var row = document.createElement('div');
        row.className = 'trazzo-conflict-row';
        row.setAttribute('data-conflict-id', c.id);
        row.style.cssText = 'border:.5px solid rgba(255,255,255,.1);border-radius:8px;padding:10px;margin-bottom:8px;font-size:12px;';
        var typeLbl = c.type === 'edit-delete' ? 'Se editó, pero alguien lo borró'
          : c.type === 'delete-edit' ? 'Se quería borrar, pero alguien lo editó'
          : 'Editado por dos personas al mismo tiempo';
        row.innerHTML = '<div style="opacity:.6;margin-bottom:4px;">' + typeLbl + ' — id ' + c.id + '</div>'
          + '<div style="margin-bottom:6px;"><b>Tu versión:</b> <span class="trazzo-mine">' + (c.mine ? (c.mine.text || c.mine.name || JSON.stringify(c.mine)) : '(borrarlo)') + '</span></div>'
          + '<div style="margin-bottom:8px;"><b>Versión vigente:</b> <span class="trazzo-theirs">' + (c.theirs ? (c.theirs.text || c.theirs.name || JSON.stringify(c.theirs)) : '(está borrado)') + '</span></div>';
        var btnMine = document.createElement('button');
        btnMine.textContent = 'Usar mi versión'; btnMine.className = 'trazzo-choose-mine';
        btnMine.style.cssText = 'background:#1A6FD4;border:none;color:#fff;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;margin-right:6px;';
        var btnTheirs = document.createElement('button');
        btnTheirs.textContent = 'Dejar la vigente'; btnTheirs.className = 'trazzo-choose-theirs';
        btnTheirs.style.cssText = 'background:rgba(255,255,255,.1);border:none;color:#fff;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:700;cursor:pointer;';
        function choose(choice) {
          row.style.opacity = '.4';
          btnMine.disabled = btnTheirs.disabled = true;
          var p = onResolve ? onResolve(c, choice) : Promise.resolve();
          Promise.resolve(p).then(function () { row.remove(); if (!box.querySelector('.trazzo-conflict-row')) overlay.remove(); });
        }
        btnMine.onclick = function () { choose('mine'); };
        btnTheirs.onclick = function () { choose('theirs'); };
        row.appendChild(btnMine); row.appendChild(btnTheirs);
        box.appendChild(row);
      });
      var closeBtn = document.createElement('button');
      closeBtn.textContent = 'Cerrar (revisar después)';
      closeBtn.style.cssText = 'margin-top:6px;background:none;border:none;color:rgba(255,255,255,.4);font-size:11px;cursor:pointer;text-decoration:underline;';
      closeBtn.onclick = function () { overlay.remove(); };
      box.appendChild(closeBtn);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    }
  };
});
