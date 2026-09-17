const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const XLSX = require('xlsx');
const db = require('../db/database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const VALID_STATUS = ['activo', 'en_mantenimiento', 'baja'];
const VALID_CATEGORY = ['fixture', 'gancho', 'tooling'];

const UPLOADS_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const PHOTO_EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const uploadPhoto = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${PHOTO_EXT_BY_MIME[file.mimetype] || ''}`)
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB
  fileFilter: (req, file, cb) => {
    if (!PHOTO_EXT_BY_MIME[file.mimetype]) return cb(new Error('Solo se admiten imágenes JPG, PNG o WEBP'));
    cb(null, true);
  }
});

const uploadExcel = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const ok = /\.(xlsx|xls|csv)$/i.test(file.originalname);
    if (!ok) return cb(new Error('Sube un archivo .xlsx, .xls o .csv'));
    cb(null, true);
  }
});

const SELECT_WITH_JOINS = `
  SELECT t.*, l.name AS line_name
  FROM tools t LEFT JOIN assembly_lines l ON l.id = t.assembly_line_id
`;

// GET /api/tools?status=&q=&category=&assembly_line_id=
router.get('/', async (req, res, next) => {
  try {
    const { status, q, category, assembly_line_id } = req.query;
    let sql = SELECT_WITH_JOINS;
    const clauses = [];
    const params = [];

    if (status) { clauses.push('t.status = ?'); params.push(status); }
    if (category) { clauses.push('t.category = ?'); params.push(category); }
    if (assembly_line_id) { clauses.push('t.assembly_line_id = ?'); params.push(assembly_line_id); }
    if (q) {
      clauses.push('(t.code LIKE ? OR t.name LIKE ? OR t.type LIKE ? OR t.location LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }
    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY t.name COLLATE NOCASE';

    res.json(await db.prepare(sql).all(...params));
  } catch (err) { next(err); }
});

// GET /api/tools/import/template -- plantilla de columnas esperadas (JSON, para el modal de importación)
router.get('/import/template', (req, res) => {
  res.json({
    columns: [
      'No. de Parte', 'Descripción', 'Categoría', 'Línea', 'Frecuencia (días)',
      'Técnico Asignado', 'Costo Aproximado (USD)', 'Ubicación', 'Estado'
    ],
    notes: 'Categoría: maquina, herramienta, proceso o equipo. Estado: activo, en_mantenimiento o baja (opcional, por defecto activo).'
  });
});

// GET /api/tools/:id
router.get('/:id', async (req, res, next) => {
  try {
    const tool = await db.prepare(`${SELECT_WITH_JOINS} WHERE t.id = ?`).get(req.params.id);
    if (!tool) return res.status(404).json({ error: 'Herramienta no encontrada' });
    res.json(tool);
  } catch (err) { next(err); }
});

// GET /api/tools/lookup/:code
router.get('/lookup/:code', async (req, res, next) => {
  try {
    const tool = await db.prepare(`${SELECT_WITH_JOINS} WHERE t.code = ?`).get(req.params.code);
    if (!tool) return res.status(404).json({ error: 'No existe una herramienta con ese código' });
    res.json(tool);
  } catch (err) { next(err); }
});

function validate(body) {
  const { code, name, category, status } = body;
  if (!code || !String(code).trim()) return 'El código es obligatorio';
  if (!name || !String(name).trim()) return 'El nombre es obligatorio';
  if (category && !VALID_CATEGORY.includes(category)) return `Categoría inválida. Usa: ${VALID_CATEGORY.join(', ')}`;
  if (status && !VALID_STATUS.includes(status)) return `Estado inválido. Usa: ${VALID_STATUS.join(', ')}`;
  return null;
}

// POST /api/tools (solo admin)
router.post('/', requireRole('admin'), async (req, res, next) => {
  try {
    const err = validate(req.body);
    if (err) return res.status(400).json({ error: err });
    const { code, name, category, type, location, assembly_line_id, status, cost, notes } = req.body;

    try {
      const info = await db.prepare(`
        INSERT INTO tools (code, name, category, type, location, assembly_line_id, status, cost, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        String(code).trim(),
        String(name).trim(),
        category || 'tooling',
        type || null,
        location || null,
        assembly_line_id || null,
        status || 'activo',
        cost !== undefined && cost !== '' ? Number(cost) : null,
        notes || null
      );
      res.status(201).json(await db.prepare(`${SELECT_WITH_JOINS} WHERE t.id = ?`).get(info.lastInsertRowid));
    } catch (err2) {
      if (/UNIQUE/i.test(err2.message)) return res.status(409).json({ error: 'Ya existe una herramienta con ese código' });
      throw err2;
    }
  } catch (err) { next(err); }
});

