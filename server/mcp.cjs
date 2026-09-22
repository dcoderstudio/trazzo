'use strict';
const {McpServer}=require('@modelcontextprotocol/sdk/server/mcp.js');
const {StreamableHTTPServerTransport}=require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const {z}=require('zod');
function createMcpServer(oauth,tasks,token) {
  const server=new McpServer({name:'trazzo-tareas',version:'0.1.0'});
  const run=(scope,fn)=>async args=>{
    try {const actor=await oauth.authenticate(token,scope);const data=await fn(args,actor);return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
    catch(e){return {isError:true,content:[{type:'text',text:JSON.stringify({error:e.code||'internal_error',message:e.code?e.message:'No se pudo completar la operación. No confirmes que quedó guardada.'})}]};}
  };
  server.registerTool('consultar_pendientes',{
    title:'Consultar pendientes de Trazzo',
    description:'Consulta únicamente tareas libres pendientes, sin tareas de etapas de proyectos. Devuelve un resultado limitado; no representa todo el trabajo del estudio.',
    inputSchema:{limit:z.number().int().min(1).max(100).default(50),deadline:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()},
    annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },run('tasks:read',args=>tasks.list(args)));
  server.registerTool('crear_tarea',{
    title:'Crear tarea en Trazzo',
    description:'Crea una tarea libre con fecha exacta AAAA-MM-DD, sin publicar código. Usa un requestId aleatorio estable para esta solicitud y reutilízalo en reintentos. No inventes responsables. Confirma guardado solo si presentNow es true; replayed indica que ya se procesó. Resuelve fechas relativas en America/Mexico_City con el usuario. No uses para modificar o borrar tareas.',
    inputSchema:{requestId:z.string().regex(/^[a-zA-Z0-9_-]{16,100}$/),text:z.string().min(1).max(500),deadline:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),responsibleId:z.string().max(100).nullable().optional()},
    annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}
  },run('tasks:write',(args,actor)=>tasks.create(args,actor)));
  return server;
}
async function handleMcp(req,res,body,oauth,tasks,token) {
  const server=createMcpServer(oauth,tasks,token);
  const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on('close',()=>{transport.close();server.close();});
  await server.connect(transport);
  await transport.handleRequest(req,res,body);
}
module.exports={createMcpServer,handleMcp};
