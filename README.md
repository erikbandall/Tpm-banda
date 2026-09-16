# Mantenimiento de Tooling de Proceso

Aplicación web para gestionar el mantenimiento preventivo del herramental de
proceso: máquinas, herramientas, fixtures y ganchos, con programación por
frecuencia, técnico asignado, línea de ensamble y turno, checklist de
ejecución, alertas de vencimiento, costos y un dashboard interactivo. Acceso
por usuario y contraseña, con permisos distintos para Administrador,
Ingeniero y Técnico.

## Diseño

Interfaz estilo **Microsoft 365 / Fluent** (barra superior con selector de
apps, nav rail clara, tarjetas con sombra suave, azul Microsoft) para que se
sienta como el resto de las herramientas de oficina que ya usa el equipo.

## Acceso y roles

La app pide **usuario y contraseña** desde la primera pantalla; nadie ve
nada sin iniciar sesión. Al arrancar por primera vez (base de datos vacía)
se crea automáticamente una cuenta administradora:

```
usuario: admin
contraseña: admin123
```

**Cámbiala en cuanto entres** (Configuración → Usuarios → Editar → escribe
una nueva contraseña). No hay forma de recuperarla por correo (no hay
servicio de correo configurado); si la pierdes, un administrador con acceso
al servidor puede borrar la fila en la tabla `users` para que se vuelva a
generar la cuenta `admin` por defecto en el siguiente arranque.

Tres roles:

| Rol | Puede hacer |
|---|---|
| **Administrador** | Todo: alta/edición/baja de herramientas, líneas, técnicos, programaciones, importación desde Excel, y **crear/editar/eliminar cuentas de usuario** (incluyendo asignarles rol y técnico ligado). |
| **Ingeniero** | Ver todo (solo lectura). No puede editar herramientas/líneas/técnicos/programaciones, ni gestionar cuentas, ni completar mantenimientos. |
| **Técnico** | Ver todo; **completar mantenimientos** (registrar bitácora) únicamente de las programaciones asignadas a sí mismo, y solo a su propio nombre — nunca a nombre de otro técnico. No puede editar el catálogo ni gestionar cuentas. |

Cada cuenta de técnico está ligada a un registro de la tabla de técnicos
(`technician_id`); así el sistema sabe qué programaciones puede completar esa
persona. Se liga al crear la cuenta en Configuración → Usuarios (puedes
elegir un técnico ya existente o escribir un nombre nuevo para crearlo de
una vez).

La sesión se guarda en una cookie `httpOnly` (no accesible desde JavaScript,
así que no se puede robar con un simple script) válida 30 días; "Cerrar
sesión" en el menú del usuario (arriba a la derecha) la invalida al momento.

## Funcionalidad

- **Dashboard**: panel de mantenimientos preventivos **requeridos vs.
  realizados por línea de ensamble** (mes en curso) con badges de alerta
  (vencidas/próximas); KPIs (activos, vencidas, próximas a vencer,
  cumplimiento a 90 días, **valor total del herramental**); filtros por
  línea y técnico; gráficas de tendencia, cumplimiento por técnico, por
  categoría y **costo por línea**; tablas de vencidos/próximos/recientes.
- **Herramientas**: inventario de máquinas, herramientas, fixtures, ganchos
  y procesos — código, categoría, línea de ensamble, ubicación, **costo
  aproximado** y estado. Vista de detalle con sus programaciones y bitácora.
  Alta manual una por una, o **en lote desde un archivo Excel**.
- **Mantenimiento**:
  - *Programaciones*: tipo, frecuencia en días, técnico asignado, turno,
    anticipación de alerta configurable y checklist de ítems a realizar.
    Alta/edición/baja solo para Administrador.
  - *Bitácora*: registro de cada mantenimiento con técnico, turno, y el
    checklist marcado ítem por ítem (con notas). Registrar contra una
    programación recalcula automáticamente su próxima fecha y marca si se
    hizo a tiempo o tarde. Un Técnico solo puede registrar mantenimientos a
    su propio nombre, y si eligen una programación, solo si está asignada a
    él/ella.
- **Calendario**: vista mensual de mantenimiento (Programados / Historial),
  con chips por día coloreados por categoría de activo, navegación entre
  meses y un modal por día para completar el mantenimiento directamente.
