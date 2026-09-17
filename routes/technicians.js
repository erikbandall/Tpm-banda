const express = require('express');
const db = require('../db/database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/technicians?active=true
router.get('/', async (req, res, next) => {
  try {
    const { active } = req.query;
    let sql = 'SELECT * FROM technicians';
    const params = [];
    if (active !== undefined) {
      sql += ' WHERE active = ?';
      params.push(active === 'true' || active === '1' ? 1 : 0);
    }
    sql += ' ORDER BY name COLLATE NOCASE';
    res.json(await db.prepare(sql).all(...params));
  } catch (err) { next(err); }
});

// POST /api/technicians (solo admin)
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { name, area, email } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    const info = await db.prepare('INSERT INTO technicians (name, area, email) VALUES (?, ?, ?)').run(String(name).trim(), area || null, email || null);
    res.status(201).json(await db.prepare('SELECT * FROM technicians WHERE id = ?').get(info.lastInsertRowid));
  } catch (err) { next(err); }
});

// PUT /api/technicians/:id (solo admin)
router.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await db.prepare('SELECT * FROM technicians WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Técnico no encontrado' });
    const { name, area, email, active } = req.body;
    await db.prepare('UPDATE technicians SET name = ?, area = ?, email = ?, active = ? WHERE id = ?').run(
      name != null && name !== '' ? String(name).trim() : existing.name,
      area !== undefined ? area : existing.area,
      email !== undefined ? email : existing.email,
      active !== undefined ? (active ? 1 : 0) : existing.active,
      req.params.id
    );
    res.json(await db.prepare('SELECT * FROM technicians WHERE id = ?').get(req.params.id));
  } catch (err) { next(err); }
});

// DELETE /api/technicians/:id (solo admin)
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await db.prepare('SELECT * FROM technicians WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Técnico no encontrado' });
    await db.prepare('DELETE FROM technicians WHERE id = ?').run(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
