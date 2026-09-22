# Agregar tareas desde chat

Botón disponible en Equipo → Organizar y en la barra de Tareas. No requiere nuevas reglas de Firebase, credenciales de servidor ni suscripción a una API de IA. Usa la sesión y permisos normales de Trazzo.

## Flujo

1. Dictar o escribir las tareas en ChatGPT con fechas y responsables.
2. Pedir un bloque de texto con este formato, una tarea por línea:

```text
Tarea | Fecha | Responsable | Área
Preparar propuesta | 2026-09-25 | Gon | Diseño
Confirmar entrega | 2026-09-28 | - | Logística
```

Usar fechas exactas `AAAA-MM-DD`; `-` deja fecha, responsable o área sin asignar. Los nombres deben coincidir con los mostrados en “Formato y nombres disponibles”. Se toleran diferencias de mayúsculas, acentos y espacios. No usar `|` dentro del título ni tablas Markdown. Máximo 100 tareas, título de 500 caracteres y bloque de 60.000 caracteres. Si el dictado es ambiguo, aclararlo en el chat antes de generar el bloque. Trazzo no interpreta lenguaje natural ni inventa fechas.

3. Pegar el bloque en “Agregar tareas desde chat”.
4. Pulsar “Revisar tareas” y comprobar toda la tabla. Para corregir, editar el bloque y revisarlo de nuevo.
5. Pulsar “Crear N tareas”. Esperar “Guardado confirmado”. Las tareas se crean como tareas libres, no dentro de etapas de proyectos; no se envían notificaciones a los responsables.

## Guardado y límites

El importador lee el documento vigente y agrega el lote completo en una transacción. Revalida los nombres contra los datos actuales. No reemplaza proyectos ni otros campos. Las tareas con igual título normalizado, fecha, responsable y área se omiten, incluidas las repetidas dentro del bloque. Esto también permite reintentar una respuesta perdida sin duplicar tareas. Una tarea con otra fecha se considera diferente. Las coincidencias incluyen tareas completadas que aún están en la lista.

La vista previa requiere conexión. Si una fila es inválida no se guarda ninguna. El botón se bloquea durante el guardado. El contenido de las tareas se renderiza como texto, nunca como HTML.

Esta función no cambia los guardados antiguos de otras pantallas. Esos guardados todavía pueden sobrescribir arreglos desde copias desactualizadas; la estabilización general continúa siendo un trabajo separado. La transacción protege la importación, no convierte esos escritores anteriores en transaccionales.

## Verificación

- `node --test test/chat-tasks.test.cjs`: 8 pruebas de validación, transacción, reintentos y conservación de datos.
- `npm install --prefix test --ignore-scripts` y `npm test --prefix test`: añade 2 pruebas del modal real en jsdom, incluyendo error y reintento, doble clic, texto con HTML y edición posterior a revisión.
- Pruebas sin red ni escrituras a Firebase real. No se ha verificado visualmente en un navegador real ni publicado en producción.