// PUT /api/tools/:id (solo admin)
router.put('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await db.prepare('SELECT * FROM tools WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Herramienta no encontrada' });

    const { code, name, category, status } = req.body;
    if (category && !VALID_CATEGORY.includes(category)) {
      return res.status(400).json({ error: `Categoría inválida. Usa: ${VALID_CATEGORY.join(', ')}` });
    }
    if (status && !VALID_STATUS.includes(status)) {
      return res.status(400).json({ error: `Estado inválido. Usa: ${VALID_STATUS.join(', ')}` });
    }

    const { type, location, assembly_line_id, cost, notes } = req.body;
    try {
      await db.prepare(`
        UPDATE tools SET
          code = ?, name = ?, category = ?, type = ?, location = ?, assembly_line_id = ?, status = ?, cost = ?, notes = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        code != null && code !== '' ? String(code).trim() : existing.code,
        name != null && name !== '' ? String(name).trim() : existing.name,
        category || existing.category,
        type !== undefined ? type : existing.type,
        location !== undefined ? location : existing.location,
        assembly_line_id !== undefined ? (assembly_line_id || null) : existing.assembly_line_id,
        status || existing.status,
        cost !== undefined ? (cost === '' ? null : Number(cost)) : existing.cost,
        notes !== undefined ? notes : existing.notes,
        req.params.id
      );
      res.json(await db.prepare(`${SELECT_WITH_JOINS} WHERE t.id = ?`).get(req.params.id));
    } catch (err) {
      if (/UNIQUE/i.test(err.message)) return res.status(409).json({ error: 'Ya existe otra herramienta con ese código' });
      throw err;
    }
  } catch (err) { next(err); }
});

// DELETE /api/tools/:id (solo admin)
router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await db.prepare('SELECT * FROM tools WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Herramienta no encontrada' });
    if (existing.photo_filename) fs.unlink(path.join(UPLOADS_DIR, existing.photo_filename), () => {});
    await db.prepare('DELETE FROM tools WHERE id = ?').run(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

// POST /api/tools/:id/photo (solo admin) -- subir/reemplazar fotografía
router.post('/:id/photo', requireRole('admin'), (req, res, next) => {
  uploadPhoto.single('photo')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message || 'No se pudo subir la imagen' });

      const tool = await db.prepare('SELECT * FROM tools WHERE id = ?').get(req.params.id);
      if (!tool) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(404).json({ error: 'Herramienta no encontrada' });
      }
      if (!req.file) return res.status(400).json({ error: 'Adjunta una imagen' });

      if (tool.photo_filename) fs.unlink(path.join(UPLOADS_DIR, tool.photo_filename), () => {});

      await db.prepare(`UPDATE tools SET photo_filename = ?, photo_original_name = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(req.file.filename, req.file.originalname, req.params.id);

      res.status(201).json(await db.prepare(`${SELECT_WITH_JOINS} WHERE t.id = ?`).get(req.params.id));
    } catch (err2) { next(err2); }
  });
});

// GET /api/tools/:id/photo -- ver la fotografía
router.get('/:id/photo', async (req, res, next) => {
  try {
    const tool = await db.prepare('SELECT * FROM tools WHERE id = ?').get(req.params.id);
    if (!tool || !tool.photo_filename) return res.status(404).json({ error: 'Sin fotografía' });
    const filePath = path.join(UPLOADS_DIR, tool.photo_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'El archivo ya no está disponible' });
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(filePath);
  } catch (err) { next(err); }
});

