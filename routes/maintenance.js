const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db/database');
const { requireRole } = require('../middleware/auth');

const router = express.Router();

const UPLOADS_DIR = process.env.VERCEL ? '/tmp/uploads' : path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const EVIDENCE_EXT_BY_MIME = {
  'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}${EVIDENCE_EXT_BY_MIME[file.mimetype] || ''}`)
  }),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    if (!EVIDENCE_EXT_BY_MIME[file.mimetype]) return cb(new Error('Solo se admiten archivos PDF, JPG, PNG o WEBP'));
    cb(null, true);
  }
});

const VALID_SHIFT = ['Turno 1', 'Turno 2', 'Turno 3'];

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Solo el admin o el propio técnico dueño del registro pueden tocarlo.
function canTouchLog(req, log) {
  if (req.user.role === 'admin') return true;
  return req.user.role === 'tecnico' && req.user.technician_id && String(log.technician_id) === String(req.user.technician_id);
}

const SCHEDULE_JOIN = `
  SELECT s.*, t.code AS tool_code, t.name AS tool_name, t.status AS tool_status, t.category AS tool_category,
         l.name AS line_name, tech.name AS technician_name
  FROM maintenance_schedules s
  JOIN tools t ON t.id = s.tool_id
  LEFT JOIN assembly_lines l ON l.id = t.assembly_line_id
  LEFT JOIN technicians tech ON tech.id = s.assigned_technician_id
`;

/* ---------------------------- Schedules ---------------------------- */

// GET /api/maintenance/schedules?tool_id=&active=&due=(overdue|upcoming)&assembly_line_id=&assigned_technician_id=
router.get('/schedules', async (req, res, next) => {
  try {
    const { tool_id, active, due, assembly_line_id, assigned_technician_id } = req.query;
    let sql = SCHEDULE_JOIN;
    const clauses = [];
    const params = [];

    if (tool_id) { clauses.push('s.tool_id = ?'); params.push(tool_id); }
    if (assembly_line_id) { clauses.push('t.assembly_line_id = ?'); params.push(assembly_line_id); }
    if (assigned_technician_id) { clauses.push('s.assigned_technician_id = ?'); params.push(assigned_technician_id); }
    if (active !== undefined) { clauses.push('s.active = ?'); params.push(active === 'true' || active === '1' ? 1 : 0); }
    if (due === 'overdue') { clauses.push('s.active = 1 AND s.next_due_date < ?'); params.push(today()); }
    if (due === 'upcoming') {
      clauses.push('s.active = 1 AND s.next_due_date >= ? AND julianday(s.next_due_date) - julianday(?) <= s.alert_days_before');
      params.push(today(), today());
    }

    if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
    sql += ' ORDER BY s.next_due_date';

    res.json(await db.prepare(sql).all(...params));
  } catch (err) { next(err); }
});

