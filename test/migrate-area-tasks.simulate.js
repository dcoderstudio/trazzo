// ── SIMULACIÓN de migración: areaTasks{} → standaloneTasks[] ────────
// Esto es un DRY-RUN: no escribe en ningún Firestore, real o de
// prueba. Solo toma un documento de ejemplo (ficticio) con la misma
// forma que workspace/proyectos y muestra qué se crearía y por qué.
//
// Motivo: dropTaskOnArea() creaba entradas en areaTasks{} con un id
// nuevo, sin ningún campo que las ligue a la tarea u proyecto de
// origen. Ese vínculo se perdió en el momento en que se crearon —
// no se puede reconstruir desde los datos que ya existen. Lo que SÍ
// se puede hacer es dejar de tenerlas invisibles (hoy no las muestra
// ninguna vista vigente) migrándolas al modelo único que ya usa el
// resto de la app (standaloneTasks[].area), preservando el registro
// y marcándolo con trazabilidad de que viene de esta migración.
//
// Ejecutar: node test/migrate-area-tasks.simulate.js
'use strict';

// ── Documento de ejemplo (FICTICIO) ──────────────────────────────
// Representa cómo podría verse workspace/proyectos si alguien usó la
// franja de áreas antes de que quedara desconectada de la interfaz.
var sampleDoc = {
  workAreas: [
    { id: 'campo', name: 'Campo', color: '#27AE72' },
    { id: 'diseno', name: 'Diseño', color: '#1A6FD4' }
  ],
  standaloneTasks: [
    { id: 'st_1001', text: 'Cotizar mobiliario', area: 'Diseño', resp: 'AR', deadline: '2026-01-10', done: false }
  ],
  areaTasks: {
    campo: [
      { id: 'at_1700000000001', text: 'Revisar avance de instalación', deadline: '2025-12-01', resp: 'SV', done: false },
      { id: 'at_1700000000002', text: 'Confirmar entrega de materiales', deadline: '', resp: null, done: true }
    ],
    diseno: [
      { id: 'at_1700000000003', text: 'Enviar moodboard al cliente', deadline: '2025-11-20', resp: 'AR', done: false }
    ]
  }
};

function today() { return new Date().toISOString().slice(0, 10); }

function simulateMigration(doc) {
  var areasById = {};
  (doc.workAreas || []).forEach(function (a) { areasById[a.id] = a; });
  var existingIds = {};
  (doc.standaloneTasks || []).forEach(function (t) { existingIds[t.id] = true; });

  var created = [];
  var skipped = [];

  Object.keys(doc.areaTasks || {}).forEach(function (areaId) {
    var areaName = areasById[areaId] ? areasById[areaId].name : areaId;
    (doc.areaTasks[areaId] || []).forEach(function (t) {
      var newId = 'mig_' + t.id;
      if (existingIds[newId]) { skipped.push({ reason: 'id ya migrado antes', original: t }); return; }
      created.push({
        id: newId,
        text: t.text,
        area: areaName,
        resp: t.resp || null,
        deadline: t.deadline || null,
        done: !!t.done,
        colStatus: t.done ? 'done' : null,
        doneAt: t.done ? today() : null,
        priority: false,
        _migratedFrom: 'areaTasks',
        _migratedFromAreaId: areaId,
        _migratedOriginalId: t.id
      });
    });
  });

  return { created: created, skipped: skipped };
}

var result = simulateMigration(sampleDoc);

console.log('── SIMULACIÓN (no se escribió nada) ──────────────────────');
console.log('Documento de entrada: FICTICIO (no es un export de producción).');
console.log('');
console.log(result.created.length + ' registro(s) se crearían en standaloneTasks:');
result.created.forEach(function (t) {
  console.log('  + ' + t.id + '  "' + t.text + '"  área=' + t.area + '  hecha=' + t.done + '  (viene de areaTasks.' + t._migratedFromAreaId + '.' + t._migratedOriginalId + ')');
});
if (result.skipped.length) {
  console.log('');
  console.log(result.skipped.length + ' se omitirían:');
  result.skipped.forEach(function (s) { console.log('  - ' + s.reason + ': ' + JSON.stringify(s.original)); });
}
console.log('');
console.log('areaTasks{} y sus registros originales NO se tocan ni se borran en este');
console.log('paso — quedarían intactos hasta confirmar que la migración se ve bien.');
console.log('');
console.log('Para correr esto de verdad contra producción haría falta:');
console.log('  1) Exportar el documento real workspace/proyectos (solo lectura).');
console.log('  2) Revisar el reporte generado con esos datos reales (este mismo script,');
console.log('     apuntando a ese export en vez de sampleDoc).');
console.log('  3) Decidir con el equipo si además se quiere borrar areaTasks{} después,');
console.log('     o dejarlo como respaldo histórico sin usar.');
