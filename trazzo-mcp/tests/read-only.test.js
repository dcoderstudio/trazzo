import test from "node:test";
import assert from "node:assert/strict";
import { testHelpers } from "../lib/tools.js";

const data = {
  teamMembers: [{ id: "P", name: "Pablo" }],
  projects: [
    { id: 1, name: "Contenedores Ferrovalle", catId: "fabricacion", client: "Ferrovalle", stage: "produccion", deadline: "2026-11-30",
      stageTasks: { diseno: [{ id: "a", text: "Preparar archivos", deadline: null, done: false, resp: "P" }],
        produccion: [{ id: "b", text: "Ensamblar", deadline: "2026-11-25", done: false }] } },
    { id: 2, name: "Cotización ejemplo", catId: "cotizaciones", stageTasks: { inicial: [{ id: "c", text: "No incluir", done: false }] } },
    { id: 3, name: "Concluido", catId: "fabricacion", concluded: true,
      stageTasks: { final: [{ id: "d", text: "Oculta", done: false }] } }
  ],
  standaloneTasks: [{ id: "e", text: "Enviar factura", deadline: "", done: false, resp: "P" }]
};
test("excluye cotizaciones y proyectos concluidos de tareas operativas", () => {
  const t = testHelpers.taskRecords(data);
  assert.equal(t.length, 3);
  assert.deepEqual(t.map(x => x.id), ["e", "a", "b"]);
});
test("filtra pendientes sin fecha, conserva responsable y etapa", () => {
  const r = testHelpers.read("trazzo_tareas", { sin_fecha: true, responsable: "pab" }, data);
  assert.equal(r.cantidad, 2);
  assert.deepEqual(r.tareas.map(x => x.id), ["e", "a"]);
  assert.equal(r.tareas[1].etapa, "diseno");
});
test("busca cliente y proyecto sin distinguir acentos ni mayúsculas", () => {
  const r = testHelpers.read("trazzo_proyectos", { buscar: "FERROVALLE" }, data);
  assert.equal(r.cantidad, 1);
  assert.equal(r.proyectos[0].pendientes, 2);
});
test("las consultas no mutan datos de Trazo", () => {
  const original = JSON.stringify(data);
  testHelpers.read("trazzo_resumen", {}, data);
  testHelpers.read("trazzo_tareas", { sin_fecha: true }, data);
  assert.equal(JSON.stringify(data), original);
});