- **Configuración**: gestión de técnicos de manufactura, líneas de ensamble
  y (solo Administrador) **cuentas de usuario**.
- **Notificaciones**: centro de alertas (campana con contador) que genera
  avisos de mantenimientos vencidos y próximos a vencer. No envía
  correo/SMS — ver Notas.

### Importar herramientas desde Excel

Configuración/Herramientas → **"Importar Excel"** (solo Administrador). El
archivo (`.xlsx`, `.xls` o `.csv`) debe traer estos encabezados en la
primera fila:

| Columna | Obligatoria | Notas |
|---|---|---|
| No. de Parte | Sí | Código único del activo |
| Descripción | Sí | Nombre/descripción |
| Categoría | No | `maquina`, `herramienta`, `proceso` o `equipo` (por defecto `herramienta`) |
| Línea | No | Se empareja por nombre con una línea ya existente; si no coincide, se importa sin línea |
| Frecuencia (días) | No | Si viene, además crea la primera programación de mantenimiento preventivo |
| Técnico Asignado | No | Se empareja por nombre con un técnico ya existente |
| Costo Aproximado (USD) | No | Numérico |
| Ubicación | No | Texto libre |
| Estado | No | `activo`, `en_mantenimiento` o `baja` (por defecto `activo`) |

Corre `npm run make-template` para regenerar `plantilla-herramientas.xlsx`
(ya incluida en el repo) con estas columnas y filas de ejemplo — bórralas y
pon tus propias herramientas antes de importar. Filas con código duplicado
o sin No. de Parte/Descripción se omiten y se listan como error, sin
detener la importación del resto.

## Stack

