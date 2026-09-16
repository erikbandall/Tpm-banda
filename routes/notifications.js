const express = require('express');
const db = require('../db/database');

const router = express.Router();

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Genera notificaciones nuevas para programaciones vencidas o próximas a vencer
// (dentro de su alert_days_before) que todavía no tienen una notificación para
// ese ciclo (schedule_id + type + due_date_snapshot es único).
async function syncNotifications() {
  const t0 = today();

  const overdue = await db.prepare(`
    SELECT s.id AS schedule_id, s.tool_id, s.maintenance_type, s.next_due_date, t.code AS tool_code, t.name AS tool_name
    FROM maintenance_schedules s JOIN tools t ON t.id = s.tool_id
    WHERE s.active = 1 AND s.next_due_date < ?
  `).all(t0);

  const upcoming = await db.prepare(`
    SELECT s.id AS schedule_id, s.tool_id, s.maintenance_type, s.next_due_date, t.code AS tool_code, t.name AS tool_name
    FROM maintenance_schedules s JOIN tools t ON t.id = s.tool_id
    WHERE s.active = 1 AND s.next_due_date >= ? AND julianday(s.next_due_date) - julianday(?) <= s.alert_days_before
  `).all(t0, t0);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO notifications (schedule_id, tool_id, type, due_date_snapshot, message)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const r of overdue) {
    const msg = `${r.tool_code} — ${r.tool_name}: ${r.maintenance_type} vencido el (${r.next_due_date})`;
    await insert.run(r.schedule_id, r.tool_id, 'overdue', r.next_due_date, msg);
  }
  for (const r of upcoming) {
    const msg = `${r.tool_code} — ${r.tool_name}: ${r.maintenance_type} vence el (${r.next_due_date})`;
    await insert.run(r.schedule_id, r.tool_id, 'upcoming', r.next_due_date, msg);
  }
}

// GET /api/notifications?unread=true&limit=
router.get('/', async (req, res, next) => {
  try {
    await syncNotifications();
    const { unread, limit } = req.query;
    let sql = `
      SELECT n.*, t.code AS tool_code, t.name AS tool_name
      FROM notifications n LEFT JOIN tools t ON t.id = n.tool_id
    `;
    const params = [];
    if (unread === 'true' || unread === '1') sql += ' WHERE n.read = 0';
    sql += ' ORDER BY n.type = \'overdue\' DESC, n.due_date_snapshot ASC, n.created_at DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }
    res.json(await db.prepare(sql).all(...params));
  } catch (err) { next(err); }
});

// GET /api/notifications/count
router.get('/count', async (req, res, next) => {
  try {
    await syncNotifications();
    const row = await db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read = 0').get();
    res.json({ unread: row.n });
  } catch (err) { next(err); }
});

// POST /api/notifications/:id/read
router.post('/:id/read', async (req, res, next) => {
  try {
    const existing = await db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Notificación no encontrada' });
    await db.prepare('UPDATE notifications SET read = 1 WHERE id = ?').run(req.params.id);
    res.json(await db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id));
  } catch (err) { next(err); }
});

// POST /api/notifications/read-all
router.post('/read-all', async (req, res, next) => {
  try {
    await db.prepare('UPDATE notifications SET read = 1 WHERE read = 0').run();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
