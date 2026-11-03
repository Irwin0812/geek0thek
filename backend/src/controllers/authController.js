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
    // Sécurité à la première connexion : TRUE tant que le compte n'a pas
    // changé ses identifiants de première installation (onboarding forcé).
    mustChangePassword: row.must_change_password === true,
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

const LOGIN_RE = /^[a-zA-Z0-9._-]{2,80}$/;

/**
 * POST /api/auth/onboarding
 * Sécurité à la première connexion : appelé UNIQUEMENT quand le compte
 * courant porte le drapeau must_change_password = TRUE (identifiants de
 * première installation non encore changés — admin seedé « Admin »/« Admin »
 * ou compte créé via l'API). Impose :
 *   - un NOUVEAU mot de passe OBLIGATOIRE (min. 8 caractères, différent du
 *     mot de passe courant) — la double saisie est vérifiée côté client ;
 *   - un pseudo de login personnalisable (facultatif : si absent ou vide,
 *     le login courant est conservé).
 * Valide le mot de passe ACTUEL (celui de première installation), met à jour
 * la base (login + password_hash) et remet must_change_password = FALSE.
 * Renvoie un NOUVEAU JWT (le payload ne change pas mais on repart d'un jeton
 * propre) + le profil mis à jour : le frontend renouvelle sa session.
 */
async function onboarding(req, res, next) {
  try {
    const { currentPassword, newPassword, login: newLogin } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir au moins 8 caractères.' });
    }

    const { rows } = await query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'Compte introuvable.' });
    if (user.must_change_password !== true) {
      // Déjà onbordé : rien à faire (idempotent, ex. double soumission).
      return res.json({ token: null, user: publicUser(user) });
    }

    // Le mot de passe de première installation doit être fourni et correct.
    if (!currentPassword || !(await bcrypt.compare(String(currentPassword), user.password_hash))) {
      return res.status(401).json({ error: 'Mot de passe actuel incorrect.' });
    }
    if (String(newPassword) === String(currentPassword)) {
      return res.status(400).json({ error: 'Le nouveau mot de passe doit être différent du mot de passe actuel.' });
    }

    // Pseudo de login personnalisable : facultatif, validé si fourni.
    let nextLogin = user.login;
    if (newLogin !== undefined && newLogin !== null && String(newLogin).trim() !== '') {
      nextLogin = String(newLogin).trim();
      if (!LOGIN_RE.test(nextLogin)) {
        return res.status(400).json({
          error: 'Identifiant invalide (2 à 80 caractères : lettres, chiffres, point, tiret, underscore).',
        });
      }
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    try {
      const { rows: updated } = await query(
        `UPDATE users SET login = $1, password_hash = $2, must_change_password = FALSE
         WHERE id = $3 RETURNING *`,
        [nextLogin, passwordHash, user.id]
      );
      if (!updated[0]) return res.status(404).json({ error: 'Compte introuvable.' });

      const token = jwt.sign({ sub: updated[0].id, role: updated[0].role }, env.jwt.secret, {
        expiresIn: env.jwt.expiresIn,
        issuer: 'geek0thek',
      });
      return res.json({ token, user: publicUser(updated[0]) });
    } catch (dbErr) {
      if (dbErr.code === '23505') {
        return res.status(409).json({ error: 'Identifiant ou e-mail déjà utilisé.' });
      }
      throw dbErr;
    }
  } catch (err) {
    return next(err);
  }
}

module.exports = { login, me, onboarding };
