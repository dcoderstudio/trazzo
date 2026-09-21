// ── Pruebas de las funciones REALES de datastore.js que usan ────────
// equipo.html y proyectos.html para done/colStatus/doneAt, asignar
// tareas a áreas, y archivar tareas hechas. Antes este archivo tenía
// una copia de la lógica solo para probarla; ahora llama directo a
// datastore.js — es el mismo código que corre en las páginas.
'use strict';
var assert = require('assert');
var Store = require('../datastore.js');
var PASS = 0, FAIL = 0, FAILED_NAMES = [];
function test(name, fn) {
  try { fn(); PASS++; console.log('  OK  ' + name); }
  catch (e) { FAIL++; FAILED_NAMES.push(name); console.log('FALLO ' + name + '\n      ' + e.message); }
}

// ── taskDoneChanges ───────────────────────────────────────────────
test('taskDoneChanges: completar fija done+colStatus+doneAt juntos', function () {
  var c = Store.taskDoneChanges(true, undefined, '2026-01-15');
  assert.deepStrictEqual(c, { done: true, colStatus: 'done', doneAt: '2026-01-15' });
});
test('taskDoneChanges: descompletar limpia colStatus y doneAt juntos', function () {
  var c = Store.taskDoneChanges(false);
  assert.deepStrictEqual(c, { done: false, colStatus: null, doneAt: null });
});
test('taskDoneChanges: respeta la columna de kanban de destino', function () {
  var c = Store.taskDoneChanges(false, 'inprogress');
  assert.strictEqual(c.colStatus, 'inprogress');
  assert.strictEqual(c.doneAt, null);
});

// ── buildAreaAssignPatch ──────────────────────────────────────────
test('buildAreaAssignPatch: tarea libre -> patch sobre standaloneTasks, mismo id', function () {
  var workAreas = [{ id: 'campo', name: 'Campo' }];
  var r = Store.buildAreaAssignPatch({ id: 'st_1', _type: 'standalone' }, 'campo', workAreas);
  assert.strictEqual(r.target, 'standaloneTasks');
  assert.strictEqual(r.taskId, 'st_1');
  assert.strictEqual(r.patch.area, 'Campo');
});
test('buildAreaAssignPatch: tarea de proyecto -> patch sobre el registro ORIGINAL (una sola fuente de verdad)', function () {
  var workAreas = [{ id: 'diseno', name: 'Diseño' }];
  var projectTask = { id: 'pt_9', _type: 'project', _projId: 77, _stage: 'Concepto' };
  var r = Store.buildAreaAssignPatch(projectTask, 'diseno', workAreas);
  assert.strictEqual(r.target, 'projectStageTask', 'no debe crear un registro nuevo/independiente');
  assert.strictEqual(r.projectId, 77);
  assert.strictEqual(r.stage, 'Concepto');
  assert.strictEqual(r.taskId, 'pt_9');
  assert.strictEqual(r.patch.area, 'Diseño');
});

// ── computeArchive ────────────────────────────────────────────────
test('computeArchive: una tarea atrasada y ya hecha se archiva, no se borra', function () {
  var tasks = [
    { id: 't1', text: 'Tarea vieja terminada', done: true, deadline: '2025-01-01' },
    { id: 't2', text: 'Tarea reciente', done: false, deadline: '2026-01-10' }
  ];
  var r = Store.computeArchive(tasks, '2026-01-01', '2026-01-15');
  assert.strictEqual(r.kept.length, 1);
  assert.strictEqual(r.kept[0].id, 't2');
  assert.strictEqual(r.archived.length, 1, 'debe quedar conservada, no desaparecer');
  assert.strictEqual(r.archived[0].id, 't1');
  assert.strictEqual(r.archived[0].archivedAt, '2026-01-15');
  assert.strictEqual(r.archived[0].text, 'Tarea vieja terminada', 'el contenido original se conserva íntegro');
});
test('computeArchive: no toca tareas recientes ni pendientes', function () {
  var tasks = [{ id: 't1', text: 'Pendiente', done: false, deadline: '2020-01-01' }];
  var r = Store.computeArchive(tasks, '2026-01-01', '2026-01-15');
  assert.strictEqual(r.archived.length, 0);
  assert.strictEqual(r.kept.length, 1);
});

console.log('\n' + PASS + ' pasaron, ' + FAIL + ' fallaron.');
if (FAIL) { console.log('Fallaron: ' + FAILED_NAMES.join(', ')); process.exitCode = 1; }
