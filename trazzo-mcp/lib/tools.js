import { workspace } from "./firestore.js";

const schema = { type: "object", properties: {}, additionalProperties: false };
// Metadata for ChatGPT OAuth linking; access is separately checked on every request.
const security = { annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }, securitySchemes: [{ type: "oauth2", scopes: ["openid"] }], _meta: { securitySchemes: [{ type: "oauth2", scopes: ["openid"] }] } };
export const tools = [
  { name: "trazzo_resumen", description: "Consultar cantidades de proyectos activos, pendientes y tareas sin fecha en Trazo. Solo lectura.", inputSchema: schema, ...security },
  { name: "trazzo_proyectos", description: "Consultar proyectos de Trazo con cliente, fase, fecha, estado y cantidad de tareas pendientes. Solo lectura.", inputSchema: { type: "object", properties: { incluir_concluidos: { type: "boolean", description: "Incluir proyectos concluidos o archivados" }, buscar: { type: "string", description: "Buscar por nombre parcial o cliente, sin exigir coincidencia exacta" } }, additionalProperties: false }, ...security },
  { name: "trazzo_tareas", description: "Consultar tareas de Trazo, incluyendo tareas sin fecha o vencidas. Solo lectura.", inputSchema: { type: "object", properties: { sin_fecha: { type: "boolean", description: "Filtrar tareas que no tienen fecha" }, pendientes: { type: "boolean", description: "Solo tareas no terminadas (predeterminado verdadero)" }, buscar: { type: "string", description: "Buscar texto de tarea, proyecto o cliente" }, responsable: { type: "string", description: "Filtrar por nombre parcial del responsable" }, limite: { type: "integer", minimum: 1, maximum: 200, description: "Máximo de resultados (predeterminado 100)" } }, additionalProperties: false }, ...security }
];

function normalized(x) {
  return String(x ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}
function active(p) { return p.catId !== "cotizaciones" && !p.concluded && !p.quoteArchived; }
function projectInfo(p) {
  return { id: p.id, nombre: p.name ?? "", cliente: p.client ?? "", categoria: p.catId ?? "", etapa: p.stage ?? "", fecha_entrega: p.deadline || null, concluido: !!p.concluded, pendiente_aprobacion: !!p.pendingApproval };
}
function taskRecords(d) {
  const members = new Map((d.teamMembers || []).map(m => [String(m.id), m.name]));
  const records = [];
  const add = (t, project, stage) => records.push({
    id: t.id, tarea: String(t.text ?? ""), realizada: !!t.done, fecha: t.deadline || null,
    responsable: members.get(String(t.resp)) || null, responsable_id: t.resp || null,
    area: t.area || null, prioritaria: !!t.priority,
    proyecto_id: project?.id ?? null, proyecto: project?.name ?? null,
    cliente: project?.client ?? null, etapa: stage || null
  });
  for (const t of d.standaloneTasks || []) add(t, null, null);
  for (const p of d.projects || []) {
    if (!active(p)) continue;
    for (const [stage, tasks] of Object.entries(p.stageTasks || {})) {
      for (const t of Array.isArray(tasks) ? tasks : []) add(t, p, stage);
    }
  }
  return records;
}
function read(name, args, d) {
  const tasks = taskRecords(d);
  if (name === "trazzo_resumen") {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
    const pending = tasks.filter(t => !t.realizada);
    return {
      proyectos_activos: (d.projects || []).filter(active).length,
      tareas_pendientes: pending.length,
      tareas_sin_fecha: pending.filter(t => !t.fecha).length,
      tareas_vencidas: pending.filter(t => t.fecha && t.fecha < today).length,
      total_miembros: (d.teamMembers || []).length,
      fecha_referencia: today
    };
  }
  if (name === "trazzo_proyectos") {
    let projects = (d.projects || []).filter(p => args.incluir_concluidos || active(p));
    if (args.buscar) projects = projects.filter(p => normalized([p.name, p.client].join(" ")).includes(normalized(args.buscar)));
    return { cantidad: projects.length, proyectos: projects.slice(0, 200).map(p => ({
      ...projectInfo(p),
      pendientes: tasks.filter(t => String(t.proyecto_id) === String(p.id) && !t.realizada).length
    })), truncado: projects.length > 200 };
  }
  if (name === "trazzo_tareas") {
    let filtered = tasks;
    if (args.pendientes !== false) filtered = filtered.filter(t => !t.realizada);
    if (args.sin_fecha) filtered = filtered.filter(t => !t.fecha);
    if (args.buscar) filtered = filtered.filter(t => normalized([t.tarea,t.proyecto,t.cliente].join(" ")).includes(normalized(args.buscar)));
    if (args.responsable) filtered = filtered.filter(t => normalized(t.responsable).includes(normalized(args.responsable)));
    const limit = Math.min(Math.max(Number(args.limite) || 100, 1), 200);
    return { cantidad: filtered.length, tareas: filtered.slice(0, limit), truncado: filtered.length > limit };
  }
  throw new Error("Unknown tool.");
}
export async function callTool(name, args) {
  if (!tools.some(t => t.name === name)) throw new Error("Unknown tool.");
  const d = await workspace();
  const result = read(name, args || {}, d);
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

export const testHelpers = { active, taskRecords, read };
