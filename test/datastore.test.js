// ── Pruebas de datastore.js contra un mock de Firestore ─────────────
// Entorno aislado: no toca Firebase real ni datos de producción.
// Ejecutar: node test/datastore.test.js
'use strict';
var assert = require('assert');
var Store = require('../datastore.js');
var mock = require('./mock-firestore.js');

var PASS = 0, FAIL = 0, FAILED_NAMES = [];

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(function () { PASS++; console.log('  OK  ' + name); })
    .catch(function (e) { FAIL++; FAILED_NAMES.push(name); console.log('FALLO ' + name + '\n      ' + e.message); });
}

// Simula el patrón real de saveTaskChange()/saveData(): el cliente
// guarda solo el campo `field`, reconciliando su intención local
// (respecto a lo último que sincronizó, lastSynced) contra los datos
// vigentes del servidor dentro de una transacción.
function saveField(db, docRef, field, idKey, lastSynced, local) {
  return Store.withFreshDoc(db, docRef, function (fresh) {
    var freshArr = Store.fieldOrDefault(fresh, field, []);
    var rec = Store.reconcileArrayField(freshArr, lastSynced, local, idKey);
    saveField._lastConflicts = rec.conflicts;
    var patch = {};
    patch[field] = rec.result;
    return patch;
  });
}

