// ── Pruebas sobre las páginas REALES (equipo.html / proyectos.html) ─
// Entorno aislado: jsdom + mock de Firestore en memoria. NO se
// conecta a ningún proyecto de Firebase real (ni de producción ni de
// prueba en la nube) — el SDK de Firebase se sustituye por completo
// antes de que corra el resto del script de la página.
//
// A diferencia de datastore.test.js / business-logic.test.js (que
// prueban las funciones puras de datastore.js), estas pruebas cargan
// el HTML real y llaman a las funciones tal como quedan expuestas en
// window después de que el <script> de la página corre — es lo más
// cercano a "la página real" que se puede probar sin un navegador de
// verdad.
'use strict';
var assert = require('assert');
var path = require('path');
var { loadPage, settle } = require('./dom-harness.js');
var { createMockFirestoreServer } = require('./mock-firestore.js');

var PASS = 0, FAIL = 0, FAILED_NAMES = [];
function test(name, fn) {
  return Promise.resolve().then(fn)
    .then(function () { PASS++; console.log('  OK  ' + name); })
    .catch(function (e) { FAIL++; FAILED_NAMES.push(name); console.log('FALLO ' + name + '\n      ' + (e && e.stack ? e.stack : e)); });
}

var EQUIPO = path.join(__dirname, '..', 'equipo.html');
var PROYECTOS = path.join(__dirname, '..', 'proyectos.html');