// GET /api/maintenance/schedules/:id
router.get('/schedules/:id', async (req, res, next) => {
  try {
    const row = await db.prepare(`${SCHEDULE_JOIN} WHERE s.id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Programación no encontrada' });
    row.checklist = await db.prepare('SELECT * FROM checklist_items WHERE schedule_id = ? ORDER BY sort_order, id').all(req.params.id);
    res.json(row);
  } catch (err) { next(err); }
});

function validateShift(shift) {
  if (shift && !VALID_SHIFT.includes(shift)) return `Turno inválido. Usa: ${VALID_SHIFT.join(', ')}`;
  return null;
}

// POST /api/maintenance/schedules (solo admin)
router.post('/schedules', requireRole('admin'), async (req, res, next) => {
  try {
    const {
      tool_id, maintenance_type, frequency_days, assigned_technician_id, shift, alert_days_before,
      last_done_date, next_due_date, notes, checklist
    } = req.body;

    if (!tool_id) return res.status(400).json({ error: 'tool_id es obligatorio' });
    if (!maintenance_type || !String(maintenance_type).trim()) {
      return res.status(400).json({ error: 'maintenance_type es obligatorio' });
    }
    if (!frequency_days || Number(frequency_days) <= 0) {
      return res.status(400).json({ error: 'frequency_days debe ser un número mayor a 0' });
    }
    const shiftErr = validateShift(shift);
    if (shiftErr) return res.status(400).json({ error: shiftErr });

    const tool = await db.prepare('SELECT * FROM tools WHERE id = ?').get(tool_id);
    if (!tool) return res.status(404).json({ error: 'Herramienta no encontrada' });

    if (assigned_technician_id) {
      const tech = await db.prepare('SELECT * FROM technicians WHERE id = ?').get(assigned_technician_id);
      if (!tech) return res.status(404).json({ error: 'Técnico asignado no encontrado' });
    }

    const due = next_due_date || addDays(last_done_date || today(), frequency_days);

    const id = await db.transaction(async (tx) => {
      const info = await tx.prepare(`
        INSERT INTO maintenance_schedules
          (tool_id, maintenance_type, frequency_days, assigned_technician_id, shift, alert_days_before, last_done_date, next_due_date, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tool_id,
        String(maintenance_type).trim(),
        Number(frequency_days),
        assigned_technician_id || null,
        shift || null,
        alert_days_before != null && alert_days_before !== '' ? Number(alert_days_before) : 7,
        last_done_date || null,
        due,
        notes || null
      );
      const scheduleId = info.lastInsertRowid;

      if (Array.isArray(checklist)) {
        const items = checklist.filter(c => c && String(c).trim());
        for (let idx = 0; idx < items.length; idx++) {
          await tx.prepare('INSERT INTO checklist_items (schedule_id, description, sort_order) VALUES (?, ?, ?)')
            .run(scheduleId, String(items[idx]).trim(), idx);
        }
      }
      return scheduleId;
    })();

    const row = await db.prepare(`${SCHEDULE_JOIN} WHERE s.id = ?`).get(id);
    row.checklist = await db.prepare('SELECT * FROM checklist_items WHERE schedule_id = ? ORDER BY sort_order, id').all(id);
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// PUT /api/maintenance/schedules/:id (solo admin)
router.put('/schedules/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await db.prepare('SELECT * FROM maintenance_schedules WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Programación no encontrada' });

    const {
      maintenance_type, frequency_days, assigned_technician_id, shift, alert_days_before,
      last_done_date, next_due_date, active, notes, checklist
    } = req.body;

    const shiftErr = validateShift(shift);
    if (shiftErr) return res.status(400).json({ error: shiftErr });

    if (assigned_technician_id) {
      const tech = await db.prepare('SELECT * FROM technicians WHERE id = ?').get(assigned_technician_id);
      if (!tech) return res.status(404).json({ error: 'Técnico asignado no encontrado' });
    }

    await db.transaction(async (tx) => {
      await tx.prepare(`
        UPDATE maintenance_schedules SET
          maintenance_type = ?, frequency_days = ?, assigned_technician_id = ?, shift = ?, alert_days_before = ?,
          last_done_date = ?, next_due_date = ?, active = ?, notes = ?
        WHERE id = ?
      `).run(
        maintenance_type !== undefined && maintenance_type !== '' ? String(maintenance_type).trim() : existing.maintenance_type,
        frequency_days !== undefined && frequency_days !== '' ? Number(frequency_days) : existing.frequency_days,
        assigned_technician_id !== undefined ? (assigned_technician_id || null) : existing.assigned_technician_id,
        shift !== undefined ? (shift || null) : existing.shift,
        alert_days_before !== undefined && alert_days_before !== '' ? Number(alert_days_before) : existing.alert_days_before,
        last_done_date !== undefined ? (last_done_date || null) : existing.last_done_date,
        next_due_date !== undefined && next_due_date !== '' ? next_due_date : existing.next_due_date,
        active !== undefined ? (active ? 1 : 0) : existing.active,
        notes !== undefined ? notes : existing.notes,
        req.params.id
      );

      if (Array.isArray(checklist)) {
        await tx.prepare('DELETE FROM checklist_items WHERE schedule_id = ?').run(req.params.id);
        const items = checklist.filter(c => c && String(c).trim());
        for (let idx = 0; idx < items.length; idx++) {
          await tx.prepare('INSERT INTO checklist_items (schedule_id, description, sort_order) VALUES (?, ?, ?)')
            .run(req.params.id, String(items[idx]).trim(), idx);
        }
      }
    })();

    const row = await db.prepare(`${SCHEDULE_JOIN} WHERE s.id = ?`).get(req.params.id);
    row.checklist = await db.prepare('SELECT * FROM checklist_items WHERE schedule_id = ? ORDER BY sort_order, id').all(req.params.id);
    res.json(row);
  } catch (err) { next(err); }
});

