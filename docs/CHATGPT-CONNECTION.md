# Conexión de tareas de Trazzo con ChatGPT

Estado: implementación para revisión; NO activada contra Firebase real. No se creó la tarea real “Prueba chat”.

## Alcance

- `consultar_pendientes`: tareas libres abiertas (no checklists de proyectos), con límite y fecha opcional.
- `crear_tarea`: texto, fecha exacta, responsable opcional y requestId estable para reintentos.
- Integración MCP por HTTP, OAuth authorization code + PKCE S256 y cliente público preconfigurado `trazzo-chatgpt`.
- El usuario autoriza con Firebase Auth/Google; se comprueba correo verificado, lista del equipo y cuenta no deshabilitada.
- No se solicita ninguna clave de OpenAI ni se hacen llamadas a modelos desde la aplicación.
- No modifica el calendario, no envía mensajes, no borra tareas, no modifica Firestore Security Rules.

## Lo probado

`npm ci --ignore-scripts` y `npm run test:bridge`: 16 pruebas aisladas con almacén transaccional en memoria. Incluyen el SDK real MCP, permisos, OAuth, PKCE, vencimiento, revocación, idempotencia, rechazo de HTML, fechas inválidas y conservación de datos ajenos.

`npm run build`: genera `public/` mediante lista explícita de archivos. El servidor, tests, configuración privada y documentos no se publican como archivos estáticos. Vercel publica `api/trazzo.js` como función.

No probado aún: emulador oficial de Firestore, Firebase real, consentimiento Google en navegador, flujo OAuth desde ChatGPT y despliegue con credenciales. Las pruebas en memoria NO reemplazan esas comprobaciones.

## Configuración privada en Vercel

Usar un proyecto Firebase de pruebas primero. Nunca pegar claves en un chat ni subirlas a GitHub. Configurar variables solo en el entorno Preview de esta rama/proyecto de pruebas:

| Variable | Contenido |
| --- | --- |
| `TRAZZO_BRIDGE_ENABLED` | `true` únicamente después de completar la configuración; ausente devuelve 503 |
| `TRAZZO_TASK_WRITES_ENABLED` | `false` inicialmente; `true` solo después de probar permisos y confirmar destino de escritura |
| `TRAZZO_BRIDGE_ORIGIN` | Origen HTTPS estable del servidor, sin ruta ni barra final |
| `TRAZZO_OAUTH_REDIRECT_URIS` | Arreglo JSON de las URLs EXACTAS de callback que muestre la configuración MCP de ChatGPT; sin comodines |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Cuenta de servicio del proyecto Firebase de destino; secreto de servidor, nunca configuración pública ni variable con prefijo público |
| `FIREBASE_WEB_CONFIG_JSON` | Objeto público con apiKey, authDomain, projectId y appId del MISMO Firebase de destino |

La cuenta de servicio necesita acceso de lectura/escritura a Firestore y consulta de usuarios de Firebase Auth. No usar roles Owner/Editor como atajo. Admin SDK no está sujeto a las reglas de clientes: el servidor restringe identidades y operaciones explícitamente.

Las colecciones `trazzoBridgeOAuth` y `trazzoBridgeOperations` deben permanecer inaccesibles desde los SDK cliente. Las reglas actuales que solo permiten `/workspace/proyectos` ya deniegan esas rutas por defecto. No añadir un allow global. Guardar tokens opacos solo como hash de documento; no loguear tokens, códigos ni cuerpos OAuth. Se recomienda limpieza programada/TTL para registros OAuth vencidos (el vencimiento se valida al leer, sin depender de TTL). No eliminar recibos de idempotencia mientras puedan reintentarse pedidos.

Agregar únicamente el dominio estable del entorno de pruebas a Firebase Authentication > Authorized domains. Si Preview tiene Vercel Deployment Protection, ChatGPT no podrá consultar metadatos ni `/mcp`: configurar un servicio accesible por HTTPS cuya protección sea OAuth, sin exponer datos o usar bypass tokens en enlaces públicos.

## Alta en ChatGPT

Usar el mecanismo de servidor MCP personalizado disponible en la cuenta/workspace. Requiere que su administrador permita conexiones personalizadas; no se puede registrar una herramienta nueva solo escribiendo su URL en el chat.

- URL MCP: `https://ORIGEN-CONFIGURADO/mcp`.
- Autenticación OAuth, cliente preconfigurado `trazzo-chatgpt`, sin secreto (`none`, PKCE obligatorio).
- Este servidor NO implementa DCR ni CIMD. Si el formulario no admite cliente OAuth preconfigurado público, detener la activación y adaptar el registro al mecanismo disponible. No quitar autenticación.
- Copiar callback exacto del formulario a `TRAZZO_OAUTH_REDIRECT_URIS`.
- Autorizar con una cuenta del equipo, aceptar permisos y confirmar que aparecen ambas herramientas.
- Metadatos: `/.well-known/oauth-protected-resource` y `/.well-known/oauth-authorization-server`.
- Reconectar tras 30 días de duración máxima del grant o tras revocación. Los access tokens duran hasta una hora y los refresh tokens rotan.
- Revocación RFC 7009: POST `/oauth/revoke`, token y client_id; invalida todo el grant. Deshabilitar un usuario en Firebase Auth también impide futuras llamadas.

## Antes de escribir en producción

1. Verificar reglas reales, proyecto de destino y mínimo acceso de la cuenta de servicio.
2. Completar las correcciones pendientes de los escritores web existentes. Esta rama hereda la estabilización, pero los avisos de conflicto sin callback y el descarte de campos de proyecto continúan pendientes. Mientras haya clientes que sobrescriban arreglos desde datos obsoletos, podrían borrar posteriormente una tarea creada correctamente por el puente.
3. Probar con Firebase de pruebas dos clientes reales y reintentos de transacción. No usar la vista previa conectada al Firebase real para pruebas ficticias.
4. Confirmar OAuth desde ChatGPT: acceso externo denegado, cuenta del equipo aceptada, permisos y revocación.
5. Activar escrituras solo con destino confirmado. Crear el pedido real autorizado: texto “Prueba chat”, fecha `2026-09-25`, sin responsable inventado. Generar requestId aleatorio una sola vez y reutilizarlo si falla la respuesta.
6. Exigir `presentNow:true` y leer nuevamente por fecha; verificar también en Trazzo. Si `presentNow:false`, informar que el recibo existe pero la tarea ya no está; no recrearla silenciosamente.

## Continuidad Claude / ChatGPT

Rama: `chat-task-bridge`, basada en `data-layer-stabilization` en a233c9b. Solo se añaden servicio y pruebas; no se reescriben los cambios previos ni se fusiona main. Descargar la rama y leer este archivo antes de continuar. Las claves no forman parte del repositorio.

Referencias: https://developers.openai.com/plugins/build/auth y https://firebase.google.com/docs/admin/setup
