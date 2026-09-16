// Conexión e inicialización de la base de datos.
//
// Usa libSQL (compatible con SQLite): en local corre embebida contra un
// archivo (data/tooling.db), sin necesidad de ninguna cuenta ni credencial.
// En producción (Vercel u otro hosting serverless) el sistema de archivos
// es de solo lectura / no persistente, así que ahí se conecta a una base de
// datos alojada en Turso (turso.tech, capa gratuita) mediante las variables
// de entorno TURSO_DATABASE_URL y TURSO_AUTH_TOKEN. Ver README para el paso
// a paso de cómo crear esa base de datos y configurar esas variables.

const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { createClient } = require('@libsql/client');

const isServerless = !!process.env.VERCEL;
const DATA_DIR = isServerless ? '/tmp/data' : path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'tooling.db');

const client = process.env.TURSO_DATABASE_URL
  ? createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN })
  : createClient({ url: `file:${DB_PATH}` });

// ===========================================================================
// Capa de compatibilidad: misma forma que better-sqlite3 (db.prepare(sql).
// run/get/all), pero asíncrona -- por eso cada ruta ahora usa await. Mantiene
// el resto del código (SQL, nombres de columnas, etc.) prácticamente igual.
// ===========================================================================

function prepare(sql) {
  return {
    all: async (...params) => (await client.execute({ sql, args: params })).rows,
    get: async (...params) => (await client.execute({ sql, args: params })).rows[0],
    run: async (...params) => {
      const r = await client.execute({ sql, args: params });
      return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.rowsAffected) };
    }
  };
}

// Transacción real (BEGIN/COMMIT) para las pocas rutas que insertan varias
// filas relacionadas de un jalón (p.ej. una programación + su checklist).
// Uso: await db.transaction(async (tx) => { await tx.prepare(sql).run(...); })();
function transaction(fn) {
  return async (...args) => {
    const tx = await client.transaction('write');
    const txDb = { prepare: (sql) => ({
      all: async (...params) => (await tx.execute({ sql, args: params })).rows,
      get: async (...params) => (await tx.execute({ sql, args: params })).rows[0],
      run: async (...params) => {
        const r = await tx.execute({ sql, args: params });
        return { lastInsertRowid: Number(r.lastInsertRowid), changes: Number(r.rowsAffected) };
      }
    }) };
    try {
      const result = await fn(txDb, ...args);
      await tx.commit();
      return result;
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  };
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS technicians (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    area TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS assembly_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'herramienta' CHECK (category IN ('maquina','herramienta','proceso','equipo')),
    type TEXT,
    location TEXT,
    assembly_line_id INTEGER REFERENCES assembly_lines(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo','en_mantenimiento','baja')),
    cost REAL,
    notes TEXT,
    photo_filename TEXT,
    photo_original_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS maintenance_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_id INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    maintenance_type TEXT NOT NULL,
    frequency_days INTEGER NOT NULL,
    assigned_technician_id INTEGER REFERENCES technicians(id) ON DELETE SET NULL,
    shift TEXT CHECK (shift IS NULL OR shift IN ('Turno 1','Turno 2','Turno 3')),
    alert_days_before INTEGER NOT NULL DEFAULT 7,
    last_done_date TEXT,
    next_due_date TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS checklist_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL REFERENCES maintenance_schedules(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS maintenance_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool_id INTEGER NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    schedule_id INTEGER REFERENCES maintenance_schedules(id) ON DELETE SET NULL,
    maintenance_type TEXT NOT NULL,
    technician_id INTEGER REFERENCES technicians(id) ON DELETE SET NULL,
    shift TEXT,
    performed_date TEXT NOT NULL,
    description TEXT,
    parts_used TEXT,
    on_time INTEGER,
    evidence_filename TEXT,
    evidence_original_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS maintenance_log_checklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_id INTEGER NOT NULL REFERENCES maintenance_logs(id) ON DELETE CASCADE,
    checklist_item_id INTEGER REFERENCES checklist_items(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    notes TEXT
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER REFERENCES maintenance_schedules(id) ON DELETE CASCADE,
    tool_id INTEGER REFERENCES tools(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('overdue','upcoming')),
    due_date_snapshot TEXT NOT NULL,
    message TEXT NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(schedule_id, type, due_date_snapshot)
  );

  CREATE INDEX IF NOT EXISTS idx_schedules_tool ON maintenance_schedules(tool_id);
  CREATE INDEX IF NOT EXISTS idx_schedules_due ON maintenance_schedules(next_due_date);
  CREATE INDEX IF NOT EXISTS idx_schedules_tech ON maintenance_schedules(assigned_technician_id);
  CREATE INDEX IF NOT EXISTS idx_logs_tool ON maintenance_logs(tool_id);
  CREATE INDEX IF NOT EXISTS idx_checklist_schedule ON checklist_items(schedule_id);
  CREATE INDEX IF NOT EXISTS idx_log_checklist_log ON maintenance_log_checklist(log_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
  CREATE INDEX IF NOT EXISTS idx_tools_line ON tools(assembly_line_id);

  -- ===================== Cuentas de acceso (login) =====================

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','ingeniero','tecnico')),
    technician_id INTEGER REFERENCES technicians(id) ON DELETE SET NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_users_technician ON users(technician_id);
`;

async function migrateAddColumn(sql) {
  try { await client.execute(sql); } catch (err) {
    if (!/duplicate column/i.test(err.message)) throw err;
  }
}

async function init() {
  await client.executeMultiple(SCHEMA);

  // Migración suave: agrega columnas nuevas a bases de datos ya existentes
  // (no rompe nada si la columna ya está, o si la tabla se acaba de crear).
  await migrateAddColumn('ALTER TABLE tools ADD COLUMN cost REAL');

  // Primer arranque: si no hay ninguna cuenta todavía, crea un admin por
  // defecto para poder entrar la primera vez. Cámbialo de inmediato desde
  // Configuración → Usuarios.
  const userCount = await prepare('SELECT COUNT(*) AS n FROM users').get();
  if (!userCount || Number(userCount.n) === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
    console.log('[auth] Cuenta admin creada por primera vez -> usuario: admin / contraseña: admin123 (cámbiala en cuanto entres).');
  }
}

const ready = init();
ready.catch((err) => console.error('[db] Error al inicializar la base de datos:', err));

module.exports = { prepare, transaction, ready, client };
