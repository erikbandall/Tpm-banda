const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const db = require('./db/database');
const { requireAuth, requireRole } = require('./middleware/auth');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const toolsRouter = require('./routes/tools');
const maintenanceRouter = require('./routes/maintenance');
const dashboardRouter = require('./routes/dashboard');
const techniciansRouter = require('./routes/technicians');
const engineersRouter = require('./routes/engineers');
const linesRouter = require('./routes/lines');
const notificationsRouter = require('./routes/notifications');
const cronRouter = require('./routes/cron');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// La base de datos se inicializa de forma asíncrona (creación de tablas,
// migraciones, semilla de la cuenta admin). Esta pequeña espera evita que
// la primera petición llegue antes de que las tablas existan (típico en
// funciones serverless que arrancan en frío).
app.use((req, res, next) => { db.ready.then(() => next(), next); });

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Login/logout y el disparador de Vercel Cron son públicos (el cron no tiene
// sesión de usuario; se protege con CRON_SECRET dentro de routes/cron.js).
// Todo lo demás bajo /api requiere sesión.
app.use('/api/auth', authRouter);
app.use('/api/cron', cronRouter);
app.use('/api', requireAuth);

app.use('/api/users', requireRole('admin'), usersRouter);
app.use('/api/tools', toolsRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/technicians', techniciansRouter);
app.use('/api/engineers', engineersRouter);
app.use('/api/lines', linesRouter);
app.use('/api/notifications', notificationsRouter);

// Fallback: cualquier ruta no-API sirve la SPA (el login vive dentro de ella).
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Manejador de errores centralizado.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno del servidor' });
});

// En Vercel este archivo se importa como función serverless (no debe llamar
// a listen); localmente (`node server.js` o `npm start`) sí levanta el server.
if (require.main === module) {
  db.ready
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Mantenimiento de tooling escuchando en http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('No se pudo inicializar la base de datos:', err);
      process.exit(1);
    });
}

module.exports = app;