// DELETE /api/maintenance/schedules/:id (solo admin)
router.delete('/schedules/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await db.prepare('SELECT * FROM maintenance_schedules WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Programación no encontrada' });
    await db.prepare('DELETE FROM maintenance_schedules WHERE id = ?').run(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ------------------------------ Logs -------------------------------- */

const LOG_JOIN = `
  SELECT l.*, t.code AS tool_code, t.name AS tool_name, t.category AS tool_category, tech.name AS technician_name
  FROM maintenance_logs l
  JOIN tools t ON t.id = l.tool_id
  LEFT JOIN technicians tech ON tech.id = l.technician_id
`;

// GET /api/maintenance/logs?tool_id=&limit=
router.get('/logs', async (req, res, next) => {
  try {
    const { tool_id, limit } = req.query;
    let sql = LOG_JOIN;
    const params = [];
    if (tool_id) { sql += ' WHERE l.tool_id = ?'; params.push(tool_id); }
    sql += ' ORDER BY l.performed_date DESC, l.id DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }
    res.json(await db.prepare(sql).all(...params));
  } catch (err) { next(err); }
});

// GET /api/maintenance/logs/:id  (incluye el checklist completado)
router.get('/logs/:id', async (req, res, next) => {
  try {
    const row = await db.prepare(`${LOG_JOIN} WHERE l.id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Registro no encontrado' });
    row.checklist = await db.prepare('SELECT * FROM maintenance_log_checklist WHERE log_id = ? ORDER BY id').all(req.params.id);
    res.json(row);
  } catch (err) { next(err); }
});

// POST /api/maintenance/logs -- "completar" un mantenimiento.
// Un técnico solo puede registrar mantenimientos a su propio nombre, y si
// vienen ligados a una programación (schedule_id), solo si esa programación
// está asignada a él. El administrador puede registrar cualquiera.
router.post('/logs', async (req, res, next) => {
  try {
    if (req.user.role === 'ingeniero') {
      return res.status(403).json({ error: 'Tu rol es de seguimiento; solo un técnico o el administrador pueden completar mantenimientos.' });
    }

    const { tool_id, schedule_id, maintenance_type, shift, performed_date, description, parts_used, checklist } = req.body;
    let { technician_id } = req.body;

    if (req.user.role === 'tecnico') {
      if (!req.user.technician_id) {
        return res.status(403).json({ error: 'Tu cuenta de técnico no está ligada a ningún técnico de manufactura. Pide al administrador que la vincule.' });
      }
      if (technician_id && String(technician_id) !== String(req.user.technician_id)) {
        return res.status(403).json({ error: 'No puedes registrar un mantenimiento a nombre de otro técnico.' });
      }
      technician_id = req.user.technician_id;
    }

    if (!tool_id) return res.status(400).json({ error: 'tool_id es obligatorio' });
    if (!maintenance_type || !String(maintenance_type).trim()) {
      return res.status(400).json({ error: 'maintenance_type es obligatorio' });
    }
    const shiftErr = validateShift(shift);
    if (shiftErr) return res.status(400).json({ error: shiftErr });

    const tool = await db.prepare('SELECT * FROM tools WHERE id = ?').get(tool_id);
    if (!tool) return res.status(404).json({ error: 'Herramienta no encontrada' });

    if (technician_id) {
      const tech = await db.prepare('SELECT * FROM technicians WHERE id = ?').get(technician_id);
      if (!tech) return res.status(404).json({ error: 'Técnico no encontrado' });
    }

    let schedule = null;
    if (schedule_id) {
      schedule = await db.prepare('SELECT * FROM maintenance_schedules WHERE id = ? AND tool_id = ?').get(schedule_id, tool_id);
      if (!schedule) return res.status(404).json({ error: 'Programación no encontrada para esta herramienta' });
      if (req.user.role === 'tecnico' && String(schedule.assigned_technician_id) !== String(req.user.technician_id)) {
        return res.status(403).json({ error: 'Esta programación está asignada a otro técnico.' });
      }
    }

    const doneDate = performed_date || today();
    const onTime = schedule ? (doneDate <= schedule.next_due_date ? 1 : 0) : null;

    const id = await db.transaction(async (tx) => {
      const info = await tx.prepare(`
        INSERT INTO maintenance_logs (tool_id, schedule_id, maintenance_type, technician_id, shift, performed_date, description, parts_used, on_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        tool_id,
        schedule ? schedule.id : null,
        String(maintenance_type).trim(),
        technician_id || null,
        shift || null,
        doneDate,
        description || null,
        parts_used || null,
        onTime
      );
      const logId = info.lastInsertRowid;

      if (Array.isArray(checklist)) {
        for (const item of checklist) {
          if (!item || !item.description) continue;
          await tx.prepare(`
            INSERT INTO maintenance_log_checklist (log_id, checklist_item_id, description, completed, notes)
            VALUES (?, ?, ?, ?, ?)
          `).run(logId, item.checklist_item_id || null, String(item.description).trim(), item.completed ? 1 : 0, item.notes || null);
        }
      }

      if (schedule) {
        const nextDue = addDays(doneDate, schedule.frequency_days);
        await tx.prepare('UPDATE maintenance_schedules SET last_done_date = ?, next_due_date = ? WHERE id = ?').run(doneDate, nextDue, schedule.id);
        await tx.prepare('DELETE FROM notifications WHERE schedule_id = ? AND due_date_snapshot = ?').run(schedule.id, schedule.next_due_date);
      }

      return logId;
    })();

    const row = await db.prepare(`${LOG_JOIN} WHERE l.id = ?`).get(id);
    row.checklist = await db.prepare('SELECT * FROM maintenance_log_checklist WHERE log_id = ? ORDER BY id').all(id);
    res.status(201).json(row);
  } catch (err) { next(err); }
});

// DELETE /api/maintenance/logs/:id (solo admin)
router.delete('/logs/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const existing = await db.prepare('SELECT * FROM maintenance_logs WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Registro no encontrado' });
    if (existing.evidence_filename) fs.unlink(path.join(UPLOADS_DIR, existing.evidence_filename), () => {});
    await db.prepare('DELETE FROM maintenance_logs WHERE id = ?').run(req.params.id);
    res.status(204).end();
  } catch (err) { next(err); }
});

