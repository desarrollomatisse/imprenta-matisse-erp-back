# Imprenta Matisse ERP · Backend

API NestJS para el ERP de imprenta. Autentica con correo y contraseña, aplica permisos fijos por rol y guarda usuarios, responsables, órdenes, tareas, eventos y adjuntos en PostgreSQL. Los archivos se almacenan en Google Drive a través de la API.

Los roles, áreas, estados y permisos viven en código. No hay roles dinámicos: los ajustes por cuenta se guardan como diferencias con el rol.

## Requisitos

- Node.js 24.22.2 y pnpm 11.
- PostgreSQL.
- Un cliente OAuth web de Google Cloud y un refresh token de la cuenta dueña de la carpeta de Drive.

## Desarrollo local

```bash
pnpm install
cp .env.example .env
pnpm migration:run
pnpm seed
pnpm start:dev
```

Completa `.env` antes de migrar. La base indicada en `DATABASE_URL` debe existir. Si la contraseña tiene caracteres como `@`, `:`, `/` o `#`, codifícala para URL. La API escucha en `http://127.0.0.1:8000` y el proxy de Vite le reenvía `/api`.

## Migraciones

Las migraciones son TypeORM en SQL explícito, dentro de `src/database/migrations`, y corren sobre la versión compilada.

| Comando                 | Uso                                                                         |
| ----------------------- | --------------------------------------------------------------------------- |
| `pnpm migration:run`    | Aplica las pendientes.                                                      |
| `pnpm migration:revert` | Revierte la última.                                                         |
| `pnpm migration:show`   | Lista el estado de cada una.                                                |
| `pnpm migration:check`  | Compara las entidades con el esquema real; debe indicar que no hay cambios. |

El ORM es TypeORM con `@nestjs/typeorm`. La primera migración crea las seis tablas del negocio, la segunda agrega `password_hash`, la tercera crea `auth_sessions`, la cuarta agrega el cambio obligatorio de contraseña, `rate_limits` e idempotencia, la quinta agrega borrado lógico y el catálogo, la sexta los permisos por cuenta y la séptima la bitácora, la versión de cada orden y el punto de retorno de las canceladas. La cuarta marca para cambio obligatorio todas las cuentas salvo las `@matisse.test`.

Para agregar una migración, crea el archivo con `pnpm exec typeorm migration:create src/database/migrations/Nombre` y regístrala en `src/database/data-source.ts`.

## Cuentas

Se entra con correo y contraseña. Cada cuenta nueva recibe una contraseña temporal aleatoria que se muestra una sola vez a quien la crea, y debe cambiarla al entrar: hasta entonces la API responde 403 a todo lo demás. Administración puede restablecerla con `POST /admin/users/{email}/reset-password`, lo que también cierra sus sesiones. Sin correo configurado no hay recuperación automática.

Una contraseña debe tener al menos 10 caracteres y no puede ser solo números ni contener el correo o el nombre de la empresa. Cambiarla cierra la sesión en los demás dispositivos.

Para el primer acceso en producción, o para recuperar una cuenta Superadministrador, ejecuta `pnpm admin:create correo@empresa.com` en el servidor. Imprime una contraseña temporal una sola vez.

Los seeds siguientes crean cuentas con la clave conocida `12345678` y sin cambio obligatorio, solo para desarrollo: se niegan a correr sin `ALLOW_TEST_SEED=true` o con `NODE_ENV=production`.

`pnpm seed:demo` agrega datos ficticios para probar el sistema: nueve responsables y las órdenes `OT-DEMO0001` a `OT-DEMO0010`, una por cada situación del flujo y con los tres colores del semáforo. Es idempotente, no adjunta archivos de Drive y se niega a correr con `NODE_ENV=production`.

`pnpm seed` crea una cuenta por rol y no toca las que ya existen:

| Correo                       | Rol                |
| ---------------------------- | ------------------ |
| `superadmin@matisse.test`    | Superadministrador |
| `administrador@matisse.test` | Administrador      |
| `atencion@matisse.test`      | Atención           |
| `diseno@matisse.test`        | Diseño             |
| `produccion@matisse.test`    | Producción         |
| `acabados@matisse.test`      | Acabados           |
| `gerencia@matisse.test`      | Gerencia           |
| `consulta@matisse.test`      | Consulta           |

## Esquema

