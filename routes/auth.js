const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { signToken, setAuthCookie, clearAuthCookie, requireAuth } = require('../middleware/auth');

const router = express.Router();

function publicUser(u) {
  return { id: u.id, username: u.username, role: u.role, technician_id: u.technician_id };
}

// POST /api/auth/login  { username, password }
router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña son obligatorios.' });

    const user = await db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
    if (!user || !user.active) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });

    const token = signToken(user);
    setAuthCookie(res, token);
    res.json(publicUser(user));
  } catch (err) { next(err); }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me -- para que el frontend sepa si hay sesión activa al cargar
router.get('/me', requireAuth, (req, res) => {
  res.json(publicUser(req.user));
});

module.exports = router;