/* -------------------- Evidencia/foto del checklist -------------------- */

// POST /api/maintenance/logs/:id/evidence -- admin o el técnico dueño del registro
router.post('/logs/:id/evidence', (req, res, next) => {
  upload.single('evidence')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message || 'No se pudo subir el archivo' });

      const log = await db.prepare('SELECT * FROM maintenance_logs WHERE id = ?').get(req.params.id);
      if (!log) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(404).json({ error: 'Registro no encontrado' });
      }
      if (!canTouchLog(req, log)) {
        if (req.file) fs.unlink(req.file.path, () => {});
        return res.status(403).json({ error: 'No puedes modificar este registro.' });
      }
      if (!req.file) return res.status(400).json({ error: 'Adjunta un archivo PDF o una foto' });

      if (log.evidence_filename) fs.unlink(path.join(UPLOADS_DIR, log.evidence_filename), () => {});

      await db.prepare('UPDATE maintenance_logs SET evidence_filename = ?, evidence_original_name = ? WHERE id = ?')
        .run(req.file.filename, req.file.originalname, req.params.id);

      res.status(201).json(await db.prepare(`
        SELECT l.*, t.code AS tool_code, t.name AS tool_name, tech.name AS technician_name
        FROM maintenance_logs l JOIN tools t ON t.id = l.tool_id
        LEFT JOIN technicians tech ON tech.id = l.technician_id
        WHERE l.id = ?
      `).get(req.params.id));
    } catch (err2) { next(err2); }
  });
});

const CONTENT_TYPE_BY_EXT = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp'
};

// GET /api/maintenance/logs/:id/evidence -- ver/descargar el PDF o foto adjunta
router.get('/logs/:id/evidence', async (req, res, next) => {
  try {
    const log = await db.prepare('SELECT * FROM maintenance_logs WHERE id = ?').get(req.params.id);
    if (!log || !log.evidence_filename) return res.status(404).json({ error: 'Sin evidencia adjunta' });
    const filePath = path.join(UPLOADS_DIR, log.evidence_filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'El archivo ya no está disponible' });
    const ext = path.extname(log.evidence_filename).toLowerCase();
    res.setHeader('Content-Type', CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${(log.evidence_original_name || `evidencia${ext}`).replace(/"/g, '')}"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err) { next(err); }
});

// DELETE /api/maintenance/logs/:id/evidence -- admin o el técnico dueño del registro
router.delete('/logs/:id/evidence', async (req, res, next) => {
  try {
    const log = await db.prepare('SELECT * FROM maintenance_logs WHERE id = ?').get(req.params.id);
    if (!log) return res.status(404).json({ error: 'Registro no encontrado' });
    if (!canTouchLog(req, log)) return res.status(403).json({ error: 'No puedes modificar este registro.' });
    if (log.evidence_filename) {
      fs.unlink(path.join(UPLOADS_DIR, log.evidence_filename), () => {});
      await db.prepare('UPDATE maintenance_logs SET evidence_filename = NULL, evidence_original_name = NULL WHERE id = ?').run(req.params.id);
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

module.exports = router;
