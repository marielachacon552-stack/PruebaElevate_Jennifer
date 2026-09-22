# Plan de implementación

## Requisitos y decisiones

- Stack: Node.js + Fastify, PostgreSQL con `pg`, React + Vite y CSS propio.
- Enfoque code first: esquema definido en migraciones SQL versionadas y ejecutadas desde Node.js, sin ORM adicional.
- Sesiones mediante cookies HttpOnly y tokens persistidos como hash en PostgreSQL; contraseñas con scrypt de Node.js.
- El propietario administra el proyecto y sus miembros; todos los miembros gestionan tareas y comentarios dentro de sus proyectos.
- Los datos de usuarios, sesiones, proyectos, membresías, tareas y comentarios se guardan en PostgreSQL.

## Seguimiento

- [x] Leer el README actualizado y revisar la base existente.
- [x] Identificar las tecnologías exigidas y definir las reglas de acceso.
- [x] Crear migraciones versionadas, relaciones, restricciones e índices.
- [x] Implementar registro, inicio/cierre de sesión y consulta de sesión.
- [x] Implementar API REST de proyectos y miembros con autorización.
- [x] Implementar CRUD de tareas, filtros y comentarios.
- [x] Incorporar validación de esquemas y manejo centralizado de errores.
- [x] Construir frontend React con Vite, autenticación y gestión de proyectos.
- [x] Construir interfaz de tareas, filtros, asignaciones y comentarios.
- [x] Ejecutar migraciones en la base configurada.
- [x] Verificar autenticación, persistencia y aislamiento entre usuarios mediante pruebas.
- [x] Compilar el frontend y documentar instalación, comandos y API.
- [x] Verificar el flujo completo en navegador y revisar capturas de escritorio/móvil.

## Verificación y pendientes

- Conexión real a PostgreSQL confirmada; aplicada `001_initial.sql`.
- Dependencias de React y Vite instaladas.
- Pruebas de integración escritas con `node:test`; usan un esquema temporal independiente y PostgreSQL real.
- La primera ejecución de pruebas y compilación fue bloqueada por el aislamiento de procesos de Windows (`spawn EPERM`); se repitieron con los permisos correspondientes.
- `npm test`: 16 pruebas aprobadas con PostgreSQL real. Comprobadas migraciones idempotentes, hashes de contraseñas/sesiones, registro/login/logout, CRUD, filtros combinados, comentarios, acceso por membresía, eliminación en cascada y persistencia al recrear la aplicación.
- `npm run build`: compilación de producción correcta (React + Vite).
- `npm run test:browser`: aprobado en Chrome, sin añadir dependencias. Comprobados registro, proyecto, tarea, asignación, cambio de estado, comentario, filtros y persistencia tras recargar y cerrar/reabrir sesión.
- Capturas de escritorio (1440 px) y móvil (390 px) revisadas en `artifacts/`. Sin desbordamiento horizontal ni excepciones JavaScript.
- Las pruebas usan esquemas temporales y los eliminan al terminar; los datos reales de la aplicación permanecen intactos.

## Estado final

### Mejora solicitada: organización y claridad de la interfaz

- [ ] Reorganizar el inicio con proyectos comparables, búsqueda y acceso claro.
- [ ] Separar Tareas, Equipo y Ajustes dentro de cada proyecto.
- [ ] Incorporar una lista de tareas con columnas claras y mantener el tablero como alternativa.
- [ ] Etiquetar filtros, mejorar tamaños de texto y colocar acciones destructivas en su contexto.
- [ ] Verificar los flujos y la distribución en escritorio y móvil; compilar y documentar.

### Cambio solicitado: asignar tareas a otros usuarios registrados

- [x] Identificar la causa: el selector solo consultaba miembros actuales; los proyectos nuevos solo incluyen al propietario.
- [x] Mostrar miembros y otros usuarios registrados al propietario en el formulario de tareas.
- [x] Incorporar al proyecto a la persona seleccionada al guardar la tarea, en la misma transacción.
- [x] Facilitar la selección de usuarios existentes en la gestión de miembros.
- [x] Verificar pertenencia a varios proyectos, permisos, API y navegador; recompilar.
- [x] Reiniciar la aplicación en el puerto 3001.

Verificación: 18 pruebas aprobadas. Navegador: selección de otra persona al crear una tarea, alta desde el selector de miembros y asignación de la misma persona en dos proyectos. Los miembros sin rol de propietario pueden asignar tareas a integrantes actuales; incorporar nuevas personas sigue reservado al propietario. No se añadieron dependencias ni se modificaron los datos reales.

### Cambio solicitado: identificadores numéricos

- [x] Crear migración `002_numeric_ids.sql` para convertir usuarios, proyectos y tareas a enteros autoincrementales, conservando registros y relaciones.
- [x] Actualizar API, validación y asignación de personas desde React.
- [x] Comprobar la migración con datos existentes y ejecutar pruebas de integración (17 pruebas aprobadas).
- [x] Aplicar la migración a la base configurada y reconstruir la interfaz.
- [x] Comprobar el navegador y actualizar la documentación.

Verificación del cambio: 17 pruebas aprobadas, compilación correcta y prueba de navegador aprobada con asignación, filtros y persistencia. La base real ya tiene usuarios `1, 2`, proyecto `1` y tarea `1`; se conservaron sus datos y relaciones. Se reinició la instancia del puerto 3001. Cualquier otra instancia del backend que siga abierta con el código anterior debe reiniciarse antes de usarla con esta migración. Recargar la interfaz para que reciba los nuevos identificadores.

Requisitos del README implementados y verificados. Sin pendientes de implementación. Para incorporar miembros, cada persona debe registrarse primero.

La aplicación compilada quedó en ejecución en `http://127.0.0.1:3001`. El puerto 3000 estaba ocupado; se utilizó 3001 únicamente para este proceso, sin modificar `.env` ni detener el proceso existente. Si se cierra este servidor, puede iniciarse siguiendo el README o, desde `Backend` en PowerShell, con `$env:PORT = '3001'; npm start`.
