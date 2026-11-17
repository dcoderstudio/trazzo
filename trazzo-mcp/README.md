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
- Idealmente usar un emisor OAuth con discovery y Dynamic Client Registration (o registro manual para ChatGPT), flujo de consentimiento y credenciales de duración corta.
- Validar autorización al nivel de usuario y Firestore antes de abrir a otros colaboradores; este prototipo es de un solo propietario.
- Evitar un dominio MCP bajo la misma app de producción hasta validar permisos, límites y logs.

## Variables del proyecto MCP en Vercel

- `TRAZZO_MCP_PUBLIC_URL`: origen HTTPS propio, sin ruta final.
- `TRAZZO_OAUTH_ISSUER`: emisor HTTPS de tokens y metadata OAuth.
- `TRAZZO_OAUTH_AUDIENCE`: audiencia obligatoria en JWT.
- `TRAZZO_OAUTH_JWKS_URL`: URL HTTPS del conjunto de claves de firma.
- `TRAZZO_ALLOWED_SUBJECTS`: lista separada por comas de sujetos OAuth autorizados.
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

## Pruebas pendientes

1. Validar el funcionamiento en Vercel con Node runtime y formato de handler compatible; ajustar implementación con documentación del runtime.
2. Prueba de descubrimiento OAuth, autorización y conexión desde ChatGPT.
3. Confirmar exactamente cómo se filtran las tareas activas y su estado con datos reales.
4. Aplicar controles de cuotas, registro de auditoría y tests de regresión antes de permitir cambios.
5. Revisar funcionalidad de MCP con voz en el plan y cliente de ChatGPT del usuario.

Este servidor es un **punto de partida**, no una conexión lista para utilizar.
