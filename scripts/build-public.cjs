'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
// Explicit allowlist: never publish server code, tests, credentials or git files.
const files = ['daily-hub.html','tareas.html','bienvenida.html','focus.html','manifest.json','calendario.html','index.html','cotizacion.html','datastore.js','proyectos.html','theme.js','login.html','theme.css','equipo.html'];
for (const file of files) fs.copyFileSync(path.join(root,file),path.join(out,file));
for (const dir of ['icons','sounds']) fs.cpSync(path.join(root,dir),path.join(out,dir),{recursive:true});