function run() {
  return Promise.resolve()

    .then(function () { return test('Dos usuarios modifican tareas diferentes: ambos cambios se conservan', function () {
      var db = mock.createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      var base = [{ id: 't1', text: 'Tarea 1', done: false }, { id: 't2', text: 'Tarea 2', done: false }];
      return ref.set({ standaloneTasks: base }).then(function () {
        // Cliente A y B parten del mismo estado sincronizado.
        var lastSynced = base;
        var localA = [Object.assign({}, base[0], { done: true }), base[1]]; // A completa t1
        var localB = [base[0], Object.assign({}, base[1], { text: 'Tarea 2 editada' })]; // B edita t2
        // A empieza su transacción primero (lee), luego B guarda completo, luego A confirma.
        return Promise.all([
          saveField(db, ref, 'standaloneTasks', 'id', lastSynced, localA),
          saveField(db, ref, 'standaloneTasks', 'id', lastSynced, localB)
        ]);
      }).then(function () {
        var final = ref.get();
        return final;
      }).then(function (snap) {
        var arr = snap.data().standaloneTasks;
        var t1 = arr.find(function (x) { return x.id === 't1'; });
        var t2 = arr.find(function (x) { return x.id === 't2'; });
        assert.strictEqual(t1.done, true, 't1 debía quedar completada (cambio de A)');
        assert.strictEqual(t2.text, 'Tarea 2 editada', 't2 debía quedar editado (cambio de B)');
      });
    }); })

    .then(function () { return test('Dos usuarios modifican el mismo dato: se reporta conflicto explícito', function () {
      var db = mock.createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      var base = [{ id: 'p1', name: 'Proyecto X', stage: 'Brief' }];
      return ref.set({ projects: base }).then(function () {
        var lastSynced = base;
        var localA = [Object.assign({}, base[0], { stage: 'Concepto' })];
        var localB = [Object.assign({}, base[0], { name: 'Proyecto X (renombrado)' })];
        return saveField(db, ref, 'projects', 'id', lastSynced, localA).then(function () {
          return saveField(db, ref, 'projects', 'id', lastSynced, localB);
        });
      }).then(function () {
        assert.ok(saveField._lastConflicts.length >= 1, 'debía detectarse un conflicto en p1');
        var snap = ref.get();
        return snap;
      }).then(function (snap) {
        var p1 = snap.data().projects[0];
        // Se aplica el último guardado (B) pero el conflicto quedó reportado arriba, no oculto.
        assert.strictEqual(p1.name, 'Proyecto X (renombrado)');
      });
    }); })

    .then(function () { return test('Un fallo de guardado se propaga (no se confirma éxito en silencio)', function () {
      var db = mock.createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      // Simula una falla real de Firestore (red caída, reglas que
      // rechazan la escritura, etc.) en pleno intento de transacción.
      var brokenDb = { runTransaction: function () { return Promise.reject(new Error('permiso denegado (simulado)')); } };
      return saveField(brokenDb, ref, 'standaloneTasks', 'id', [], [{ id: 'x' }])
        .then(function () { throw new Error('debía rechazar la promesa, no resolverla'); })
        .catch(function (e) {
          assert.ok(/permiso denegado/.test(e.message), 'el error real debía propagarse: ' + e.message);
        });
    }); })

    .then(function () { return test('Vaciar una lista (borrar el último elemento) se refleja, no se ignora', function () {
      var freshDoc = { standaloneTasks: [] }; // el servidor ya quedó vacío
      var value = Store.fieldOrDefault(freshDoc, 'standaloneTasks', ['valor viejo que no debería aparecer']);
      assert.deepStrictEqual(value, [], 'un arreglo vacío presente debe aceptarse tal cual, no reemplazarse por el default');

      var docSinCampo = {}; // el campo nunca ha existido en el documento
      var value2 = Store.fieldOrDefault(docSinCampo, 'workAreas', ['default-a', 'default-b']);
      assert.deepStrictEqual(value2, ['default-a', 'default-b'], 'si el campo no existe debe usarse el default');
    }); })

    .then(function () { return test('shouldSeedCategory: no revienta si la categoría no existe (fi=-1)', function () {
      var r = Store.shouldSeedCategory(null, { id: 'x', stages: ['A', 'B'], tplVersion: 1 });
      assert.strictEqual(r.seed, true);
    }); })

    .then(function () { return test('shouldSeedCategory: nunca sobrescribe una categoría personalizada', function () {
      var fresh = { id: 'branding', customized: true, stages: ['Solo mi etapa'], templates: {} , tplVersion: 1};
      var cfg = { id: 'branding', stages: ['Brief', 'Concepto', 'Entrega'], tplVersion: 99, templates: { Brief: [{ text: 'x' }] } };
      var r = Store.shouldSeedCategory(fresh, cfg);
      assert.strictEqual(r.seed, false, 'una categoría marcada customized nunca debe reescribirse automáticamente');
    }); })

    .then(function () { return test('shouldSeedCategory: sí actualiza una categoría no personalizada con nueva versión', function () {
      var fresh = { id: 'branding', stages: ['Brief', 'Concepto', 'Entrega'], templates: { Brief: [{ text: 'x' }] }, tplVersion: 1 };
      var cfg = { id: 'branding', stages: ['Brief', 'Concepto', 'Entrega'], tplVersion: 2, templates: { Brief: [{ text: 'y' }] } };
      var r = Store.shouldSeedCategory(fresh, cfg);
      assert.strictEqual(r.seed, true);
    }); })

    .then(function () { return test('shouldSeedStageTasks: siembra la primera vez', function () {
      var project = { stageTasks: {}, stageTasksSeeded: {} };
      var r = Store.shouldSeedStageTasks(project, 'Brief', [{ text: 'Paso 1' }]);
      assert.strictEqual(r, true);
    }); })

    .then(function () { return test('shouldSeedStageTasks: NO revive tareas borradas a propósito', function () {
      // La etapa ya se sembró una vez (stageTasksSeeded.Brief = true) y
      // el usuario borró manualmente todas sus tareas -> stageTasks.Brief = [].
      var project = { stageTasks: { Brief: [] }, stageTasksSeeded: { Brief: true } };
      var r = Store.shouldSeedStageTasks(project, 'Brief', [{ text: 'Paso 1' }]);
      assert.strictEqual(r, false, 'no debe volver a crear tareas que el usuario borró intencionalmente');
    }); })

    .then(function () {
      console.log('\n' + PASS + ' pasaron, ' + FAIL + ' fallaron.');
      if (FAIL) { console.log('Fallaron: ' + FAILED_NAMES.join(', ')); process.exitCode = 1; }
    });
}

run();
