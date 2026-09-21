// ── SIMULACIÓN de migración: areaTasks{} → standaloneTasks[] ────────
// DRY-RUN: no escribe en ningún Firestore, real o de prueba. Solo
// toma un documento de ejemplo (ficticio) y muestra qué se crearía.
//
// dropTaskOnArea() nunca guardó un vínculo de vuelta a la tarea de
// origen (ni siquiera en la versión con sourceTaskId de un borrador
// anterior de este trabajo — ESA solo aplica hacia adelante, no
// reconstruye lo que ya se perdió). Para los registros que YA existen
// en areaTasks{}, el vínculo original se perdió en el momento en que
// se crearon: no hay ningún campo que loexplicite.
//
// Esta simulación NO intenta adivinar el vínculo perdido comparando
// texto (eso sería fusionar por nombre, que el equipo pidió evitar
// explícitamente: dos tareas de proyectos distintos pueden compartir
// el mismo texto por coincidencia). En vez de eso, busca coincidencias
// de TEXTO EXACTO dentro de standaloneTasks/stageTasks solo para
// clasificar cada registro en una de tres categorías de confianza, y
// deja la decisión final a una persona:
//   - "posible-vinculo": exactamente UNA tarea en todo el workspace
//     tiene el mismo texto (y no está ya marcada como referenciada) —
//     evidencia débil, no se fusiona sola; se marca para revisión.
//   - "ambiguo": DOS O MÁS tareas comparten ese texto — no se puede
//     saber cuál es, y NO se elige ninguna automáticamente.
//   - "sin-evidencia": no hay ninguna coincidencia — se migraría como
//     tarea libre nueva e independiente, sin pretender un vínculo que
//     no se puede sustentar.
//
// Ejecutar: node test/migrate-area-tasks.simulate.js
'use strict';

// ── Documento de ejemplo (FICTICIO) ──────────────────────────────
var sampleDoc = {
  workAreas: [
    { id: 'campo', name: 'Campo', color: '#27AE72' },
    { id: 'diseno', name: 'Diseño', color: '#1A6FD4' }
  ],
  standaloneTasks: [
    { id: 'st_1001', text: 'Cotizar mobiliario', area: 'Diseño', resp: 'AR', deadline: '2026-01-10', done: false }
  ],
  projects: [
    { id: 501, name: 'Proyecto Alfa', stageTasks: { Brief: [{ id: 'k1', text: 'Enviar moodboard al cliente', done: false }] } },
    { id: 502, name: 'Proyecto Beta', stageTasks: { Concepto: [{ id: 'k2', text: 'Enviar moodboard al cliente', done: true }] } }
  ],
  areaTasks: {
    campo: [
      { id: 'at_1700000000001', text: 'Revisar avance de instalación', deadline: '2025-12-01', resp: 'SV', done: false },
      { id: 'at_1700000000002', text: 'Confirmar entrega de materiales', deadline: '', resp: null, done: true }
    ],
    diseno: [
      // Este texto coincide EXACTO con tareas de dos proyectos distintos (501 y 502) -> ambiguo, no se puede saber cuál era.
      { id: 'at_1700000000003', text: 'Enviar moodboard al cliente', deadline: '2025-11-20', resp: 'AR', done: false }
    ]
  }
};

function today() { return new Date().toISOString().slice(0, 10); }

function findTextMatches(text, doc) {
  var matches = [];
  (doc.standaloneTasks || []).forEach(function (t) { if (t.text === text) matches.push({ where: 'standaloneTasks', id: t.id }); });
  (doc.projects || []).forEach(function (p) {
    Object.keys(p.stageTasks || {}).forEach(function (stage) {
      (p.stageTasks[stage] || []).forEach(function (t) {
        if (t.text === text) matches.push({ where: 'proyecto', projectId: p.id, projectName: p.name, stage: stage, id: t.id });
      });
    });
  });
  return matches;
}

function classify(matches) {
  if (matches.length === 0) return 'sin-evidencia';
  if (matches.length === 1) return 'posible-vinculo';
  return 'ambiguo';
}

function simulateMigration(doc) {
  var areasById = {};
  (doc.workAreas || []).forEach(function (a) { areasById[a.id] = a; });
  var existingIds = {};
  (doc.standaloneTasks || []).forEach(function (t) { existingIds[t.id] = true; });

  var report = [];

  Object.keys(doc.areaTasks || {}).forEach(function (areaId) {
    var areaName = areasById[areaId] ? areasById[areaId].name : areaId;
    (doc.areaTasks[areaId] || []).forEach(function (t) {
      var matches = findTextMatches(t.text, doc);
      var confidence = classify(matches);
      var newId = 'mig_' + t.id;
      report.push({
        original: t, areaId: areaId, areaName: areaName,
        newId: existingIds[newId] ? null : newId,
        alreadyMigrated: !!existingIds[newId],
        confidence: confidence,
        matches: matches
      });
    });
  });

  return report;
}

var report = simulateMigration(sampleDoc);

console.log('── SIMULACIÓN (no se escribió nada) ──────────────────────');
console.log('Documento de entrada: FICTICIO (no es un export de producción).');
console.log('');
report.forEach(function (r) {
  if (r.alreadyMigrated) { console.log('  = ' + r.original.id + ' ya se migró antes (se omite)'); return; }
  console.log('  [' + r.confidence.toUpperCase() + '] ' + r.original.id + '  "' + r.original.text + '"  área=' + r.areaName);
  if (r.confidence === 'ambiguo') {
    console.log('      NO se fusiona por nombre. Coincidencias encontradas (elegir a mano si aplica):');
    r.matches.forEach(function (m) { console.log('        - ' + (m.where === 'proyecto' ? ('proyecto "' + m.projectName + '" / etapa "' + m.stage + '" / tarea ' + m.id) : ('tarea libre ' + m.id))); });
    console.log('      Se migraría como tarea libre INDEPENDIENTE (sin vínculo) hasta que alguien decida.');
  } else if (r.confidence === 'posible-vinculo') {
    var m = r.matches[0];
    console.log('      Posible origen (revisar antes de confirmar, no se vincula solo): ' + (m.where === 'proyecto' ? ('proyecto "' + m.projectName + '" / etapa "' + m.stage + '"') : 'otra tarea libre'));
  } else {
    console.log('      Sin ninguna coincidencia de texto — se migraría como tarea libre nueva.');
  }
});
console.log('');
console.log('En los tres casos se crearía como tarea libre en standaloneTasks (id ' +
  'mig_<id original>), marcada con _migratedFrom:"areaTasks" y su confianza.');
console.log('Ninguna se fusiona automáticamente con un proyecto por solo compartir texto.');
console.log('');
console.log('areaTasks{} y sus registros originales NO se tocan ni se borran en este paso.');
console.log('');
console.log('Para correr esto de verdad contra producción haría falta:');
console.log('  1) Exportar el documento real workspace/proyectos (solo lectura).');
console.log('  2) Revisar este mismo reporte con esos datos reales.');
console.log('  3) Para cada caso "posible-vinculo" o "ambiguo", una persona decide a mano');
console.log('     si de verdad corresponde a esa tarea de proyecto, o si se migra como');
console.log('     tarea libre independiente.');
console.log('  4) Decidir si además se quiere borrar areaTasks{} después, o dejarlo como');
console.log('     respaldo histórico sin usar.');