- Backend: Node.js + Express, API REST bajo `/api`.
- Base de datos: **libSQL** (compatible con SQLite). En local corre
  embebida contra un archivo (`data/tooling.db`, se crea sola, no se
  versiona). En producción/Vercel se conecta a una base de datos alojada en
  [Turso](https://turso.tech) — ver sección de despliegue.
- Autenticación: cookie `httpOnly` con JWT (`jsonwebtoken`) + contraseñas
  con hash `bcryptjs` (nunca se guardan en texto plano).
- Importación de Excel: `xlsx` (SheetJS) — ver nota de seguridad abajo.
- Frontend: SPA en HTML/CSS/JS sin frameworks, servida como estático desde `/public`.

## Cómo correr la app en local

```bash
npm install
npm start
```

La app queda disponible en `http://localhost:3000` (o el puerto definido en
la variable de entorno `PORT`). En local no necesitas configurar nada más:
la base de datos se crea sola y se genera la cuenta `admin` / `admin123` en
el primer arranque.

Para desarrollo con recarga automática del servidor:

```bash
npm run dev
```

Variables de entorno opcionales en local (usa un archivo `.env` con algo
como [`dotenv`](https://www.npmjs.com/package/dotenv) si quieres, o
expórtalas en tu shell):

| Variable | Para qué |
|---|---|
| `JWT_SECRET` | Firma las sesiones. Si no la defines, se usa un valor de desarrollo (inseguro) y se muestra una advertencia en consola. **Obligatoria en producción.** |
| `PORT` | Puerto del servidor (por defecto `3000`). |

## Desplegar en Vercel (con base de datos real en Turso)

Vercel corre este servidor como **función serverless**: su disco es de solo
lectura y no persiste entre invocaciones, así que **no puede usar el
archivo SQLite local** para datos que deban sobrevivir (usuarios,
herramientas importadas, bitácora). Por eso el backend ya está preparado
para conectarse a **Turso**, una base de datos SQLite alojada con una capa
gratuita generosa y sin necesidad de administrar un servidor.

1. **Crea la base de datos en Turso** (una sola vez):
   - Entra a [turso.tech](https://turso.tech) y crea una cuenta (puedes
     entrar con tu cuenta de GitHub).
   - Con la [CLI de Turso](https://docs.turso.tech/cli/installation)
     instalada: `turso db create tooling-app`.
   - Obtén la URL de conexión: `turso db show tooling-app --url` (empieza
     con `libsql://...`).
   - Genera un token de acceso: `turso db tokens create tooling-app`.

2. **Importa el repositorio en Vercel**: [vercel.com/new](https://vercel.com/new)
   → conecta tu cuenta de GitHub → elige este repositorio.

3. **Configura las variables de entorno del proyecto en Vercel** (Project
   Settings → Environment Variables):

   | Variable | Valor |
   |---|---|
   | `TURSO_DATABASE_URL` | La URL `libsql://...` del paso 1 |
   | `TURSO_AUTH_TOKEN` | El token del paso 1 |
   | `JWT_SECRET` | Una cadena larga y aleatoria que tú inventes (ej. genera una con `openssl rand -base64 32`) |
   | `NODE_ENV` | `production` |

4. **Despliega.** Vercel construye y publica automáticamente en cada push a
   la rama principal. La primera petición crea las tablas y la cuenta
   `admin` / `admin123` en la base de datos de Turso — cámbiala de
   inmediato.

### Limitación conocida: fotos de herramientas y evidencia PDF

Igual que la base de datos, el disco de Vercel no conserva archivos entre
invocaciones. Las fotos de herramientas y los PDF de evidencia de
mantenimiento **sí se pueden subir, pero no se conservan de forma
permanente** en Vercel (funcionan bien corriendo la app localmente o en un
servidor propio — ver sección siguiente). Para que persistan en Vercel
haría falta integrar un almacenamiento de archivos aparte, como
[Vercel Blob](https://vercel.com/docs/storage/vercel-blob) — no incluido en
esta versión.

### Hacer el repositorio privado

Por defecto un repositorio nuevo en GitHub puede quedar público. Para
volverlo privado: en GitHub, Settings del repositorio → baja hasta
"Danger Zone" → **Change repository visibility** → Private.

## Alojarla en un servidor local de la empresa (solo red interna)

Ideal si todos los que van a usar la app están conectados a la red/WiFi de
la planta y no se necesita acceso desde fuera. No requiere Turso ni ningún
gasto de nube: al no definir `TURSO_DATABASE_URL`, la app usa su archivo
SQLite local — y ahí sí, las fotos y PDFs de evidencia quedan guardados de
forma permanente en el disco de ese equipo.

1. **Elige el equipo que hará de "servidor".** Puede ser una PC de
   escritorio normal (no necesita ser potente) que se quede encendida
   durante el horario de uso, de preferencia conectada por cable de red
   (más estable que WiFi). Instálale [Node.js LTS](https://nodejs.org)
   (versión 18 o superior).

2. **Copia el proyecto ahí** y instala dependencias:
   ```bash
   git clone https://github.com/erikbandall/Escaner.git
   cd Escaner
   npm install
   ```
   (o copia la carpeta sin `node_modules/` ni `data/` y corre `npm install`
   ahí mismo).

3. **Define un `JWT_SECRET` propio** (variable de entorno del sistema, o un
   archivo `.env` si usas algo como `dotenv`) — no dejes el valor de
   desarrollo por defecto en un servidor que va a usar el equipo.

4. **Dale una IP fija a ese equipo**, para que la dirección no cambie al
   reiniciar el router: reserva esa IP por su dirección MAC en la
   configuración del router (recomendado), o configúrale una IP estática
   manual en las propiedades de red. Anótala, por ejemplo `192.168.1.50`.

5. **Abre el puerto en el firewall** para que otros equipos de la red
   puedan conectarse:
   - Windows: Firewall de Windows Defender → Configuración avanzada →
     Reglas de entrada → Nueva regla → Puerto → TCP → `3000` → Permitir la
     conexión.
   - Linux: `sudo ufw allow 3000/tcp`.

6. **Corre la app de forma permanente**, no solo en una terminal abierta
   (si la cierras o el usuario cierra sesión, `npm start` se detiene). Usa
   [PM2](https://pm2.keymetrics.io/), que funciona igual en Windows, Linux
   o Mac:
   ```bash
   npm install -g pm2
   pm2 start server.js --name toolmaint
   pm2 save
   pm2 startup    # sigue las instrucciones que imprime para arrancar con el sistema
   ```

7. **Accede desde cualquier equipo de la red** abriendo en el navegador
   `http://192.168.1.50:3000` (cambia la IP por la del equipo servidor).
   Guarda esa dirección como acceso directo/marcador en cada equipo que la
   use.

8. **Respaldos.** Conviene respaldar periódicamente `data/tooling.db` (la
   base de datos) y `data/uploads/` (fotos y PDFs de evidencia) — por
   ejemplo copiándolos a diario a una carpeta compartida de red o a un USB,
   con una tarea programada.

Si más adelante necesitas que alguien acceda desde fuera de la planta (otra
sucursal, celular con datos, casa), las opciones son una VPN hacia la red de
la empresa, o desplegar en Vercel como se explica arriba.

## Estructura

```
server.js                    Punto de entrada Express (también exportado para Vercel)
db/database.js               Conexión libSQL (local o Turso) + esquema + migraciones
middleware/auth.js           JWT en cookie httpOnly, requireAuth, requireRole
routes/auth.js                Login / logout / sesión activa
routes/users.js                Alta/edición/baja de cuentas (solo admin)
routes/tools.js                API de activos + importación desde Excel
routes/technicians.js          API de técnicos de manufactura
routes/lines.js                API de líneas de ensamble
routes/maintenance.js          API de programaciones (+ checklist) y bitácora
routes/notifications.js        API de notificaciones (generación + lectura)
routes/dashboard.js            API de resumen, desglose por línea/categoría/técnico y costos
scripts/build-tools-template.js  Genera plantilla-herramientas.xlsx (npm run make-template)
public/                       Frontend (index.html, css/, js/)
demo/preview.html            Vista previa autocontenida sin backend (ver demo/README.md)
demo/preview-v2.html         Maqueta de revisión con login/roles/calendario (ver demo/README.md)
```

## API (resumen)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | Iniciar sesión (público) |
| POST | `/api/auth/logout` | Cerrar sesión |
| GET | `/api/auth/me` | Sesión activa |
| GET/POST | `/api/users` | Listar / crear cuentas (solo admin) |
| PUT/DELETE | `/api/users/:id` | Editar / eliminar cuenta (solo admin) |
| GET/POST | `/api/tools` | Listar / crear activos (crear: solo admin) |
| GET/PUT/DELETE | `/api/tools/:id` | Detalle / editar / eliminar activo (editar/eliminar: solo admin) |
| GET | `/api/tools/lookup/:code` | Buscar activo por código |
| GET | `/api/tools/:id/schedules` \| `/logs` | Programaciones / bitácora de un activo |
| POST | `/api/tools/import` | Importar herramientas desde Excel (solo admin) |
| GET/POST | `/api/technicians` | Listar / crear técnicos (crear: solo admin) |
| PUT/DELETE | `/api/technicians/:id` | Editar / eliminar técnico (solo admin) |
| GET/POST | `/api/lines` | Listar / crear líneas de ensamble (crear: solo admin) |
| PUT/DELETE | `/api/lines/:id` | Editar / eliminar línea (solo admin) |
| GET/POST | `/api/maintenance/schedules` | Programaciones (crear: solo admin) |
| GET/PUT/DELETE | `/api/maintenance/schedules/:id` | Detalle / editar / eliminar (editar/eliminar: solo admin) |
| GET/POST | `/api/maintenance/logs` | Bitácora (crear: admin o el propio técnico) |
| GET/DELETE | `/api/maintenance/logs/:id` | Detalle / eliminar registro (eliminar: solo admin) |
| GET | `/api/notifications` | Notificaciones (genera nuevas automáticamente) |
| GET | `/api/notifications/count` | Contador de no leídas |
| POST | `/api/notifications/:id/read` \| `/read-all` | Marcar leídas |
| GET | `/api/dashboard/summary` | Resumen con filtros por línea/técnico (incluye costo total) |
| GET | `/api/dashboard/by-line` \| `/by-category` \| `/by-technician` \| `/trend` \| `/by-cost` | Desgloses para las gráficas del dashboard |

Todas las rutas bajo `/api` (excepto `/api/auth/login`, `/api/auth/logout` y
`/api/health`) requieren sesión iniciada; las que no dicen "solo admin" son
de lectura para cualquier rol autenticado.

## Notas

- La importación de Excel usa la librería `xlsx` (SheetJS). La versión
  publicada en npm tiene advisories conocidos de seguridad (ReDoS y
  prototype pollution) sin parche disponible ahí; el riesgo es acotado
  porque el endpoint es solo para Administrador con archivos que tú mismo
  subes, pero evita importar archivos `.xlsx` de origen desconocido.
- Las notificaciones son un centro **dentro de la app** (no se envía correo
  ni SMS). Conectar un canal externo real requeriría credenciales de un
  servicio de correo/SMS (ej. SMTP) que no están configuradas aquí.
