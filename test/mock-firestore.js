// ── Mock de Firestore para pruebas locales ──────────────────────────
// Entorno aislado: NO se conecta a ningún proyecto de Firebase real.
// Implementa solo el subsuelo de la API que usa la app (doc/get/set/
// update/onSnapshot/runTransaction) con la misma semántica relevante:
//  - set(data)              reemplaza el documento completo
//  - set(data,{merge:true}) fusiona campos de primer nivel
//  - update(data)           igual que merge, pero falla si no existe
//  - runTransaction(fn)     lee datos vigentes; si el documento cambió
//                           entre la lectura y el commit de OTRA
//                           transacción, reintenta automáticamente
//                           con datos frescos (igual que Firestore real)
//  - onSnapshot(cb)         se notifica de forma asíncrona (microtask)
//                           en cada escritura, como en producción
'use strict';

function createMockFirestoreServer() {
  var docs = {}; // path -> data
  var listeners = {}; // path -> [cb]
  var version = {}; // path -> integer, para detectar escrituras concurrentes

  function notify(path) {
    (listeners[path] || []).forEach(function (cb) {
      Promise.resolve().then(function () {
        cb({ exists: docs[path] !== undefined, data: function () { return docs[path]; } });
      });
    });
  }

  function docRef(path) {
    return {
      path: path,
      get: function () {
        return Promise.resolve({ exists: docs[path] !== undefined, data: function () { return docs[path]; } });
      },
      set: function (data, opts) {
        if (opts && opts.merge) docs[path] = Object.assign({}, docs[path] || {}, data);
        else docs[path] = Object.assign({}, data);
        version[path] = (version[path] || 0) + 1;
        notify(path);
        return Promise.resolve();
      },
      update: function (data) {
        if (docs[path] === undefined) return Promise.reject(new Error('No such document: ' + path));
        docs[path] = Object.assign({}, docs[path], data);
        version[path] = (version[path] || 0) + 1;
        notify(path);
        return Promise.resolve();
      },
      onSnapshot: function (cb) {
        listeners[path] = listeners[path] || [];
        listeners[path].push(cb);
        Promise.resolve().then(function () {
          cb({ exists: docs[path] !== undefined, data: function () { return docs[path]; } });
        });
        return function unsubscribe() {
          listeners[path] = (listeners[path] || []).filter(function (x) { return x !== cb; });
        };
      }
    };
  }

  var db = {
    doc: docRef,
    // simula runTransaction con reintento óptimista real: si la versión
    // del documento cambió entre la lectura y el commit, reintenta.
    runTransaction: function (fn, _attempt) {
      _attempt = _attempt || 0;
      var path = null;
      var readVersionAtStart = null;
      var tx = {
        get: function (ref) {
          path = ref.path;
          readVersionAtStart = version[path] || 0;
          return Promise.resolve({ exists: docs[path] !== undefined, data: function () { return docs[path]; } });
        },
        set: function (ref, data, opts) {
          tx._pendingWrite = { ref: ref, data: data, opts: opts };
        }
      };
      return Promise.resolve()
        .then(function () { return fn(tx); })
        .then(function (returnValue) {
          if (!tx._pendingWrite) return returnValue;
          // Detecta si alguien más escribió el documento mientras esta
          // "transacción" corría (entre el get() y este punto).
          var currentVersion = version[path] || 0;
          if (currentVersion !== readVersionAtStart) {
            if (_attempt >= 10) throw new Error('runTransaction: demasiados reintentos en ' + path);
            return db.runTransaction(fn, _attempt + 1); // reintento con datos frescos
          }
          var w = tx._pendingWrite;
          return w.ref.set(w.data, w.opts).then(function () { return returnValue; });
        });
    },
    // utilidades de inspección para las pruebas
    _dump: function (path) { return docs[path]; },
    _setRaw: function (path, data) { docs[path] = data; version[path] = (version[path] || 0) + 1; }
  };

  return db;
}

// Retraso artificial para forzar interleaving determinista entre dos
// "clientes" en las pruebas de concurrencia (no depende de timing real).
function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

module.exports = { createMockFirestoreServer: createMockFirestoreServer, delay: delay };
