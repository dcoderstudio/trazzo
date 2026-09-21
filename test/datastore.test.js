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
    .catch(function (e) { FAIL++; FAILED_NAMES.push(name); console.log('FALLO ' + name + '\n      ' + (e && e.stack ? e.stack : e)); });
}

// Reimplementa el patrón real de saveTaskChange()/saveData(): guarda
// SOLO el campo `field`, reconciliando la intención local (respecto a
// lo último sincronizado) contra los datos vigentes, dentro de una
// transacción. mergeConflict es opcional (lo usa `projects`).
function saveField(db, docRef, field, idKey, lastSynced, local, mergeConflict) {
  var captured = null;
  return Store.withFreshDoc(db, docRef, function (fresh) {
    var freshArr = Store.fieldOrDefault(fresh, field, []);
    var rec = Store.reconcileArrayField(freshArr, lastSynced, local, idKey, mergeConflict ? { mergeConflict: mergeConflict } : undefined);
    captured = rec;
    var patch = {}; patch[field] = rec.result;
    return patch;
  }).then(function () { return captured; });
}

function run() {
  return Promise.resolve()

    .then(function () { return test('Dos usuarios modifican tareas diferentes: ambos cambios se conservan', function () {
      var db = mock.createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      var base = [{ id: 't1', text: 'Tarea 1', done: false }, { id: 't2', text: 'Tarea 2', done: false }];
      return ref.set({ standaloneTasks: base }).then(function () {
        var lastSynced = base;
        var localA = [Object.assign({}, base[0], { done: true }), base[1]];
        var localB = [base[0], Object.assign({}, base[1], { text: 'Tarea 2 editada' })];
        return Promise.all([
          saveField(db, ref, 'standaloneTasks', 'id', lastSynced, localA),
          saveField(db, ref, 'standaloneTasks', 'id', lastSynced, localB)
        ]);
      }).then(function () { return ref.get(); }).then(function (snap) {
        var arr = snap.data().standaloneTasks;
        assert.strictEqual(arr.find(function (x) { return x.id === 't1'; }).done, true);
        assert.strictEqual(arr.find(function (x) { return x.id === 't2'; }).text, 'Tarea 2 editada');
      });
    }); })

    .then(function () { return test('Dos usuarios modifican el MISMO dato: no se pisa solo, queda como conflicto pendiente', function () {
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
      }).then(function (recB) {
        assert.strictEqual(recB.conflicts.length, 1, 'debía detectarse exactamente un conflicto');
        assert.strictEqual(recB.conflicts[0].type, 'edit-edit');
        return ref.get();
      }).then(function (snap) {
        var p1 = snap.data().projects[0];
        // Ninguno de los dos se pisó solo: el valor vigente (de A, que
        // se guardó primero) se conserva hasta que alguien resuelva.
        assert.strictEqual(p1.stage, 'Concepto', 'debía quedar el cambio de A (lo que ya estaba vigente cuando B intentó guardar)');
        assert.strictEqual(p1.name, 'Proyecto X', 'el cambio de B NO debía aplicarse solo, por el conflicto');
      });
    }); })

    .then(function () { return test('Resolver un conflicto eligiendo "mi versión" la aplica después', function () {
      var db = mock.createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      var base = [{ id: 'p1', name: 'Proyecto X' }];
      return ref.set({ projects: base }).then(function () {
        return saveField(db, ref, 'projects', 'id', base, [Object.assign({}, base[0], { name: 'Cambio A' })]);
      }).then(function () {
        return saveField(db, ref, 'projects', 'id', base, [Object.assign({}, base[0], { name: 'Cambio B' })]);
      }).then(function (recB) {
        var conflict = recB.conflicts[0];
        return ref.get().then(function (snap) {
          var resolvedArr = Store.resolveConflict(snap.data().projects, conflict, 'mine', 'id');
          return ref.set({ projects: resolvedArr }, { merge: true });
        });
      }).then(function () { return ref.get(); }).then(function (snap) {
        assert.strictEqual(snap.data().projects[0].name, 'Cambio B', 'al elegir "mi versión" debe aplicarse el cambio de B');
      });
    }); })

    .then(function () { return test('Edición vs. borrado simultáneo: no se resucita solo', function () {
      var db = mock.createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      var base = [{ id: 't1', text: 'Tarea' }];
      return ref.set({ standaloneTasks: base }).then(function () {
        // A borra t1
        return saveField(db, ref, 'standaloneTasks', 'id', base, []);
      }).then(function () {
        // B, sin saber que A lo borró, edita t1
        return saveField(db, ref, 'standaloneTasks', 'id', base, [Object.assign({}, base[0], { text: 'Editada por B' })]);
      }).then(function (recB) {
        assert.strictEqual(recB.conflicts.length, 1);
        assert.strictEqual(recB.conflicts[0].type, 'edit-delete');
        return ref.get();
      }).then(function (snap) {
        assert.strictEqual(snap.data().standaloneTasks.length, 0, 'no debe resucitarse sola: sigue borrada hasta resolver');
      });
    }); })

    .then(function () { return test('Borrado vs. edición simultánea: no se borra solo', function () {
      var db = mock.createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      var base = [{ id: 't1', text: 'Tarea' }];
      return ref.set({ standaloneTasks: base }).then(function () {
        // A edita t1
        return saveField(db, ref, 'standaloneTasks', 'id', base, [Object.assign({}, base[0], { text: 'Editada por A' })]);
      }).then(function () {
        // B, sin saber que A lo editó, lo borra
        return saveField(db, ref, 'standaloneTasks', 'id', base, []);
      }).then(function (recB) {
        assert.strictEqual(recB.conflicts.length, 1);
        assert.strictEqual(recB.conflicts[0].type, 'delete-edit');
        return ref.get();
      }).then(function (snap) {
        assert.strictEqual(snap.data().standaloneTasks.length, 1, 'no debe borrarse solo: la edición vigente de A se conserva');
        assert.strictEqual(snap.data().standaloneTasks[0].text, 'Editada por A');
      });
    }); })

    .then(function () { return test('Ediciones anidadas de tareas DISTINTAS del mismo proyecto: no es conflicto', function () {
      var db = mock.createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      var base = [{ id: 'p1', name: 'Proyecto X', stageTasks: { Brief: [{ id: 'k1', text: 'Paso 1', done: false }, { id: 'k2', text: 'Paso 2', done: false }] } }];
      return ref.set({ projects: base }).then(function () {
        var localA = [JSON.parse(JSON.stringify(base[0]))];
        localA[0].stageTasks.Brief[0].done = true; // A completa Paso 1
        var localB = [JSON.parse(JSON.stringify(base[0]))];
        localB[0].stageTasks.Brief[1].done = true; // B completa Paso 2
        return saveField(db, ref, 'projects', 'id', base, localA, Store.reconcileProjectRecord).then(function () {
          return saveField(db, ref, 'projects', 'id', base, localB, Store.reconcileProjectRecord);
        });
      }).then(function (recB) {
        assert.strictEqual(recB.conflicts.length, 0, 'tareas distintas del mismo proyecto no deben chocar');
        return ref.get();
      }).then(function (snap) {
        var brief = snap.data().projects[0].stageTasks.Brief;
        assert.strictEqual(brief.find(function (t) { return t.id === 'k1'; }).done, true, 'el avance de A no debía perderse');
        assert.strictEqual(brief.find(function (t) { return t.id === 'k2'; }).done, true, 'el avance de B no debía perderse');
      });
    }); })

    .then(function () { return test('Ediciones anidadas de la MISMA tarea del mismo proyecto: sí es conflicto (solo esa tarea)', function () {
      var db = mock.createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      var base = [{ id: 'p1', name: 'Proyecto X', stageTasks: { Brief: [{ id: 'k1', text: 'Paso 1', done: false }] } }];
      return ref.set({ projects: base }).then(function () {
        var localA = [JSON.parse(JSON.stringify(base[0]))];
        localA[0].stageTasks.Brief[0].text = 'Paso 1 (texto de A)';
        var localB = [JSON.parse(JSON.stringify(base[0]))];
        localB[0].stageTasks.Brief[0].text = 'Paso 1 (texto de B)';
        return saveField(db, ref, 'projects', 'id', base, localA, Store.reconcileProjectRecord).then(function () {
          return saveField(db, ref, 'projects', 'id', base, localB, Store.reconcileProjectRecord);
        });
      }).then(function (recB) {
        assert.strictEqual(recB.conflicts.length, 1, 'la MISMA tarea editada por ambos sí debe marcarse como conflicto');
        assert.strictEqual(recB.conflicts[0].stage, 'Brief');
      });
    }); })

    .then(function () { return test('Un fallo de guardado se propaga (no se confirma éxito en silencio)', function () {
      var db = mock.createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      var brokenDb = { runTransaction: function () { return Promise.reject(new Error('permiso denegado (simulado)')); } };
      return saveField(brokenDb, ref, 'standaloneTasks', 'id', [], [{ id: 'x' }])
        .then(function () { throw new Error('debía rechazar la promesa, no resolverla'); })
        .catch(function (e) {
          assert.ok(/permiso denegado/.test(e.message), 'el error real debía propagarse: ' + e.message);
        });
    }); })

    .then(function () { return test('Reintento automático: una transacción que choca con otra vuelve a leer datos frescos', function () {
      var db = mock.createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      return ref.set({ counter: 0 }).then(function () {
        var attempts = [];
        function incrementSlowly() {
          return db.runTransaction(function (tx) {
            return tx.get(ref).then(function (snap) {
              var current = snap.data().counter;
              attempts.push(current);
              return mock.delay(15).then(function () { // deja tiempo a que la otra transacción también escriba
                tx.set(ref, { counter: current + 1 }, { merge: true });
              });
            });
          });
        }
        return Promise.all([incrementSlowly(), incrementSlowly()]).then(function () {
          return ref.get();
        }).then(function (snap) {
          assert.strictEqual(snap.data().counter, 2, 'las dos escrituras deben aplicarse (una debió reintentar con datos frescos, no perderse)');
          assert.ok(attempts.length >= 3, 'al menos una de las dos transacciones debió reintentar (se esperaban >=3 lecturas, hubo ' + attempts.length + ')');
        });
      });
    }); })

    .then(function () { return test('Vaciar una lista (borrar el último elemento) se refleja, no se ignora', function () {
      var freshDoc = { standaloneTasks: [] };
      assert.deepStrictEqual(Store.fieldOrDefault(freshDoc, 'standaloneTasks', ['valor viejo']), []);
      assert.deepStrictEqual(Store.fieldOrDefault({}, 'workAreas', ['default-a']), ['default-a']);
    }); })

    .then(function () { return test('shouldSeedCategory: no revienta si la categoría no existe (fi=-1)', function () {
      assert.strictEqual(Store.shouldSeedCategory(null, { id: 'x', stages: ['A'] }).seed, true);
    }); })

    .then(function () { return test('shouldSeedCategory: protege una plantilla ya editada AUNQUE le falte el flag customized', function () {
      // Simula una categoría personalizada ANTES de que existiera el
      // campo customized: nunca se marcó, pero sí tiene contenido real.
      var fresh = { id: 'branding', stages: ['Solo mi etapa'], templates: { 'Solo mi etapa': [{ text: 'x' }] }, tplVersion: 1 };
      var cfg = { id: 'branding', stages: ['Brief', 'Concepto', 'Entrega'], tplVersion: 99, templates: { Brief: [{ text: 'y' }] } };
      var r = Store.shouldSeedCategory(fresh, cfg);
      assert.strictEqual(r.seed, false, 'la ausencia de customized no prueba que nadie la haya editado');
      assert.strictEqual(r.updateAvailable, true);
    }); })

    .then(function () { return test('shouldSeedCategory: sí siembra una categoría sin ninguna plantilla todavía', function () {
      var fresh = { id: 'branding', stages: ['Brief'], templates: {} };
      var cfg = { id: 'branding', stages: ['Brief', 'Concepto'], tplVersion: 2, templates: { Brief: [{ text: 'y' }] } };
      assert.strictEqual(Store.shouldSeedCategory(fresh, cfg).seed, true);
    }); })

    .then(function () { return test('shouldSeedStageTasks: siembra la primera vez', function () {
      assert.strictEqual(Store.shouldSeedStageTasks({ stageTasks: {}, stageTasksSeeded: {} }, 'Brief', [{ text: 'Paso 1' }]), true);
    }); })

    .then(function () { return test('shouldSeedStageTasks: NO revive tareas borradas a propósito', function () {
      var project = { stageTasks: { Brief: [] }, stageTasksSeeded: { Brief: true } };
      assert.strictEqual(Store.shouldSeedStageTasks(project, 'Brief', [{ text: 'Paso 1' }]), false);
    }); })

    .then(function () { return test('reconcileMapField: dos miembros distintos editados a la vez, ambos se conservan', function () {
      var fresh = { m1: ['campo'], m2: ['diseno'] };
      var lastSynced = fresh;
      var localA = { m1: ['campo', 'taller'], m2: ['diseno'] }; // A agrega un área a m1
      var localB = { m1: ['campo'], m2: ['diseno', 'campo'] }; // B agrega un área a m2
      var recA = Store.reconcileMapField(fresh, lastSynced, localA);
      var recB = Store.reconcileMapField(recA.result, lastSynced, localB);
      assert.strictEqual(recB.conflicts.length, 0);
      assert.deepStrictEqual(recB.result.m1, ['campo', 'taller']);
      assert.deepStrictEqual(recB.result.m2, ['diseno', 'campo']);
    }); })

    .then(function () { return test('reconcileMapField: la MISMA llave editada por dos lados sí es conflicto', function () {
      var fresh = { m1: ['campo'] };
      var recA = Store.reconcileMapField(fresh, fresh, { m1: ['campo', 'taller'] });
      var recB = Store.reconcileMapField(recA.result, fresh, { m1: ['campo', 'diseno'] });
      assert.strictEqual(recB.conflicts.length, 1);
      assert.strictEqual(recB.conflicts[0].id, 'm1');
    }); })

    .then(function () { return test('reconcileNewIds: dos ids optimistas iguales se reasignan sin perder el registro', function () {
      var freshArr = [{ id: 1 }, { id: 2 }];
      var r = Store.reconcileNewIds(freshArr, 3, [{ id: 3, text: 'Nuevo A' }, { id: 3, text: 'Nuevo B (colisión)' }]);
      var ids = r.items.map(function (x) { return x.id; });
      assert.strictEqual(new Set(ids).size, 2, 'los dos registros deben terminar con ids distintos');
      assert.strictEqual(r.items.length, 2, 'ningún registro debe perderse');
    }); })

    .then(function () { return test('buildQuoteConversionPatch: conversión simultánea desde dos sesiones no duplica el proyecto', function () {
      var db = mock.createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      var categories = [{ id: 'branding', stages: ['Brief', 'Entrega'] }];
      var quote = { id: 1, name: 'Solicitud A', client: 'Cliente X', tipoCat: 'branding', monto: '15000' };
      return ref.set({ projects: [quote], categories: categories, nextId: 100 }).then(function () {
        function convert() {
          return db.runTransaction(function (tx) {
            return tx.get(ref).then(function (snap) {
              var d = snap.data();
              var r = Store.buildQuoteConversionPatch(d.projects, d.nextId, 1, d.categories);
              return mock.delay(10).then(function () { // fuerza a que ambas lean antes de que cualquiera escriba
                if (r.ok) tx.set(ref, { projects: r.projects, nextId: r.nextId }, { merge: true });
                return r;
              });
            });
          });
        }
        return Promise.all([convert(), convert()]);
      }).then(function (results) {
        var createdCount = results.filter(function (r) { return r.ok; }).length;
        assert.strictEqual(createdCount, 1, 'de las dos sesiones, exactamente una debía crear el proyecto');
        return ref.get();
      }).then(function (snap) {
        var projects = snap.data().projects;
        var newProjects = projects.filter(function (p) { return p.sourceQuoteId === 1; });
        assert.strictEqual(newProjects.length, 1, 'no debe haber dos proyectos creados desde la misma cotización');
        var quoteNow = projects.find(function (p) { return p.id === 1; });
        assert.strictEqual(quoteNow.converted, true);
        assert.strictEqual(quoteNow.convertedProjectId, newProjects[0].id);
      });
    }); })

    .then(function () {
      console.log('\n' + PASS + ' pasaron, ' + FAIL + ' fallaron.');
      if (FAIL) { console.log('Fallaron: ' + FAILED_NAMES.join(', ')); process.exitCode = 1; }
    });
}

run();
