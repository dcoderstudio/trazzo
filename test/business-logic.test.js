// ── Pruebas de la lógica específica de los puntos 2, 3 y 4 ──────────
// equipo.html y proyectos.html son <script> monolíticos atados al DOM
// y a Firebase real, así que no se pueden importar directo en Node.
// Estas pruebas reimplementan la MISMA lógica exacta que se escribió
// en esos archivos (mismo algoritmo, línea por línea) para verificarla
// de forma aislada. Es una prueba de equivalencia de lógica, no una
// ejecución real de equipo.html/proyectos.html en un navegador — eso
// queda pendiente de confirmar manualmente (ver reporte final).
'use strict';
var assert = require('assert');
var PASS = 0, FAIL = 0, FAILED_NAMES = [];
function test(name, fn) {
  try { fn(); PASS++; console.log('  OK  ' + name); }
  catch (e) { FAIL++; FAILED_NAMES.push(name); console.log('FALLO ' + name + '\n      ' + e.message); }
}

// ── taskDoneChanges (equipo.html) ────────────────────────────────
function taskDoneChanges(isDone, colStatusOverride) {
  if (isDone) return { done: true, colStatus: colStatusOverride !== undefined ? colStatusOverride : 'done', doneAt: '2026-01-15' };
  return { done: false, colStatus: colStatusOverride !== undefined ? colStatusOverride : null, doneAt: null };
}

test('taskDoneChanges: completar fija done+colStatus+doneAt juntos', function () {
  var c = taskDoneChanges(true);
  assert.deepStrictEqual(c, { done: true, colStatus: 'done', doneAt: '2026-01-15' });
});
test('taskDoneChanges: descompletar limpia colStatus y doneAt juntos', function () {
  var c = taskDoneChanges(false);
  assert.deepStrictEqual(c, { done: false, colStatus: null, doneAt: null });
});
test('taskDoneChanges: respeta la columna de kanban al completar (no siempre "done" genérico)', function () {
  var c = taskDoneChanges(false, 'inprogress');
  assert.strictEqual(c.colStatus, 'inprogress');
  assert.strictEqual(c.doneAt, null);
});

// ── dropTaskOnArea (equipo.html) — preserva identidad ────────────
function dropTaskOnArea(task, areaId, workAreas, standaloneTasks) {
  var area = null; for (var i = 0; i < workAreas.length; i++) { if (workAreas[i].id === areaId) { area = workAreas[i]; break; } }
  var areaName = area ? area.name : areaId;
  if (task._type === 'standalone') {
    return standaloneTasks.map(function (t) { return t.id === task.id ? Object.assign({}, t, { area: areaName }) : t; });
  }
  return standaloneTasks.concat([{
    id: 'st_migrated_test', text: task.text, deadline: task.deadline || null, resp: task.resp || null, area: areaName,
    done: false, colStatus: null, priority: false,
    sourceProjectId: task._projId || null, sourceStage: task._stage || null, sourceTaskId: task.id
  }]);
}

test('dropTaskOnArea: tarea libre conserva su id al asignar área', function () {
  var workAreas = [{ id: 'campo', name: 'Campo' }];
  var tasks = [{ id: 'st_1', text: 'Revisar sitio', _type: 'standalone' }];
  var result = dropTaskOnArea(tasks[0], 'campo', workAreas, tasks);
  assert.strictEqual(result.length, 1, 'no debe crear un registro nuevo para una tarea libre');
  assert.strictEqual(result[0].id, 'st_1', 'el id original debe conservarse');
  assert.strictEqual(result[0].area, 'Campo');
});
test('dropTaskOnArea: tarea de proyecto queda con vínculo de origen, no huérfana', function () {
  var workAreas = [{ id: 'diseno', name: 'Diseño' }];
  var projectTask = { id: 'pt_9', text: 'Renders finales', _type: 'project', _projId: 77, _stage: 'Concepto' };
  var result = dropTaskOnArea(projectTask, 'diseno', workAreas, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].sourceProjectId, 77, 'debe guardar de qué proyecto vino');
  assert.strictEqual(result[0].sourceStage, 'Concepto');
  assert.strictEqual(result[0].sourceTaskId, 'pt_9', 'debe guardar el id original de la tarea de origen');
});

