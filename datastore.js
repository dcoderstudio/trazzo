// ── TrazzoStore ──────────────────────────────────────────────────────
// Escritura segura y compartida sobre el documento único de Firestore
// (workspace/proyectos). Cargado por equipo.html y proyectos.html.
//
// Problema que resuelve: las páginas guardaban reemplazando arreglos
// completos (projects, standaloneTasks, categories...) a partir de una
// copia local que puede estar desactualizada. Dos guardados casi
// simultáneos podían perder el cambio del otro.
//
// Estrategia: cada guardado corre dentro de una transacción de
// Firestore que relee el documento vigente en el servidor y aplica
// solo la diferencia (altas/bajas/cambios por id) de este cliente
// sobre esos datos vigentes — nunca sobre la copia local obsoleta.
// Los registros que otro cliente cambió mientras tanto y que este
// cliente nunca tocó se conservan intactos. Si el mismo registro fue
// tocado por ambos, se aplica el cambio de este cliente pero se
// reporta como conflicto explícito (no se resuelve en silencio).
//
// Funciones puras (sin Firestore, sin DOM) para poder probarse con
// Node sin depender del navegador ni de producción.
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TrazzoStore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {

  function keyOf(item, idKey) { return String(item[idKey]); }

  // Compara dos valores de forma estable para detectar cambios reales.
  function sameValue(a, b) {
    if (a === b) return true;
    if (a == null || b == null) return false;
    try { return JSON.stringify(a) === JSON.stringify(b); }
    catch (e) { return false; }
  }

  // Diferencia entre lo último sincronizado por este cliente (lastSynced)
  // y lo que este cliente quiere guardar ahora (local): qué añadió/cambió
  // y qué quitó, identificado por id.
  function diffByLocalIntent(lastSynced, local, idKey) {
    var lastMap = {}, localMap = {};
    (lastSynced || []).forEach(function (x) { lastMap[keyOf(x, idKey)] = x; });
    (local || []).forEach(function (x) { localMap[keyOf(x, idKey)] = x; });
    var upserts = [], removals = [];
    Object.keys(localMap).forEach(function (k) {
      if (!lastMap.hasOwnProperty(k) || !sameValue(lastMap[k], localMap[k])) {
        upserts.push(localMap[k]);
      }
    });
    Object.keys(lastMap).forEach(function (k) {
      if (!localMap.hasOwnProperty(k)) removals.push(k);
    });
    return { upserts: upserts, removals: removals };
  }

  // Aplica SOLO la intención de este cliente (upserts/removals) sobre el
  // arreglo vigente en el servidor (freshServer), que puede incluir
  // registros que este cliente nunca vio. Detecta y reporta conflictos
  // cuando el mismo id fue modificado por ambos lados desde el último
  // punto de sincronización conocido.
  function reconcileArrayField(freshServer, lastSynced, local, idKey) {
    idKey = idKey || 'id';
    var diff = diffByLocalIntent(lastSynced, local, idKey);
    var lastMap = {}; (lastSynced || []).forEach(function (x) { lastMap[keyOf(x, idKey)] = x; });
    var freshMap = {}, order = [];
    (freshServer || []).forEach(function (x) { var k = keyOf(x, idKey); freshMap[k] = x; order.push(k); });
    var conflicts = [];

    diff.upserts.forEach(function (item) {
      var k = keyOf(item, idKey);
      var theirs = freshMap[k];
      var lastKnown = lastMap[k];
      // Conflicto: alguien más también cambió este registro desde la
      // última vez que este cliente sincronizó, y de forma distinta a
      // lo que este cliente sabía.
      if (theirs && lastKnown && !sameValue(theirs, lastKnown) && !sameValue(theirs, item)) {
        conflicts.push({ id: k, mine: item, theirs: theirs });
      }
      if (!freshMap.hasOwnProperty(k)) order.push(k);
      freshMap[k] = item; // se aplica la intención de este cliente
    });

    diff.removals.forEach(function (k) {
      var theirs = freshMap[k];
      var lastKnown = lastMap[k];
      if (theirs && lastKnown && !sameValue(theirs, lastKnown)) {
        // Alguien cambió (no solo mantuvo) el registro que yo quería borrar.
        conflicts.push({ id: k, mine: null, theirs: theirs });
      }
      delete freshMap[k];
    });

    var result = [];
    order.forEach(function (k) {
      if (freshMap.hasOwnProperty(k) && result.indexOf(freshMap[k]) === -1) result.push(freshMap[k]);
    });
    // de-dup por si un id se listó dos veces en order
    var seen = {}, dedup = [];
    result.forEach(function (x) { var k = keyOf(x, idKey); if (!seen[k]) { seen[k] = true; dedup.push(x); } });
    return { result: dedup, conflicts: conflicts };
  }

  // Fix del "arreglo vacío ignorado": distingue "el campo no existe en el
  // documento" (usar default) de "el campo existe pero está vacío"
  // (aceptar el vaciado). hasField debe ser Object.prototype.hasOwnProperty.
  function fieldOrDefault(freshDoc, key, defaultValue) {
    if (freshDoc && Object.prototype.hasOwnProperty.call(freshDoc, key) && freshDoc[key] !== undefined && freshDoc[key] !== null) {
      return freshDoc[key];
    }
    return defaultValue;
  }

  // ── Plantillas de servicio (categories) ───────────────────────────
  // Decide si una categoría del catálogo hardcodeado (cfg) debe
  // (re)escribirse sobre la categoría vigente (freshCat, o null si no
  // existe todavía). NUNCA sobrescribe una categoría marcada como
  // personalizada por el equipo.
  function shouldSeedCategory(freshCat, cfg) {
    if (!freshCat) return { seed: true, reason: 'no-existe' };
    if (freshCat.customized) return { seed: false, reason: 'personalizada' };
    var hasTpl = !!(freshCat.templates && Object.keys(freshCat.templates).length > 0);
    if (!hasTpl) return { seed: true, reason: 'sin-plantillas' };
    var stagesDiffer = (freshCat.stages || []).join('|') !== (cfg.stages || []).join('|');
    if (stagesDiffer) return { seed: true, reason: 'etapas-distintas' };
    if (cfg.tplVersion && freshCat.tplVersion !== cfg.tplVersion) return { seed: true, reason: 'version-distinta' };
    return { seed: false, reason: 'al-dia' };
  }

  // ── Checklist de una etapa (stageTasks) ───────────────────────────
  // Distingue "esta etapa nunca se sembró" (sembrar desde la plantilla)
  // de "la etapa se sembró y luego se vació a propósito" (no volver a
  // sembrar). project.stageTasksSeeded[stage] = true marca que ya se
  // sembró una vez (independientemente de si luego quedó vacía).
  function shouldSeedStageTasks(project, stage, templateItems) {
    if (!templateItems || !templateItems.length) return false;
    var already = project.stageTasksSeeded && project.stageTasksSeeded[stage];
    if (already) return false;
    var existing = project.stageTasks && project.stageTasks[stage];
    return !existing || existing.length === 0;
  }

  return {
    sameValue: sameValue,
    diffByLocalIntent: diffByLocalIntent,
    reconcileArrayField: reconcileArrayField,
    fieldOrDefault: fieldOrDefault,
    shouldSeedCategory: shouldSeedCategory,
    shouldSeedStageTasks: shouldSeedStageTasks,

    // ── Envoltura de Firestore (no se ejecuta en los tests de Node) ──
    // mutate(freshDocData) -> objeto parcial {campo: nuevoValor} a
    // fusionar (merge:true) en el documento. Se ejecuta dentro de una
    // transacción: si el documento cambió entre la lectura y la
    // escritura, Firestore reintenta automáticamente con datos frescos.
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

    // Aviso visible de error de guardado (antes solo iba a console.warn).
    notifySaveError: function (action, err) {
      try { console.error('[Trazzo] Error al guardar (' + action + '):', err); } catch (e) {}
      if (typeof document === 'undefined') return;
      var el = document.getElementById('trazzoStoreError');
      if (!el) {
        el = document.createElement('div');
        el.id = 'trazzoStoreError';
        el.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:99999;background:#D4537E;color:#fff;padding:10px 16px;border-radius:10px;font:600 12px Inter,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:320px;';
        document.body.appendChild(el);
      }
      el.textContent = '⚠ No se pudo guardar (' + action + '). Reintenta o recarga la página.';
      el.style.display = 'block';
      clearTimeout(el._t);
      el._t = setTimeout(function () { el.style.display = 'none'; }, 7000);
    },

    // Aviso visible (no bloqueante) de que se resolvió un conflicto de
    // edición concurrente sobre el mismo registro.
    notifyConflict: function (conflicts, label) {
      if (!conflicts || !conflicts.length) return;
      try { console.warn('[Trazzo] Conflicto de edición concurrente en ' + label + ':', conflicts); } catch (e) {}
      if (typeof document === 'undefined') return;
      var el = document.getElementById('trazzoConflictNotice');
      if (!el) {
        el = document.createElement('div');
        el.id = 'trazzoConflictNotice';
        el.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:99999;background:#E8A020;color:#1a1a1a;padding:10px 16px;border-radius:10px;font:600 12px Inter,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.5);max-width:340px;';
        document.body.appendChild(el);
      }
      el.textContent = '⚠ ' + conflicts.length + ' registro(s) de "' + label + '" fueron editados al mismo tiempo por otra persona. Se aplicó tu cambio; revisa que no se haya perdido nada.';
      el.style.display = 'block';
      clearTimeout(el._t);
      el._t = setTimeout(function () { el.style.display = 'none'; }, 9000);
    }
  };
});
