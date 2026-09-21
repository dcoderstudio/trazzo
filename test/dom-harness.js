// ── Harness de páginas reales en jsdom (entorno aislado) ─────────────
// Carga el HTML REAL de la página (equipo.html / proyectos.html), le
// quita los <script src="https://www.gstatic.com/..."> del SDK de
// Firebase y los sustituye por un mock en memoria (mock-firestore.js)
// ANTES de que corra el resto del script de la página — así el código
// real de la página se ejecuta sin tocar ningún proyecto de Firebase,
// ni de producción ni de prueba en la nube.
'use strict';
var fs = require('fs');
var path = require('path');
var { JSDOM } = require('./node_modules/jsdom');
var { createMockFirestoreServer } = require('./mock-firestore.js');

var EXTERNAL_SCRIPT_RE = /<script\s+src="https:\/\/www\.gstatic\.com\/firebasejs\/[^"]*"><\/script>\s*/g;

function buildMockFirebaseScript(userEmail) {
  return '<script>\n' +
    'window.__mockFirestoreOps = [];\n' +
    'window.firebase = {\n' +
    '  _apps: {},\n' +
    '  initializeApp: function(cfg){ window.__fbInited = true; return {}; },\n' +
    '  app: function(){ if(!window.__fbInited) throw new Error("no app"); return {}; },\n' +
    '  firestore: function(){ return window.__mockDb; },\n' +
    '  auth: function(){\n' +
    '    return {\n' +
    '      onAuthStateChanged: function(cb){ Promise.resolve().then(function(){ cb({email:"' + userEmail + '"}); }); },\n' +
    '      signOut: function(){ return Promise.resolve(); },\n' +
    '      GoogleAuthProvider: function(){},\n' +
    '      getRedirectResult: function(){ return Promise.resolve({}); }\n' +
    '    };\n' +
    '  },\n' +
    '  storage: function(){ throw new Error("storage no disponible en el harness de prueba"); }\n' +
    '};\n' +
    '</script>\n';
}

// db: una instancia devuelta por createMockFirestoreServer() (o
// compartida entre varias páginas para simular dos sesiones sobre el
// MISMO documento). userEmail: correo con el que "inicia sesión" la
// página (debe estar en su propia lista ALLOWED para pasar el guard).
function loadPage(htmlPath, opts) {
  opts = opts || {};
  var db = opts.db || createMockFirestoreServer();
  var userEmail = opts.userEmail || 'dcoderstudio@gmail.com';
  var html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace(EXTERNAL_SCRIPT_RE, '');
  // jsdom no puede resolver <script src="datastore.js"> (ruta relativa
  // de archivo local) sin configurar un resource loader — más simple
  // reemplazarlo por su contenido real inline ANTES de construir el
  // DOM (construirlo una vez con esto ya resuelto; nunca crear un DOM
  // "de prueba" descartable, porque sus listeners de onSnapshot
  // registrados en el mock sobreviven al descartar la ventana y
  // truenan después al no tener nada definido).
  var dsContent = fs.readFileSync(path.join(__dirname, '..', 'datastore.js'), 'utf8');
  html = html.replace('<script src="datastore.js"></script>', '<script>' + dsContent + '</script>');
  // Inserta el mock de firebase como el primer <script> del <head>,
  // antes de cualquier otro script de la página.
  html = html.replace('<head>', '<head>' + buildMockFirebaseScript(userEmail));

  var virtualConsole = new (require('./node_modules/jsdom').VirtualConsole)();
  var errors = [];
  virtualConsole.on('jsdomError', function (e) { errors.push(e); });
  virtualConsole.on('error', function () {}); // silencia console.error/warn de la app (se prueban aparte)

  var dom = new JSDOM(html, {
    url: 'https://trazzo.test/' + path.basename(htmlPath),
    runScripts: 'dangerously',
    virtualConsole: virtualConsole,
    beforeParse: function (window) { window.__mockDb = db; }
  });

  return { window: dom.window, document: dom.window.document, db: db, errors: errors };
}

// Espera a que la página termine su carga inicial: onAuthStateChanged
// resuelve por microtask, initApp()/onSnapshot corre otra vuelta más.
// No hay señal formal de "listo" en estas páginas, así que se espera
// unos ticks de microtask + un pequeño margen de macrotask.
function settle(win, ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms || 50);
  });
}

module.exports = { loadPage: loadPage, settle: settle };