function run() {
  return Promise.resolve()

    .then(function () { return test('equipo.html carga sin errores en el entorno aislado (jsdom + mock)', function () {
      var page = loadPage(EQUIPO);
      return settle(page.window, 150).then(function () {
        assert.strictEqual(page.errors.length, 0, 'errores: ' + page.errors.map(String).join(' | '));
        assert.strictEqual(typeof page.window.saveTaskChange, 'function');
      });
    }); })

    .then(function () { return test('proyectos.html carga sin errores en el entorno aislado (jsdom + mock)', function () {
      // proyectos.html envuelve su script principal en un IIFE — a
      // diferencia de equipo.html, sus funciones (saveData,
      // convertirAProyecto...) no quedan expuestas en window, así que
      // aquí solo se puede verificar que la página cargó y renderizó
      // sin errores. Las pruebas de comportamiento real de abajo la
      // ejercitan a través del DOM (clics reales sobre botones reales)
      // en vez de llamar funciones internas directamente.
      var page = loadPage(PROYECTOS);
      return settle(page.window, 150).then(function () {
        assert.strictEqual(page.errors.length, 0, 'errores: ' + page.errors.map(String).join(' | '));
        assert.ok(page.document.getElementById('tabs'), 'el tablero debía renderizar la barra de pestañas');
      });
    }); })

    .then(function () { return test('equipo.html real: completar una tarea con completeOrgTask() la guarda de verdad en el documento', function () {
      var db = createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      return ref.set({ standaloneTasks: [{ id: 'st_1', text: 'Cotizar mobiliario', done: false, area: 'Diseño' }], workAreas: [{ id: 'diseno', name: 'Diseño' }] }).then(function () {
        var page = loadPage(EQUIPO, { db: db });
        return settle(page.window, 150).then(function () {
          var task = page.window.standaloneTasks.find(function (t) { return t.id === 'st_1'; });
          assert.ok(task, 'la tarea sembrada debía cargarse desde el mock al iniciar la página');
          // completeOrgTask() tiene un setTimeout(220ms) de animación antes de guardar.
          page.window.completeOrgTask(task, null);
          return settle(page.window, 400);
        }).then(function () {
          return ref.get();
        }).then(function (snap) {
          var saved = snap.data().standaloneTasks.find(function (t) { return t.id === 'st_1'; });
          assert.strictEqual(saved.done, true, 'debía quedar guardada como hecha en el documento (no solo en memoria)');
          assert.ok(saved.doneAt, 'debía quedar doneAt');
        });
      });
    }); })

    .then(function () { return test('Dos SESIONES REALES de equipo.html (misma pestaña simulada dos veces) editando tareas distintas: ambas se conservan', function () {
      var db = createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      return ref.set({ standaloneTasks: [{ id: 't1', text: 'Tarea 1', done: false }, { id: 't2', text: 'Tarea 2', done: false }] }).then(function () {
        var pageA = loadPage(EQUIPO, { db: db });
        var pageB = loadPage(EQUIPO, { db: db });
        return Promise.all([settle(pageA.window, 100), settle(pageB.window, 100)]).then(function () {
          // A completa t1 en su copia; B completa t2 en la suya.
          pageA.window.standaloneTasks = pageA.window.standaloneTasks.map(function (t) { return t.id === 't1' ? Object.assign({}, t, { done: true }) : t; });
          pageB.window.standaloneTasks = pageB.window.standaloneTasks.map(function (t) { return t.id === 't2' ? Object.assign({}, t, { done: true }) : t; });
          return Promise.all([pageA.window.saveTaskChange(), pageB.window.saveTaskChange()]);
        }).then(function () {
          return ref.get();
        }).then(function (snap) {
          var arr = snap.data().standaloneTasks;
          assert.strictEqual(arr.find(function (t) { return t.id === 't1'; }).done, true, 'el cambio de la sesión A no debía perderse');
          assert.strictEqual(arr.find(function (t) { return t.id === 't2'; }).done, true, 'el cambio de la sesión B no debía perderse');
        });
      });
    }); })

    .then(function () { return test('proyectos.html real: dos sesiones hacen clic en "Convertir a proyecto" de la MISMA cotización a la vez -> un solo proyecto', function () {
      // Sin acceso directo a convertirAProyecto() (ver nota arriba),
      // esta prueba dispara la conversión de la forma más real posible:
      // haciendo clic de verdad sobre el botón que renderiza la propia
      // página, en dos "sesiones" (dos cargas de la página) que
      // comparten el mismo documento simulado.
      var db = createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      return ref.set({
        projects: [{ id: 1, name: 'Solicitud A', client: 'Cliente X', catId: 'cotizaciones', stage: 'Aceptado', tipoCat: 'branding', monto: '15000', team: [], stageEntryDates: {} }],
        categories: [
          { id: 'cotizaciones', label: 'Solicitudes', color: '#27AE72', stages: ['Solicitud recibida', 'En proceso', 'Enviado', 'Aceptado', 'Rechazado', 'Entregado'] },
          { id: 'branding', label: 'Branding', color: '#D4537E', stages: ['Brief', 'Entrega'] }
        ],
        nextId: 100
      }).then(function () {
        var pageA = loadPage(PROYECTOS, { db: db });
        var pageB = loadPage(PROYECTOS, { db: db });
        return Promise.all([settle(pageA.window, 200), settle(pageB.window, 200)]).then(function () {
          var btnA = pageA.document.querySelector('.conv-btn[data-pid="1"]');
          var btnB = pageB.document.querySelector('.conv-btn[data-pid="1"]');
          assert.ok(btnA && btnB, 'el botón "Convertir a proyecto" debía estar renderizado en ambas sesiones');
          btnA.dispatchEvent(new pageA.window.Event('click', { bubbles: true }));
          btnB.dispatchEvent(new pageB.window.Event('click', { bubbles: true }));
          return Promise.all([settle(pageA.window, 150), settle(pageB.window, 150)]);
        });
      }).then(function () {
        return ref.get();
      }).then(function (snap) {
        var created = snap.data().projects.filter(function (p) { return p.sourceQuoteId === 1; });
        assert.strictEqual(created.length, 1, 'no debía crearse más de un proyecto desde la misma cotización pedida por dos sesiones a la vez');
        var quote = snap.data().projects.find(function (p) { return p.id === 1; });
        assert.strictEqual(quote.converted, true);
        assert.strictEqual(quote.convertedProjectId, created[0].id);
      });
    }); })

    .then(function () { return test('equipo.html real: un fallo de guardado deja un aviso visible en el DOM, no solo en consola', function () {
      var db = createMockFirestoreServer();
      var ref = db.doc('workspace/proyectos');
      return ref.set({ standaloneTasks: [{ id: 't1', text: 'Tarea', done: false }] }).then(function () {
        var page = loadPage(EQUIPO, { db: db });
        return settle(page.window, 120).then(function () {
          // Se rompe la transacción DESPUÉS de cargar la página, para
          // que el siguiente guardado falle de verdad.
          page.window.db.runTransaction = function () { return Promise.reject(new Error('permiso denegado (simulado)')); };
          page.window.standaloneTasks = page.window.standaloneTasks.map(function (t) { return Object.assign({}, t, { text: 'Tarea editada' }); });
          return page.window.saveTaskChange();
        }).then(function () {
          return settle(page.window, 30);
        }).then(function () {
          var el = page.document.getElementById('trazzoStoreError');
          assert.ok(el, 'debía existir un elemento visible de error en el DOM');
          assert.strictEqual(el.style.display, 'block');
          assert.ok(/no se pudo guardar/i.test(el.textContent));
        });
      });
    }); })

    .then(function () {
      console.log('\n' + PASS + ' pasaron, ' + FAIL + ' fallaron.');
      if (FAIL) { console.log('Fallaron: ' + FAILED_NAMES.join(', ')); process.exitCode = 1; }
    });
}

run();
