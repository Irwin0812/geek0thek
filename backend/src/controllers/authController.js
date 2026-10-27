const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query } = require('../config/db');

function publicUser(row) {
  return {
    id: row.id,
    login: row.login,
    role: row.role,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    bio: row.bio,
    isPublic: row.is_public,
    isActive: Boolean(row.is_active !== false),
    // Langue préférée (code ISO 639-1) : « fr » en dépit de toute valeur NULL
    // résiduelle (la colonne est NOT NULL DEFAULT 'fr' depuis la migration).
    language: row.language || 'fr',
    avatarUrl: row.avatar_url || null,
    gender: row.gender || null,
    birthDate: row.birth_date || null,
    address: row.address || null,
    country: row.country || null,
    createdAt: row.created_at,
  };
}

/**
 * POST /api/auth/login
 * Authentification par login (+ mot de passe bcrypt) -> JWT.
 */
async function login(req, res, next) {
  try {
    const { login: loginOrEmail, password } = req.body || {};
    if (!loginOrEmail || !password) {
      return res.status(400).json({ error: 'Login et mot de passe requis.' });
    }
    const { rows } = await query('SELECT * FROM users WHERE login = $1 OR email = $1', [
      String(loginOrEmail).trim(),
    ]);
    const user = rows[0];
    if (user && user.is_active === false) {
      return res.status(401).json({ error: 'Compte désactivé. Contactez un administrateur.' });
    }
    const valid = user ? await bcrypt.compare(String(password), user.password_hash) : false;
    if (!valid) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }
    const token = jwt.sign({ sub: user.id, role: user.role }, env.jwt.secret, {
      expiresIn: env.jwt.expiresIn,
      issuer: 'geek0thek',
    });
    return res.json({ token, user: publicUser(user) });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/auth/me
 * Profil de l'utilisateur connecté (membre du middleware authenticate).
 */
function me(req, res) {
  return res.json({ user: publicUser(req.user) });
}

module.exports = { login, me };