// DELETE /api/tools/:id/photo (solo admin)
router.delete('/:id/photo', requireRole('admin'), async (req, res, next) => {
  try {
    const tool = await db.prepare('SELECT * FROM tools WHERE id = ?').get(req.params.id);
    if (!tool) return res.status(404).json({ error: 'Herramienta no encontrada' });
    if (tool.photo_filename) {
      fs.unlink(path.join(UPLOADS_DIR, tool.photo_filename), () => {});
      await db.prepare(`UPDATE tools SET photo_filename = NULL, photo_original_name = NULL, updated_at = datetime('now') WHERE id = ?`).run(req.params.id);
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

// GET /api/tools/:id/schedules
router.get('/:id/schedules', async (req, res, next) => {
  try {
    const rows = await db.prepare(`
      SELECT s.*, tech.name AS technician_name
      FROM maintenance_schedules s LEFT JOIN technicians tech ON tech.id = s.assigned_technician_id
      WHERE s.tool_id = ? ORDER BY s.next_due_date
    `).all(req.params.id);
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/tools/:id/logs
router.get('/:id/logs', async (req, res, next) => {
  try {
    const rows = await db.prepare(`
      SELECT l.*, tech.name AS technician_name
      FROM maintenance_logs l LEFT JOIN technicians tech ON tech.id = l.technician_id
      WHERE l.tool_id = ? ORDER BY l.performed_date DESC
    `).all(req.params.id);
    res.json(rows);
  } catch (err) { next(err); }
});

/* ============================ Importar desde Excel ============================ */

const CATEGORY_ALIASES = {
  fixture: 'fixture', gancho: 'gancho', tooling: 'tooling',
  manipulador: 'tooling', maquina: 'tooling', 'máquina': 'tooling',
  herramienta: 'gancho', proceso: 'tooling', equipo: 'tooling'
};

function normHeader(h) {
  return String(h || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function mapImportRow(row, lineByName, techByName) {
  const get = (...keys) => {
    for (const k of Object.keys(row)) {
      if (keys.includes(normHeader(k))) return row[k];
    }
    return undefined;
  };
  const code = get('no. de parte', 'no de parte', 'numero de parte', 'codigo', 'code');
  const name = get('descripcion', 'nombre', 'name');
  const categoryRaw = normHeader(get('categoria', 'tipo', 'category') || 'tooling');
  const lineName = get('linea', 'line');
  const freqDays = get('frecuencia (dias)', 'frecuencia', 'frequency_days');
  const techName = get('tecnico asignado', 'tecnico', 'technician');
  const cost = get('costo aproximado (usd)', 'costo', 'cost');
  const location = get('ubicacion', 'location');
  const statusRaw = normHeader(get('estado', 'status') || 'activo');

  const line = lineName ? lineByName.get(normHeader(lineName)) : null;
  const tech = techName ? techByName.get(normHeader(techName)) : null;

  return {
    code: code ? String(code).trim() : '',
    name: name ? String(name).trim() : '',
    category: CATEGORY_ALIASES[categoryRaw] || 'tooling',
    assembly_line_id: line ? line.id : null,
    frequency_days: freqDays ? Number(freqDays) : null,
    technician_id: tech ? tech.id : null,
    cost: cost !== undefined && cost !== '' ? Number(cost) : null,
    location: location ? String(location).trim() : null,
    status: VALID_STATUS.includes(statusRaw) ? statusRaw : 'activo'
  };
}

// POST /api/tools/import (solo admin) -- multipart/form-data, campo "file"
// Da de alta en lote herramientas/fixtures/ganchos desde un Excel, y si la
// fila trae frecuencia crea también su primera programación de mantenimiento.
router.post('/import', requireRole('admin'), (req, res, next) => {
  uploadExcel.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message || 'No se pudo leer el archivo' });
      if (!req.file) return res.status(400).json({ error: 'Adjunta un archivo .xlsx, .xls o .csv' });

      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      if (!rows.length) return res.status(400).json({ error: 'El archivo no tiene filas de datos.' });

      const [lines, technicians] = await Promise.all([
        db.prepare('SELECT * FROM assembly_lines').all(),
        db.prepare('SELECT * FROM technicians').all()
      ]);
      const lineByName = new Map(lines.map(l => [normHeader(l.name), l]));
      const techByName = new Map(technicians.map(t => [normHeader(t.name), t]));

      const created = [];
      const errors = [];
      const today = new Date().toISOString().slice(0, 10);

      for (let i = 0; i < rows.length; i++) {
        const mapped = mapImportRow(rows[i], lineByName, techByName);
        if (!mapped.code || !mapped.name) {
          errors.push({ row: i + 2, error: 'Falta No. de Parte o Descripción' });
          continue;
        }
        const dup = await db.prepare('SELECT id FROM tools WHERE code = ?').get(mapped.code);
        if (dup) {
          errors.push({ row: i + 2, error: `Ya existe una herramienta con el código ${mapped.code}` });
          continue;
        }
        const info = await db.prepare(`
          INSERT INTO tools (code, name, category, location, assembly_line_id, status, cost)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(mapped.code, mapped.name, mapped.category, mapped.location, mapped.assembly_line_id, mapped.status, mapped.cost);

        if (mapped.frequency_days && mapped.frequency_days > 0) {
          const due = new Date(); due.setDate(due.getDate() + mapped.frequency_days);
          await db.prepare(`
            INSERT INTO maintenance_schedules (tool_id, maintenance_type, frequency_days, assigned_technician_id, last_done_date, next_due_date)
            VALUES (?, 'Mantenimiento preventivo', ?, ?, ?, ?)
          `).run(info.lastInsertRowid, mapped.frequency_days, mapped.technician_id, today, due.toISOString().slice(0, 10));
        }
        created.push(mapped.code);
      }

      res.status(201).json({ created: created.length, errors, created_codes: created });
    } catch (err2) { next(err2); }
  });
});

module.exports = router;
