// Gestión de cuentas de acceso (solo administrador). Cada técnico de
// manufactura puede tener una cuenta de usuario ligada (technician_id) para
// que el sistema sepa qué mantenimientos puede completar; un ingeniero puede
// ligarse de la misma forma a un registro de la tabla de ingenieros
// (engineer_id), solo como referencia de contacto.

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');

const router = express.Router();
const ROLES = ['admin', 'ingeniero', 'tecnico'];

const SELECT_WITH_JOIN = `
  SELECT u.id, u.username, u.role, u.technician_id, u.engineer_id, u.active, u.created_at,
         t.name AS technician_name, e.name AS engineer_name
  FROM users u
  LEFT JOIN technicians t ON t.id = u.technician_id
  LEFT JOIN engineers e ON e.id = u.engineer_id
`;

// GET /api/users
router.get('/', async (req, res, next) => {
  try {
    res.json(await db.prepare(`${SELECT_WITH_JOIN} ORDER BY u.role, u.username COLLATE NOCASE`).all());
  } catch (err) { next(err); }
});

function validate(body, { isNew }) {
  const { username, password, role } = body;
  if (isNew) {
    if (!username || !String(username).trim()) return 'El usuario es obligatorio.';
    if (!password || String(password).length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (password !== undefined && password !== '' && String(password).length < 6) {
    return 'La contraseña debe tener al menos 6 caracteres.';
  }
  if (role !== undefined && !ROLES.includes(role)) return `Rol inválido. Usa: ${ROLES.join(', ')}`;
  return null;
}

// POST /api/users
// body: { username, password, role, technician_id?, technician_name?, engineer_id?, engineer_name? }
// - Para role 'tecnico' puedes ligar un técnico existente (technician_id) o
//   crear uno nuevo al vuelo con technician_name.
// - Para role 'ingeniero' aplica lo mismo con engineer_id / engineer_name.
router.post('/', async (req, res, next) => {
  try {
    const err = validate(req.body, { isNew: true });
    if (err) return res.status(400).json({ error: err });

    const { username, password, role, technician_id, technician_name, engineer_id, engineer_name } = req.body;
    const uname = String(username).trim();

    const existing = await db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
    if (existing) return res.status(409).json({ error: 'Ya existe una cuenta con ese usuario.' });

    let techId = technician_id ? Number(technician_id) : null;
    if (role === 'tecnico' && !techId && technician_name && String(technician_name).trim()) {
      const info = await db.prepare('INSERT INTO technicians (name) VALUES (?)').run(String(technician_name).trim());
      techId = info.lastInsertRowid;
    }
    if (role !== 'tecnico') techId = null;

    let engId = engineer_id ? Number(engineer_id) : null;
    if (role === 'ingeniero' && !engId && engineer_name && String(engineer_name).trim()) {
      const info = await db.prepare('INSERT INTO engineers (name) VALUES (?)').run(String(engineer_name).trim());
      engId = info.lastInsertRowid;
    }
    if (role !== 'ingeniero') engId = null;

    const hash = await bcrypt.hash(String(password), 10);
    const info = await db.prepare(
      'INSERT INTO users (username, password_hash, role, technician_id, engineer_id) VALUES (?, ?, ?, ?, ?)'
    ).run(uname, hash, role, techId, engId);

    res.status(201).json(await db.prepare(`${SELECT_WITH_JOIN} WHERE u.id = ?`).get(info.lastInsertRowid));
  } catch (err) { next(err); }
});

// PUT /api/users/:id -- editar rol/técnico/ingeniero/estado, y opcionalmente nueva contraseña
router.put('/:id', async (req, res, next) => {
  try {
    const existing = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Cuenta no encontrada.' });

    const err = validate(req.body, { isNew: false });
    if (err) return res.status(400).json({ error: err });

    const { role, technician_id, engineer_id, active, password } = req.body;
    if (String(req.params.id) === String(req.user.id) && active !== undefined && !active) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta.' });
    }

    const newRole = role || existing.role;
    let techId = technician_id !== undefined ? (technician_id ? Number(technician_id) : null) : existing.technician_id;
    if (newRole !== 'tecnico') techId = null;
    let engId = engineer_id !== undefined ? (engineer_id ? Number(engineer_id) : null) : existing.engineer_id;
    if (newRole !== 'ingeniero') engId = null;

    await db.prepare(
      'UPDATE users SET role = ?, technician_id = ?, engineer_id = ?, active = ? WHERE id = ?'
    ).run(newRole, techId, engId, active !== undefined ? (active ? 1 : 0) : existing.active, req.params.id);

    if (password) {
      const hash = await bcrypt.hash(String(password), 10);
      await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.params.id);
    }

    res.json(await db.prepare(`${SELECT_WITH_JOIN} WHERE u.id = ?`).get(req.params.id));
  } catch (err) { next(err); }
});

// DELETE /api/users/:id
router.delete('/:id', async (req, res, next) => {
  try {
    if (String(req.params.id) === String(req.user.id)) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta.' });
    }
    const existing = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Cuenta no encontrada.' });
    await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