| Tabla               | Contenido                                                               |
| ------------------- | ----------------------------------------------------------------------- |
| `users`             | Correo, hash de contraseña, rol, estado activo y fecha de creación.     |
| `auth_sessions`     | Una sesión por dispositivo, con el hash de su refresh token.            |
| `audit_log`         | Bitácora de solo agregado: cambios y acciones de las personas.          |
| `rate_limits`       | Contadores de intentos compartidos entre procesos.                      |
| `catalog_families`  | Familias de producto.                                                   |
| `catalog_products`  | Productos de cada familia.                                              |
| `catalog_questions` | Detalles del trabajo de cada producto, como la medida.                  |
| `catalog_options`   | Valores posibles de cada detalle.                                       |
| `responsibles`      | Personas por área que reciben tareas.                                   |
| `orders`            | Orden, datos del cliente, producto, cantidades, fechas y estado actual. |
| `order_tasks`       | Tareas de producción por área, responsable, estado y cantidades.        |
| `order_events`      | Historial legible de la orden y sus asignaciones.                       |
| `order_attachments` | Archivos privados vinculados a una orden y, opcionalmente, a un evento. |

## Roles y permisos

Los ocho roles están fijos en código: `superadmin`, `administrador`, `atencion`, `diseno`, `produccion`, `acabados`, `gerencia` y `consulta`. Las concesiones de cada rol se definen en `src/domain/permissions.ts`.

Sobre lo que da el rol, Superadministrador y Administrador pueden agregar o quitar permisos a cada cuenta con los switches de `/admin/usuarios`. Se guardan en `users.permission_overrides` solo como diferencias con el rol y aplican de inmediato, sin volver a iniciar sesión. Reglas:

- Solo aplican a cuentas de área; Superadministrador y Administrador dependen de su rol.
- Nadie puede cambiar sus propios permisos.
- `users.manage` no se puede conceder: quien lo recibiera podría darse cualquier otro permiso.
- Un permiso agregado no tiene límite de área.
- Cambiar el rol de una cuenta borra sus ajustes, porque se hicieron sobre el rol anterior.

`AuthGuard` es global: toda ruta exige sesión salvo las marcadas con `@Public()`. Las rutas declaran su permiso con `@RequirePermissions()` y el alcance por área se valida en `src/orders/orders.scope.ts`. El frontend solo usa los permisos para mostrar u ocultar acciones.

Cada orden incluye lo que el front necesita para no repetir reglas: `trackingLight` (semáforo), `currentTask` (tarea activa) y `destinations` (áreas a las que ese usuario puede enviarla). Una orden lista no se reasigna y una con incidencia abierta no admite otra: el servidor responde `409`.

Los datos del cliente se devuelven solo si el rol tiene `orders.customer.name.read`, `orders.customer.phone.read` y `orders.delivery_address.read`. Una orden fuera del alcance del rol responde `404`, igual que una inexistente.

Solo el Superadministrador puede asignar o administrar cuentas `superadmin` o `administrador`. Ninguna cuenta puede modificar la suya propia.

## API

