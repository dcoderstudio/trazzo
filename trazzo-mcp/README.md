# Trazo MCP — solo lectura

Integración independiente de Trazo con ChatGPT. No modifica la aplicación existente.

## Estado

Primer prototipo de **solo lectura**; existe un despliegue aislado y protegido en Vercel, pero **no está autorizado ni conectado a ChatGPT**, ni puede acceder a Firestore sin configuración adicional. Requiere completar configuración de seguridad, autenticación OAuth y pruebas. El código se mantiene en la rama `feature/chatgpt-mcp-readonly`.

## Datos

La versión actual de `trazzo-one.vercel.app` utiliza **Firebase Firestore** (proyecto `trazzo-c9eaf`), no Supabase. Las tareas y proyectos residen principalmente en `workspace/proyectos`, como campos `projects`, `standaloneTasks`, `teamMembers`. Las tareas de proyecto están agrupadas en `project.stageTasks[stage]`.

## Endpoints

- `POST /mcp` (JSON-RPC MCP con Streamable HTTP)
- `GET /.well-known/oauth-protected-resource`

Herramientas: `trazzo_resumen`, `trazzo_proyectos`, `trazzo_tareas`.

## Seguridad

- No hay rutas de escritura ni endpoints públicos de datos sin autenticación.
- Verifica tokens JWT firmados mediante JWKS de un emisor OAuth propio, con issuer, audiencia, scope `trazzo:read` y allowlist de `sub`.
- Configuración incompleta => respuesta 503, sin accesos a datos.
- El backend utiliza Firebase Admin únicamente del lado del servidor.
- **Nunca** copiar la cuenta de servicio en el repositorio, ni entregar su JSON por chat.
- Usar un emisor OAuth compatible con ChatGPT, como WorkOS AuthKit con CIMD, flujo authorization code + PKCE, discovery, tokens de duración corta y revocación. Configurar un solo usuario autorizado para comenzar.
- Validar autorización al nivel de usuario y Firestore antes de abrir a otros colaboradores; este prototipo es de un solo propietario.
- Evitar un dominio MCP bajo la misma app de producción hasta validar permisos, límites y logs.

## Variables del proyecto MCP en Vercel

- `TRAZZO_MCP_PUBLIC_URL`: origen HTTPS propio, sin ruta final.
- `TRAZZO_OAUTH_ISSUER`: emisor HTTPS de tokens y metadata OAuth.
- Audiencia OAuth JWT: la URL exacta de `TRAZZO_MCP_PUBLIC_URL` + `/mcp`; no hay variable independiente.
- `TRAZZO_OAUTH_JWKS_URL`: URL HTTPS del conjunto de claves de firma.
- `TRAZZO_ALLOWED_SUBJECTS`: lista separada por comas de sujetos OAuth autorizados, obtenidos del proveedor OAuth (no asumir el correo).
- `TRAZZO_ALLOWED_CLIENT_IDS` (opcional): identificadores de clientes OAuth autorizados; por defecto `https://chatgpt.com/oauth/client.json` (confirmar el cliente real en la primera autorización).
- `TRAZZO_REQUIRED_SCOPE` (opcional): scope exigido, por defecto `openid`. Ajustar si el proveedor admite un scope propio `trazzo:read`.
- `TRAZZO_ALLOWED_ORIGINS` (opcional): orígenes explícitos permitidos.
- `TRAZZO_FIREBASE_SERVICE_ACCOUNT_JSON`: credencial de cuenta de servicio del proyecto Firebase correcto, configurada **solo** en Vercel.

## Despliegue de pruebas y puesta en marcha

Ya se creó el proyecto separado **`trazzo-chatgpt-mcp`**, vinculado a la rama de pruebas, con raíz `trazzo-mcp`, Node 22 y **protección SSO en todos los entornos**. No se modificó el proyecto `trazzo` existente. El primer despliegue compiló correctamente. Se agregó un workflow de GitHub Actions para los tests de solo lectura; su ejecución sobre el commit de creación resultó exitosa. Conectar mediante un emisor OAuth que permita a ChatGPT obtener un token firmado verificable. Configurar la app personalizada en ChatGPT solo después de probar `initialize`, `tools/list`, `tools/call`, autorización válida y rechazos 401/403.

## Pasos de autorización que requieren configuración en las cuentas del propietario

1. En Firebase/Google Cloud, crear una **cuenta de servicio exclusiva para este conector**, con permisos de **solo lectura en Firestore** (principio de mínimo privilegio). Crear o usar credenciales por la interfaz privada del proveedor; **no pegarlas en ChatGPT ni subirlas a GitHub**.
2. En **Vercel > proyecto `trazzo-chatgpt-mcp` > Settings > Environment Variables**, establecer `TRAZZO_FIREBASE_SERVICE_ACCOUNT_JSON` como variable sensible y las variables OAuth listadas arriba. Si el proveedor de Firebase permite federación de identidades en lugar de claves persistentes, preferirla en una iteración de seguridad.
3. Configurar un **proveedor OAuth/OIDC** que permita autorización interactiva de ChatGPT y entregue JWT verificables por JWKS, audiencia y scope `trazzo:read`. El código que valida tokens **no implementa por sí solo** el servidor de autorización OAuth.
4. Después, validar 401/403 de forma segura y comprobar lectura con una cuenta autorizada. Ajustar protección Vercel (actualmente SSO `all`) solo cuando OAuth esté operativo; con SSO `all` ChatGPT no puede llamar al MCP.
5. En ChatGPT, registrar el conector MCP personalizado solo después de las pruebas anteriores.

## Plan OAuth con WorkOS AuthKit

1. Crear un proyecto/entorno en [WorkOS](https://dashboard.workos.com/) y activar AuthKit y su opción de soporte para clientes MCP externos/CIMD.
2. Configurar dominio de AuthKit y cliente permitido. La URL pública estable del MCP debe ser **la URL de Preview de la rama**; no utilizar un URL efímero de cada despliegue ni el dominio de producción de Trazo.
3. Configurar `TRAZZO_OAUTH_ISSUER` y `TRAZZO_OAUTH_JWKS_URL` según metadata real de WorkOS; registrar `TRAZZO_ALLOWED_SUBJECTS` tras confirmar el sujeto real del usuario.
4. Configurar `TRAZZO_MCP_PUBLIC_URL` con el origen HTTPS estable de MCP, y `TRAZZO_ALLOWED_CLIENT_IDS` según el client ID validado. Los tokens deben llevar audiencia **exactamente** `https://<dominio-mcp>/mcp`. La conexión permanecerá cerrada si faltan variables o claims.
5. Verificar el `/.well-known/oauth-protected-resource`, los rechazos 401/403, el alta OAuth y la lectura real; solo después evaluar reducir protección Vercel `all` a `preview` o excepción limitada según riesgos. **No hacer pública la base de datos.**

## Pruebas pendientes

1. Validar el funcionamiento en Vercel con Node runtime y formato de handler compatible; ajustar implementación con documentación del runtime.
2. Prueba de descubrimiento OAuth, autorización y conexión desde ChatGPT.
3. Confirmar exactamente cómo se filtran las tareas activas y su estado con datos reales.
4. Aplicar controles de cuotas, registro de auditoría y tests de regresión antes de permitir cambios.
5. Revisar funcionalidad de MCP con voz en el plan y cliente de ChatGPT del usuario.

Este servidor es un **punto de partida**, no una conexión lista para utilizar.
