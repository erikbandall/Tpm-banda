// Endpoint disparado por un Cron Job de Vercel (ver vercel.json) para mandar
// por correo, a cada técnico, el resumen de sus mantenimientos vencidos y
// próximos a vencer. No requiere sesión (Vercel Cron no inicia sesión como
// usuario) -- se protege con CRON_SECRET en su lugar.

const express = require('express');
const db = require('../db/database');
const { sendEmail } = require('../lib/email');
const { syncNotifications } = require('./notifications');

const router = express.Router();

function today() {
  return new Date().toISOString().slice(0, 10);
}

function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[cron] CRON_SECRET no está definido -- el endpoint de notificaciones por correo queda sin protección.');
    return next();
  }
  if (req.headers.authorization === `Bearer ${secret}`) return next();
  return res.status(401).json({ error: 'No autorizado' });
}

function itemsTableHtml(list, label) {
  if (!list.length) return '';
  return `
    <h3 style="font-size:14px;margin:16px 0 6px;">${label}</h3>
    <table style="border-collapse:collapse;width:100%;font-size:13px;">
      <tr style="text-align:left;color:#555;">
        <th style="padding:4px 8px;">Código</th><th style="padding:4px 8px;">Nombre</th>
        <th style="padding:4px 8px;">Tipo</th><th style="padding:4px 8px;">Fecha</th>
      </tr>
      ${list.map(i => `
        <tr>
          <td style="padding:4px 8px;border-top:1px solid #eee;">${i.tool_code}</td>
          <td style="padding:4px 8px;border-top:1px solid #eee;">${i.tool_name}</td>
          <td style="padding:4px 8px;border-top:1px solid #eee;">${i.maintenance_type}</td>
          <td style="padding:4px 8px;border-top:1px solid #eee;">${i.next_due_date}</td>
        </tr>`).join('')}
    </table>`;
}

// GET /api/cron/notify-due
router.get('/notify-due', requireCronSecret, async (req, res, next) => {
  try {
    await syncNotifications();
    const t0 = today();

    const rows = await db.prepare(`
      SELECT s.id AS schedule_id, s.maintenance_type, s.next_due_date, s.assigned_technician_id,
             t.code AS tool_code, t.name AS tool_name, tech.name AS technician_name, tech.email AS technician_email,
             CASE WHEN s.next_due_date < ? THEN 'overdue' ELSE 'upcoming' END AS status
      FROM maintenance_schedules s
      JOIN tools t ON t.id = s.tool_id
      LEFT JOIN technicians tech ON tech.id = s.assigned_technician_id
      WHERE s.active = 1 AND tech.email IS NOT NULL AND tech.email != ''
        AND (s.next_due_date < ? OR julianday(s.next_due_date) - julianday(?) <= s.alert_days_before)
      ORDER BY s.assigned_technician_id, status DESC, s.next_due_date
    `).all(t0, t0, t0);

    const byTech = new Map();
    for (const r of rows) {
      if (!byTech.has(r.assigned_technician_id)) {
        byTech.set(r.assigned_technician_id, { name: r.technician_name, email: r.technician_email, items: [] });
      }
      byTech.get(r.assigned_technician_id).items.push(r);
    }

    let sent = 0;
    const errors = [];
    for (const [, tech] of byTech) {
      const overdue = tech.items.filter(i => i.status === 'overdue');
      const upcoming = tech.items.filter(i => i.status === 'upcoming');
      const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
          <h2 style="font-size:16px;">Hola ${tech.name || ''},</h2>
          <p style="font-size:13px;color:#444;">Este es tu resumen de mantenimiento preventivo pendiente en TOOLMAINT.</p>
          ${itemsTableHtml(overdue, '⚠️ Vencidos')}
          ${itemsTableHtml(upcoming, '⏰ Próximos a vencer')}
        </div>`;

      try {
        await sendEmail({
          to: tech.email,
          subject: `TOOLMAINT — ${overdue.length} vencido(s), ${upcoming.length} próximo(s) a vencer`,
          html
        });
        sent++;
      } catch (err) {
        errors.push({ technician: tech.name, error: err.message });
      }
    }

    res.json({ technicians_notified: sent, errors });
  } catch (err) { next(err); }
});

module.exports = router;
