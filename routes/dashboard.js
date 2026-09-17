const express = require('express');
const db = require('../db/database');

const router = express.Router();

function today() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

// GET /api/dashboard/summary?assembly_line_id=&assigned_technician_id=
router.get('/summary', async (req, res, next) => {
  try {
    const { assembly_line_id, assigned_technician_id } = req.query;
    const t0 = today();

    const toolClauses = [];
    const toolParams = [];
    if (assembly_line_id) { toolClauses.push('assembly_line_id = ?'); toolParams.push(assembly_line_id); }
    const toolWhere = toolClauses.length ? ' WHERE ' + toolClauses.join(' AND ') : '';

    const toolCounts = await db.prepare(`SELECT status, COUNT(*) AS n FROM tools${toolWhere} GROUP BY status`).all(...toolParams);
    const totalTools = (await db.prepare(`SELECT COUNT(*) AS n FROM tools${toolWhere}`).get(...toolParams)).n;

    const schedClauses = ['s.active = 1'];
    const schedParams = [];
    if (assembly_line_id) { schedClauses.push('t.assembly_line_id = ?'); schedParams.push(assembly_line_id); }
    if (assigned_technician_id) { schedClauses.push('s.assigned_technician_id = ?'); schedParams.push(assigned_technician_id); }
    const schedWhereBase = schedClauses.join(' AND ');

    const overdue = await db.prepare(`
      SELECT s.*, t.code AS tool_code, t.name AS tool_name, l.name AS line_name, tech.name AS technician_name
      FROM maintenance_schedules s JOIN tools t ON t.id = s.tool_id
      LEFT JOIN assembly_lines l ON l.id = t.assembly_line_id
      LEFT JOIN technicians tech ON tech.id = s.assigned_technician_id
      WHERE ${schedWhereBase} AND s.next_due_date < ?
      ORDER BY s.next_due_date
    `).all(...schedParams, t0);

    const upcoming = await db.prepare(`
      SELECT s.*, t.code AS tool_code, t.name AS tool_name, l.name AS line_name, tech.name AS technician_name
      FROM maintenance_schedules s JOIN tools t ON t.id = s.tool_id
      LEFT JOIN assembly_lines l ON l.id = t.assembly_line_id
      LEFT JOIN technicians tech ON tech.id = s.assigned_technician_id
      WHERE ${schedWhereBase} AND s.next_due_date >= ? AND julianday(s.next_due_date) - julianday(?) <= s.alert_days_before
      ORDER BY s.next_due_date
    `).all(...schedParams, t0, t0);

    const logClauses = [];
    const logParams = [];
    if (assembly_line_id) { logClauses.push('t.assembly_line_id = ?'); logParams.push(assembly_line_id); }
    if (assigned_technician_id) { logClauses.push('l.technician_id = ?'); logParams.push(assigned_technician_id); }
    const logWhere = logClauses.length ? ' WHERE ' + logClauses.join(' AND ') : '';

    const recentLogs = await db.prepare(`
      SELECT l.*, t.code AS tool_code, t.name AS tool_name, tech.name AS technician_name
      FROM maintenance_logs l JOIN tools t ON t.id = l.tool_id
      LEFT JOIN technicians tech ON tech.id = l.technician_id
      ${logWhere}
      ORDER BY l.performed_date DESC, l.id DESC LIMIT 10
    `).all(...logParams);

    const horizon90 = addDays(t0, -90);
    const complianceRow = await db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN l.on_time = 1 THEN 1 ELSE 0 END) AS on_time
      FROM maintenance_logs l JOIN tools t ON t.id = l.tool_id
      WHERE l.schedule_id IS NOT NULL AND l.performed_date >= ?${logClauses.length ? ' AND ' + logClauses.join(' AND ') : ''}
    `).get(horizon90, ...logParams);
    const compliance = complianceRow.total > 0 ? Math.round((complianceRow.on_time / complianceRow.total) * 100) : null;

    const unreadNotifications = (await db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE read = 0').get()).n;

    const costRow = await db.prepare(`SELECT SUM(cost) AS total_cost FROM tools${toolWhere}${toolWhere ? ' AND' : ' WHERE'} status != 'baja'`).get(...toolParams);

    res.json({
      total_tools: totalTools,
      tool_counts: toolCounts.reduce((acc, r) => ({ ...acc, [r.status]: r.n }), {}),
      overdue_count: overdue.length,
      upcoming_count: upcoming.length,
      overdue,
      upcoming,
      recent_logs: recentLogs,
      compliance_pct: compliance,
      compliance_sample: complianceRow.total,
      unread_notifications: unreadNotifications,
      total_cost: costRow.total_cost || 0
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/by-line
router.get('/by-line', async (req, res, next) => {
  try {
    const t0 = today();
    const monthStart = t0.slice(0, 7) + '-01';
    const [y, m] = t0.slice(0, 7).split('-').map(Number);
    const monthEnd = new Date(y, m, 0).toISOString().slice(0, 10);

    const lines = await db.prepare('SELECT * FROM assembly_lines ORDER BY name COLLATE NOCASE').all();
    const completedThisMonth = await db.prepare(`
      SELECT schedule_id, COUNT(*) AS n FROM maintenance_logs
      WHERE schedule_id IS NOT NULL AND performed_date >= ? AND performed_date <= ?
      GROUP BY schedule_id
    `).all(monthStart, monthEnd);
    const completedMap = new Map(completedThisMonth.map(r => [r.schedule_id, r.n]));

    const rows = [];
    for (const line of lines) {
      const schedules = await db.prepare(`
        SELECT s.id, s.next_due_date, s.alert_days_before FROM maintenance_schedules s
        JOIN tools t ON t.id = s.tool_id
        WHERE t.assembly_line_id = ? AND s.active = 1
      `).all(line.id);

      let overdue = 0, upcoming = 0, ok = 0, requiredMonth = 0, completedMonth = 0;
      schedules.forEach(s => {
        if (s.next_due_date < t0) overdue++;
        else if ((new Date(s.next_due_date) - new Date(t0)) / 86400000 <= s.alert_days_before) upcoming++;
        else ok++;

        const done = completedMap.get(s.id) || 0;
        const outstanding = s.next_due_date <= monthEnd ? 1 : 0;
        requiredMonth += done + outstanding;
        completedMonth += done;
      });

      rows.push({
        line_id: line.id, line_name: line.name, overdue, upcoming, ok, total: schedules.length,
        required_month: requiredMonth, completed_month: completedMonth
      });
    }

    const unassignedTools = (await db.prepare('SELECT COUNT(*) AS n FROM tools WHERE assembly_line_id IS NULL').get()).n;

    res.json({ lines: rows, unassigned_tools: unassignedTools, month_start: monthStart, month_end: monthEnd });
  } catch (err) { next(err); }
});

// GET /api/dashboard/by-category
router.get('/by-category', async (req, res, next) => {
  try {
    const CATEGORY_LABELS = { fixture: 'Fixture', gancho: 'Gancho', tooling: 'Tooling' };
    const CATEGORIES = ['fixture', 'gancho', 'tooling'];

    const t0 = today();
    const monthStart = t0.slice(0, 7) + '-01';
    const [y, m] = t0.slice(0, 7).split('-').map(Number);
    const monthEnd = new Date(y, m, 0).toISOString().slice(0, 10);

    const completedThisMonth = await db.prepare(`
      SELECT schedule_id, COUNT(*) AS n FROM maintenance_logs
      WHERE schedule_id IS NOT NULL AND performed_date >= ? AND performed_date <= ?
      GROUP BY schedule_id
    `).all(monthStart, monthEnd);
    const completedMap = new Map(completedThisMonth.map(r => [r.schedule_id, r.n]));

    const rows = [];
    for (const category of CATEGORIES) {
      const schedules = await db.prepare(`
        SELECT s.id, s.next_due_date FROM maintenance_schedules s
        JOIN tools t ON t.id = s.tool_id
        WHERE t.category = ? AND s.active = 1
      `).all(category);

      let requiredMonth = 0, completedMonth = 0;
      schedules.forEach(s => {
        const done = completedMap.get(s.id) || 0;
        const outstanding = s.next_due_date <= monthEnd ? 1 : 0;
        requiredMonth += done + outstanding;
        completedMonth += done;
      });

      rows.push({
        category, category_label: CATEGORY_LABELS[category],
        total: schedules.length, required_month: requiredMonth, completed_month: completedMonth
      });
    }

    res.json({ categories: rows, month_start: monthStart, month_end: monthEnd });
  } catch (err) { next(err); }
});

// GET /api/dashboard/by-technician
router.get('/by-technician', async (req, res, next) => {
  try {
    const horizon90 = addDays(today(), -90);

    const rows = await db.prepare(`
      SELECT tech.id AS technician_id, tech.name AS technician_name,
        COUNT(l.id) AS total,
        SUM(CASE WHEN l.on_time IS NOT NULL THEN 1 ELSE 0 END) AS on_time_applicable,
        SUM(CASE WHEN l.on_time = 1 THEN 1 ELSE 0 END) AS on_time
      FROM maintenance_logs l
      JOIN technicians tech ON tech.id = l.technician_id
      WHERE l.performed_date >= ?
      GROUP BY tech.id, tech.name
      ORDER BY total DESC
    `).all(horizon90);

    const technicians = rows.map(r => ({
      ...r,
      pct_on_time: r.on_time_applicable > 0 ? Math.round((r.on_time / r.on_time_applicable) * 100) : null
    }));

    res.json({ technicians, since: horizon90 });
  } catch (err) { next(err); }
});

// GET /api/dashboard/trend
router.get('/trend', async (req, res, next) => {
  try {
    const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const now = new Date();
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const rows = await db.prepare(`
      SELECT substr(performed_date, 1, 7) AS month, COUNT(*) AS total,
        SUM(CASE WHEN on_time IS NOT NULL THEN 1 ELSE 0 END) AS on_time_applicable,
        SUM(CASE WHEN on_time = 1 THEN 1 ELSE 0 END) AS on_time
      FROM maintenance_logs
      WHERE performed_date >= ?
      GROUP BY month
    `).all(months[0] + '-01');
    const map = new Map(rows.map(r => [r.month, r]));

    const trend = months.map(monthKey => {
      const r = map.get(monthKey) || { total: 0, on_time_applicable: 0, on_time: 0 };
      const [y, m] = monthKey.split('-').map(Number);
      return {
        month: monthKey,
        label: `${MONTH_LABELS[m - 1]} ${y}`,
        total: r.total,
        on_time: r.on_time,
        pct_on_time: r.on_time_applicable > 0 ? Math.round((r.on_time / r.on_time_applicable) * 100) : null
      };
    });

    res.json({ trend });
  } catch (err) { next(err); }
});

// GET /api/dashboard/by-cost -- costo del herramental por línea y por categoría
router.get('/by-cost', async (req, res, next) => {
  try {
    const byLine = await db.prepare(`
      SELECT l.id AS line_id, l.name AS line_name, SUM(t.cost) AS total_cost, COUNT(t.id) AS n
      FROM assembly_lines l LEFT JOIN tools t ON t.assembly_line_id = l.id AND t.status != 'baja'
      GROUP BY l.id, l.name ORDER BY l.name COLLATE NOCASE
    `).all();
    const byCategory = await db.prepare(`
      SELECT category, SUM(cost) AS total_cost, COUNT(*) AS n
      FROM tools WHERE status != 'baja' GROUP BY category
    `).all();
    res.json({ by_line: byLine, by_category: byCategory });
  } catch (err) { next(err); }
});

module.exports = router;
