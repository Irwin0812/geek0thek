const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query } = require('../config/db');

/**
 * Middleware d'authentification JWT (Bearer Token).
 * Vérifie la signature du jeton puis que le compte existe encore.
 * Attache l'utilisateur courant à req.user.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');

    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'Authentification requise.' });
    }

    const payload = jwt.verify(token, env.jwt.secret);

    const { rows } = await query(
      `SELECT id, login, role, first_name, last_name, email, is_public, is_active,
              avatar_url, language
       FROM users WHERE id = $1`,
      [payload.sub]
    );

    if (!rows[0]) {
      return res.status(401).json({ error: 'Compte inexistant.' });
    }

    // Compte désactivé par un administrateur : session refusée.
    if (!rows[0].is_active) {
      return res.status(401).json({ error: 'Compte désactivé. Contactez un administrateur.' });
    }

    req.user = rows[0];
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Session invalide ou expirée.' });
  }
}

/**
 * Restreint l'accès aux administrateurs (à utiliser après authenticate).
 */
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  return res.status(403).json({ error: 'Accès réservé aux administrateurs.' });
}

/**
 * Contrôleur d'accès aux objets d'une collection (disque / BD) :
 * renvoie true si l'utilisateur courant est l'ADMIN (accès global) ou le
 * PROPRIÉTAIRE du document. S'applique aux contrôles de lecture/écriture.
 */
function canEditItem(user, ownerId) {
  return user.role === 'admin' || String(user.id) === String(ownerId);
}

module.exports = { authenticate, requireAdmin, canEditItem };
