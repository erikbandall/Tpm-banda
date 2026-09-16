const express = require('express');
const db = require('../db/database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

// GET /api/lines
router.get('/', async (req, res, next) => {
  try {
    res.json(await db.prepare('SELECT * FROM assembly_lines ORDER BY name COLLATE NOCASE').all());
  } catch (err) { next(err); }
});

// POST /api/lines (solo admin)
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    try {
      const info = await db.prepare('INSERT INTO assembly_lines (name) VALUES (?)').run(String(name).trim());
      res.status(201).json(await db.prepare('SELECT * FROM assembly_lines WHERE id = ?').get(info.lastInsertRowid));
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) return res.status(409).json({ error: 'Ya existe una línea con ese nombre' });
      throw err;
    }
  } catch (err) { next(err); }
});

// PUT /api/lines/:id (solo admin)
router.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await db.prepare('SELECT * FROM assembly_lines WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Línea no encontrada' });
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    try {
      await db.prepare('UPDATE assembly_lines SET name = ? WHERE id = ?').run(String(name).trim(), req.params.id);
      res.json(await db.prepare('SELECT * FROM assembly_lines WHERE id = ?').get(req.params.id));
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) return res.status(409).json({ error: 'Ya existe una línea con ese nombre' });
      throw err;
    }
  } catch (err) { next(err); }
});

// DELETE /api/lines/:id (solo admin)
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await db.prepare('SELECT * FROM assembly_lines WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Línea no encontrada' });
    await db.prepare('DELETE FROM assembly_lines WHERE id = ?').run(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