| Método   | Ruta                                                  | Uso                                                               |
| -------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `GET`    | `/health`                                             | Disponibilidad.                                                   |
| `GET`    | `/auth/status`                                        | Estado de sesión, rol y permisos.                                 |
| `POST`   | `/auth/login`                                         | Inicia sesión con `email`, `password` y `remember`.               |
| `POST`   | `/auth/logout`                                        | Cierra la sesión.                                                 |
| `GET`    | `/public/tracking/{code}`                             | Rastreo público por número de orden, sin sesión.                  |
| `POST`   | `/auth/change-password`                               | Cambia la contraseña propia.                                      |
| `GET`    | `/catalog/products`                                   | Árbol vigente de familias, productos, detalles y opciones.        |
| `POST`   | `/catalog/families`                                   | Crea una familia.                                                 |
| `POST`   | `/catalog/families/{id}/products`                     | Crea un producto.                                                 |
| `POST`   | `/catalog/products/{id}/questions`                    | Crea un detalle del trabajo.                                      |
| `POST`   | `/catalog/questions/{id}/options`                     | Crea una opción.                                                  |
| `PATCH`  | `/catalog/{families,products,questions,options}/{id}` | Corrige un elemento.                                              |
| `DELETE` | `/catalog/{families,products,questions,options}/{id}` | Elimina un elemento.                                              |
| `GET`    | `/orders`                                             | Lista órdenes según el alcance del rol.                           |
| `POST`   | `/orders`                                             | Registra una orden y la deriva a Diseño. Exige `Idempotency-Key`. |
| `GET`    | `/orders/{id}`                                        | Detalle de la orden.                                              |
| `PATCH`  | `/orders/{id}`                                        | Actualiza fecha, placa o especificaciones.                        |
| `DELETE` | `/orders/{id}`                                        | Elimina una orden.                                                |
| `POST`   | `/orders/{id}/reactivate`                             | Devuelve una cancelada a donde estaba. Exige `reason`.            |
| `POST`   | `/orders/{id}/assign`                                 | Asigna la orden a un área y responsable.                          |
| `POST`   | `/orders/{id}/notes`                                  | Agrega una nota al historial.                                     |
| `POST`   | `/orders/{id}/attachments`                            | Vincula adjuntos ya subidos.                                      |
| `DELETE` | `/orders/{id}/attachments/{fileId}`                   | Elimina un adjunto.                                               |
| `POST`   | `/orders/{id}/progress`                               | Registra avance de la tarea activa.                               |
| `POST`   | `/orders/{id}/start`                                  | Inicia la tarea activa.                                           |
| `PATCH`  | `/orders/{id}/task-status`                            | Cambia el estado de la tarea activa.                              |
| `POST`   | `/orders/{id}/complete`                               | Completa la tarea activa.                                         |
| `POST`   | `/orders/{id}/incidents`                              | Reporta una incidencia.                                           |
| `POST`   | `/orders/{id}/approve`                                | Aprueba una orden en Visto bueno.                                 |
| `POST`   | `/orders/{id}/cancel`                                 | Cancela una orden con `reason`.                                   |
| `GET`    | `/responsibles`                                       | Responsables por área.                                            |
| `POST`   | `/responsibles`                                       | Registra un responsable.                                          |
| `DELETE` | `/responsibles/{id}`                                  | Desactiva un responsable.                                         |
| `POST`   | `/archivos`                                           | Sube de 1 a 10 archivos con `order_number` y `files`.             |
| `GET`    | `/archivos/{id}/descargar`                            | Entrega un adjunto tras validar sesión y alcance.                 |
| `GET`    | `/admin/users`                                        | Lista usuarios.                                                   |
| `POST`   | `/admin/users`                                        | Asigna un rol a un correo.                                        |
| `PATCH`  | `/admin/users/{email}`                                | Cambia rol o estado.                                              |
| `DELETE` | `/admin/users/{email}`                                | Elimina una cuenta.                                               |
| `GET`    | `/audit`                                              | Consulta la bitácora; exige `audit.read`.                         |
| `GET`    | `/admin/users/{email}/permissions`                    | Permisos de la cuenta y su origen.                                |
| `PUT`    | `/admin/users/{email}/permissions/{permiso}`          | Enciende o apaga un permiso con `enabled`.                        |
| `POST`   | `/admin/users/{email}/permissions/reset`              | Vuelve a los permisos del rol.                                    |
| `POST`   | `/admin/users/{email}/reset-password`                 | Genera una contraseña temporal.                                   |

Las respuestas de recursos usan `{ "data": ... }`. Son excepciones `/auth/*`, `POST /archivos` y `/health`, que mantienen su forma propia. Los errores siempre son `{ "detail": ... }`.

`GET /public/tracking/{code}` devuelve únicamente `number`, `product`, `dueDate` y `stage` (`registering`, `inProgress`, `ready` o `cancelled`). Solo acepta el número de orden: el identificador interno no sirve y nunca expone datos del cliente, estado interno, historial ni adjuntos.

Las solicitudes de escritura deben enviar el header `Origin` igual a `FRONTEND_ORIGIN`. En producción usa HTTPS y `COOKIE_SECURE=true`.

## Sesiones

El acceso usa dos cookies `HttpOnly` y `SameSite=Lax`, ambas con ruta `/api`, por lo que la API debe publicarse bajo ese prefijo. JavaScript no puede leerlas.

| Cookie            | Contenido                                         | Duración                                                   |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `matisse_access`  | JWT HS256 con el correo del usuario.              | 15 minutos.                                                |
| `matisse_refresh` | Refresh token opaco; la base solo guarda su hash. | 400 días con `remember`; hasta cerrar el navegador sin él. |

Cuando el JWT vence, `AuthGuard` lo renueva dentro de la misma petición usando el refresh token. Por eso no hay endpoint de refresh ni reintentos en el front: las imágenes y descargas que abre el navegador se renuevan igual que las llamadas `fetch`.

Con **Mantener sesión iniciada** (`remember: true`) cada uso extiende el plazo otros 400 días, el máximo que aceptan los navegadores, de modo que la sesión no caduca mientras el dispositivo se use al menos una vez dentro de ese periodo. Sin esa opción, la sesión termina al cerrar el navegador o tras 12 horas sin uso.

