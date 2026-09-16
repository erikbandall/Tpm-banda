// Autenticación por sesión (cookie httpOnly + JWT) y permisos por rol.
//
// Roles: admin (control total), ingeniero (lectura + indicadores/acciones
// correctivas), tecnico (lectura + solo puede registrar mantenimientos
// bajo su propio nombre / de sus programaciones asignadas).

const jwt = require('jsonwebtoken');
const db = require('../db/database');

const COOKIE_NAME = 'token';
const isProd = process.env.NODE_ENV === 'production';

if (!process.env.JWT_SECRET) {
  console.warn(
    '[auth] JWT_SECRET no está definido -- usando un valor por defecto SOLO apto para desarrollo local. ' +
    'Define JWT_SECRET como variable de entorno antes de usar esto en producción/Vercel.'
  );
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-insecure-secret-change-me';

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, technician_id: user.technician_id },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: isProd, sameSite: 'lax' });
}

// Verifica el JWT y, además, vuelve a consultar la cuenta en la base de
// datos (para que una cuenta desactivada por el admin deje de funcionar de
// inmediato, aunque su token todavía no haya expirado).
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies && req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Debes iniciar sesión.' });

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch (err) {
      return res.status(401).json({ error: 'Tu sesión expiró o no es válida. Inicia sesión de nuevo.' });
    }

    const user = await db.prepare('SELECT id, username, role, technician_id, active FROM users WHERE id = ?').get(payload.id);
    if (!user || !user.active) return res.status(401).json({ error: 'Tu cuenta ya no tiene acceso. Contacta al administrador.' });

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Debes iniciar sesión.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'No tienes permiso para realizar esta acción.' });
    }
    next();
  };
}

module.exports = { signToken, setAuthCookie, clearAuthCookie, requireAuth, requireRole, COOKIE_NAME };
