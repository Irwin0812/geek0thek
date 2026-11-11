/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
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
              avatar_url, language, theme, must_change_password
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
 * Sécurité à la première connexion (onboarding) : refuse TOUTE requête
 * applicative tant que le compte porte le drapeau must_change_password =
 * TRUE (identifiants de première installation non encore changés). Le seul
 * chemin autorisé est POST /api/auth/onboarding (déclaré AVANT ce garde,
 * sans passer par lui) : nouveau mot de passe obligatoire + pseudo de
 * login personnalisable. Renvoie 403 avec le code « must-change-password »
 * que le frontend intercepte pour afficher la page de forçage.
 */
function requirePasswordChanged(req, res, next) {
  if (req.user && req.user.must_change_password === true) {
    return res.status(403).json({ code: 'must-change-password', error: 'Modification du mot de passe requise.' });
  }
  return next();
}

/**
 * Contrôleur d'accès aux objets d'une collection (disque / BD) :
 * renvoie true si l'utilisateur courant est l'ADMIN (accès global) ou le
 * PROPRIÉTAIRE du document. S'applique aux contrôles de lecture/écriture.
 */
function canEditItem(user, ownerId) {
  return user.role === 'admin' || String(user.id) === String(ownerId);
}

/**
 * Accès EN CONSULTATION à la collection d'un autre utilisateur (lecture seule).
 * Renvoie true si l'utilisateur courant est :
 *   - l'ADMIN (accès global), OU
 *   - le PROPRIÉTAIRE de la collection, OU
 *   - un DESTINATAIRE d'un partage de bibliothèque (table `library_shares`)
 *     portant sur le scope demandé.
 * @param {object} user      utilisateur courant (req.user)
 * @param {number} ownerId   id du propriétaire de la collection consultée
 * @param {string} [scope]   « vinyls » | « comics » | « all » (défaut « all »)
 */
async function canConsult(user, ownerId, scope = 'all') {
  if (user.role === 'admin' || String(user.id) === String(ownerId)) return true;
  try {
    const { rows } = await query(
      `SELECT 1 FROM library_shares
       WHERE owner_id = $1 AND granted_to_id = $2 AND scope IN ($3, 'all')
       LIMIT 1`,
      [ownerId, user.id, scope]
    );
    return rows.length > 0;
  } catch {
    // Table absente (base non migrée) : on retombe sur propriétaire/admin.
    return false;
  }
}

module.exports = { authenticate, requireAdmin, requirePasswordChanged, canEditItem, canConsult };