El refresh token rota como máximo una vez cada 24 horas. El anterior sigue valiendo 2 minutos para las peticiones simultáneas; usarlo después, o presentar uno inventado, se trata como robo y borra la sesión de ese dispositivo.

El rol y el estado se leen de la base en cada petición, así que un cambio de rol aplica de inmediato. Suspender una cuenta termina todas sus sesiones y bloquea sus JWT vigentes. El cierre de sesión termina solo la del dispositivo actual; un JWT copiado antes de cerrar sesión seguiría siendo válido hasta vencer.

## Protección contra abuso y concurrencia

Los límites viven en PostgreSQL, así que valen para todos los procesos y sobreviven a un reinicio. El intento se cuenta antes de verificarlo, de modo que las peticiones en paralelo no pueden colarse.

| Acción             | Límite                                                   | Clave       |
| ------------------ | -------------------------------------------------------- | ----------- |
| Iniciar sesión     | 20 en 15 minutos                                         | IP          |
| Iniciar sesión     | 5 en 15 minutos y 15 en 24 horas; se reinician al entrar | correo + IP |
| Rastreo público    | 30 por minuto                                            | IP          |
| Rutas con sesión   | 300 por minuto                                           | usuario     |
| Cambiar contraseña | 5 por hora                                               | usuario     |

Al superarlos la API responde 429 con `Retry-After`.

- `POST /orders` usa `Idempotency-Key`: un doble clic o un reintento devuelve la misma orden.
- Cada orden tiene una `version`. Enviar, editar, cancelar, reactivar, aprobar, reportar una incidencia y eliminar exigen `If-Match` con la versión que veía quien actúa. La operación bloquea la orden y corre en una transacción: de dos acciones simultáneas pasa la primera, la otra recibe 409 sin aplicar nada, y si una falla a mitad de camino se deshace completa. Las notas y los adjuntos solo agregan, así que no compiten.
- La conexión usa `lock_timeout` de 5 segundos y `statement_timeout` de 30. Si se agotan, la API responde 503 en lugar de quedarse esperando.
- `helmet` agrega cabeceras de seguridad a la API. El front compilado incluye una CSP en `index.html`; como esa vía no admite `frame-ancestors`, configura `X-Frame-Options: DENY` en el hosting.

## Cancelar y eliminar

Cancelar es una decisión del negocio: por defecto la pueden tomar Atención, Gerencia y Superadministrador, y exige un motivo. La orden pasa al estado `cancelled`, sus tareas activas se cancelan, sale de las áreas y queda visible para quien ve todas las órdenes. El cliente ve el pedido como cancelado. No se puede reasignar, editar ni aprobar.

Reactivar exige `orders.reactivate` y un motivo. La orden vuelve al estado, área, tarea y responsable que tenía al cancelarse. Quien tiene ese permiso ve las canceladas aunque su rol solo vea su área.

Eliminar es otra cosa: oculta la orden por completo.

## Borrado lógico

Nada se borra físicamente, y triggers de PostgreSQL rechazan cualquier `DELETE` o `TRUNCATE` en las tablas del negocio y en `auth_sessions`. Usuarios, órdenes, adjuntos y catálogo llevan `deleted_at` y `deleted_by`, y TypeORM los excluye de toda consulta. Las sesiones terminadas conservan `deleted_at` y `end_reason`. Una orden eliminada deja de listarse y de rastrearse, y conserva su historial y sus archivos en Drive. Una cuenta eliminada pierde sus sesiones; si se vuelve a crear con el mismo correo, se restaura con una contraseña temporal nueva. Los responsables usan su campo `active` con el mismo fin.

## Bitácora

`audit_log` guarda dos tipos de registro, unidos por `request_id`:

- **Cambios:** un trigger registra cada alta, cambio y baja lógica con el antes y el después, aunque vengan de SQL directo. No depende de que el código se acuerde de registrarlos.
- **Acciones:** cada petición que escribe, también las rechazadas, con persona, rol, IP, navegador, respuesta y lo enviado. Incluye los intentos de entrar y la apertura de archivos adjuntos.

Las consultas normales no se registran. Tampoco las peticiones anónimas, salvo el inicio de sesión, ni las frenadas por el límite de peticiones. Las contraseñas, los hashes y los tokens nunca entran: de un cambio de contraseña solo queda que ocurrió.

La tabla es de solo agregado: `UPDATE`, `DELETE` y `TRUNCATE` fallan. `rate_limits` queda fuera porque son contadores que caducan. El dueño de la base puede desactivar los triggers, así que en producción la API debe conectarse con un rol que no sea dueño de las tablas.