// ── convertirAProyecto (proyectos.html) — idempotencia ───────────
function convertirAProyecto(quoteId, projects, categories, nextIdRef) {
  var p = projects.find(function (x) { return x.id === quoteId; });
  if (!p) return { projects: projects, created: false };
  if (p.converted) {
    var already = p.convertedProjectId && projects.some(function (x) { return x.id === p.convertedProjectId; });
    return { projects: projects, created: false, blockedByIdempotency: true, alreadyExists: !!already };
  }
  var cat = categories.find(function (c) { return c.id === p.tipoCat; });
  if (!cat) return { projects: projects, created: false };
  var newId = nextIdRef.value++;
  p.converted = true;
  p.convertedProjectId = newId;
  var newProj = { id: newId, name: p.name, client: p.client, catId: p.tipoCat, stage: cat.stages[0], monto: p.monto || '', sourceQuoteId: p.id };
  return { projects: projects.concat([newProj]), created: true, newProj: newProj };
}

test('convertirAProyecto: convertir dos veces no crea un segundo proyecto', function () {
  var categories = [{ id: 'branding', stages: ['Brief', 'Entrega'] }];
  var projects = [{ id: 1, name: 'Solicitud A', client: 'Cliente X', tipoCat: 'branding', monto: '15000' }];
  var nextIdRef = { value: 100 };
  var r1 = convertirAProyecto(1, projects, categories, nextIdRef);
  assert.strictEqual(r1.created, true);
  assert.strictEqual(r1.projects.length, 2, 'primera conversión sí debe crear el proyecto');
  var r2 = convertirAProyecto(1, r1.projects, categories, nextIdRef);
  assert.strictEqual(r2.created, false, 'la segunda conversión no debe crear otro proyecto');
  assert.strictEqual(r2.blockedByIdempotency, true);
  assert.strictEqual(r2.projects.length, 2, 'sigue habiendo solo un proyecto creado, no dos');
});
test('convertirAProyecto: el proyecto nuevo conserva monto y el vínculo con la cotización', function () {
  var categories = [{ id: 'branding', stages: ['Brief', 'Entrega'] }];
  var projects = [{ id: 1, name: 'Solicitud A', client: 'Cliente X', tipoCat: 'branding', monto: '15000' }];
  var nextIdRef = { value: 100 };
  var r1 = convertirAProyecto(1, projects, categories, nextIdRef);
  assert.strictEqual(r1.newProj.monto, '15000', 'el monto de la cotización debía trasladarse');
  assert.strictEqual(r1.newProj.sourceQuoteId, 1, 'el proyecto nuevo debe apuntar a la cotización de origen');
  var quote = r1.projects.find(function (x) { return x.id === 1; });
  assert.strictEqual(quote.convertedProjectId, r1.newProj.id, 'la cotización debe apuntar al proyecto creado');
});

// ── cleanOldDoneTasks (equipo.html) — archiva, no borra ──────────
function cleanOldDoneTasks(standaloneTasks, archivedTasks, cutoffDs) {
  var toArchive = standaloneTasks.filter(function (t) { return t.done && t.deadline && t.deadline < cutoffDs; });
  if (!toArchive.length) return { standaloneTasks: standaloneTasks, archivedTasks: archivedTasks, archivedNow: [] };
  var kept = standaloneTasks.filter(function (t) { return !(t.done && t.deadline && t.deadline < cutoffDs); });
  var archived = toArchive.map(function (t) { return Object.assign({}, t, { archivedAt: '2026-01-15' }); });
  return { standaloneTasks: kept, archivedTasks: archivedTasks.concat(archived), archivedNow: archived };
}

test('cleanOldDoneTasks: una tarea atrasada y ya hecha se archiva, no se borra', function () {
  var tasks = [
    { id: 't1', text: 'Tarea vieja terminada', done: true, deadline: '2025-01-01' },
    { id: 't2', text: 'Tarea reciente', done: false, deadline: '2026-01-10' }
  ];
  var r = cleanOldDoneTasks(tasks, [], '2026-01-01');
  assert.strictEqual(r.standaloneTasks.length, 1, 'debe salir de la lista activa');
  assert.strictEqual(r.standaloneTasks[0].id, 't2');
  assert.strictEqual(r.archivedTasks.length, 1, 'debe quedar conservada en archivedTasks, no desaparecer');
  assert.strictEqual(r.archivedTasks[0].id, 't1');
  assert.strictEqual(r.archivedTasks[0].text, 'Tarea vieja terminada', 'el contenido original se conserva íntegro');
});

console.log('\n' + PASS + ' pasaron, ' + FAIL + ' fallaron.');
if (FAIL) { console.log('Fallaron: ' + FAILED_NAMES.join(', ')); process.exitCode = 1; }