Los cambios hechos por la API llevan a la persona porque un suscriptor de TypeORM entrega el contexto a cada transacción: toda escritura debe ir dentro de `db.transaction`. Una escritura fuera de transacción quedaría sin persona.

Por defecto consultan la bitácora Gerencia y Superadministrador; el resto, con el switch `audit.read`.

## Catálogo

El catálogo vive en la base y se cargó desde el catálogo anterior al migrar. Quien registra órdenes puede agregar familias, productos, detalles y opciones desde el formulario; si el nombre ya existe se reutiliza. Corregir o eliminar requiere `catalog.manage`, que tienen Gerencia y Superadministrador. Las órdenes guardan el texto del producto, así que cambiar el catálogo no altera las ya registradas.

## Archivos y Google Drive

Drive es el almacenamiento privado de los adjuntos; no interviene en el inicio de sesión. El backend usa `GOOGLE_REFRESH_TOKEN` con el ámbito `drive.file`, crea o reutiliza la carpeta `GOOGLE_DRIVE_FOLDER_NAME` y el navegador nunca recibe credenciales ni URLs de Drive.

La subida acepta imágenes y PDF para una orden a la que el usuario tiene acceso. El backend valida el tipo real por la firma del contenido, guarda el archivo en Drive y lo registra en `order_attachments`. Si una subida múltiple falla, elimina los archivos que ya había creado.

La descarga pasa por `/archivos/{id}/descargar` y se transmite por bloques. Solo funciona si el ID está registrado como adjunto de una orden y el rol tiene alcance sobre esa orden en ese momento: conocer un identificador de Drive no da acceso, y un área deja de ver el archivo cuando la orden sale de ella.

Para generar el refresh token: habilita Google Drive API, crea un cliente OAuth web y, en OAuth 2.0 Playground con esas credenciales, autoriza `https://www.googleapis.com/auth/drive.file` con la cuenta dueña de los archivos.

## Variables de `.env`

| Variable                   | Uso                                                                                                                                     |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | Conexión PostgreSQL.                                                                                                                    |
| `SESSION_SECRET`           | Cadena aleatoria de 32 o más caracteres para firmar los JWT. Cambiarla invalida los JWT, no las sesiones.                               |
| `FRONTEND_ORIGIN`          | Origen exacto del frontend, por ejemplo `https://app.tu-dominio`.                                                                       |
| `COOKIE_SECURE`            | `true` en HTTPS; `false` en desarrollo local.                                                                                           |
| `TRUST_PROXY_HOPS`         | Proxies de confianza delante de la API; por defecto 0. Ponlo en 1 detrás de un proxy o todos los clientes compartirán el límite por IP. |
| `ALLOW_TEST_SEED`          | `true` solo en desarrollo, para permitir los seeds de prueba.                                                                           |
| `GOOGLE_CLIENT_ID`         | Cliente OAuth usado para renovar el acceso a Drive.                                                                                     |
| `GOOGLE_CLIENT_SECRET`     | Secreto del cliente OAuth.                                                                                                              |
| `GOOGLE_REFRESH_TOKEN`     | Refresh token de la cuenta dueña de la carpeta de Drive.                                                                                |
| `GOOGLE_DRIVE_FOLDER_NAME` | Carpeta que el backend crea o reutiliza en Mi unidad.                                                                                   |
| `HOST` / `PORT`            | Dirección de escucha; por defecto `127.0.0.1:8000`.                                                                                     |
| `MAX_UPLOAD_BYTES`         | Límite por archivo; por defecto 25 MiB.                                                                                                 |
| `MAX_UPLOAD_TOTAL_BYTES`   | Límite total por solicitud; por defecto 50 MiB.                                                                                         |
| `MAX_FILES_PER_HOUR`       | Límite por cuenta y proceso; por defecto 30 archivos por hora.                                                                          |
| `ACCESS_TOKEN_TTL_SECONDS` | Duración del JWT de acceso; por defecto 900 segundos.                                                                                   |

## Comprobaciones

```bash
pnpm format
pnpm typecheck
pnpm build
pnpm migration:check
```

## Producción

```bash
pnpm install --frozen-lockfile
pnpm migration:run
pnpm start
```

El arranque es `dist/main.js`. La API debe servirse por HTTPS en el mismo origen que el frontend, bajo `/api`, con un proxy que quite ese prefijo antes de llegar a Nest. No publiques `.env` ni lo copies al frontend.
