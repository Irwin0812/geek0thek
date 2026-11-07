/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const { query, pool } = require('../config/db');
const { validatePassword } = require('../utils/password');
const { verifyTotp } = require('../utils/totp');
const emailService = require('../utils/emailService');

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
    // 2FA (Google Authenticator / TOTP) : TRUE si l'utilisateur a activé
    // l'authentification à deux facteurs (colonne users.totp_enabled).
    totpEnabled: row.totp_enabled === true,
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
 *
 * 2FA (Google Authenticator / TOTP) : si le compte a ACTIVÉ l'authentification
 * à deux facteurs (users.totp_enabled = TRUE), les identifiants valides ne
 * suffisent plus — la réponse est alors { needsTotp: true, tempToken } : un
 * jeton court (5 min) qui autorise UNIQUEMENT l'étape de vérification TOTP
 * (POST /api/auth/verify-totp). Le JWT de session complet n'est délivré qu'
 * après le code à 6 chiffres correct.
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

    // 2FA ACTIVÉE : première étape validée (login + mot de passe corrects) —
    // on renvoie un jeton temporaire dédié à la vérification TOTP, jamais le
    // JWT de session complet.
    if (user.totp_enabled === true && user.totp_secret) {
      const tempToken = jwt.sign(
        { sub: user.id, role: user.role, type: 'totp' },
        env.jwt.secret,
        { expiresIn: '5m', issuer: 'geek0thek' }
      );
      return res.json({ needsTotp: true, tempToken });
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
 * POST /api/auth/verify-totp
 * Deuxième étape de la connexion quand la 2FA est activée.
 * Body : { tempToken, code } — tempToken = jeton court renvoyé par /login
 * (payload type: 'totp', validité 5 min), code = code TOTP à 6 chiffres
 * saisi dans Google Authenticator. Tolérance ±1 fenêtre de 30 s (cf.
 * utils/totp.js). Succès : { token, user } (session complète, identique à
 * /login sans 2FA).
 */
async function verifyTotpCode(req, res, next) {
  try {
    const { tempToken, code } = req.body || {};
    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Jeton temporaire et code requis.' });
    }
    let payload;
    try {
      payload = jwt.verify(String(tempToken), env.jwt.secret, { issuer: 'geek0thek' });
    } catch {
      return res.status(401).json({ error: 'Jeton temporaire invalide ou expiré. Reconnectez-vous.' });
    }
    if (payload.type !== 'totp') {
      return res.status(401).json({ error: 'Jeton invalide.' });
    }
    const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    const user = rows[0];
    if (!user || user.is_active === false) {
      return res.status(401).json({ error: 'Compte inexistant ou désactivé.' });
    }
    if (user.totp_enabled !== true || !user.totp_secret) {
      // La 2FA a été désactivée entre-temps : on délivre directement la session.
      const token = jwt.sign({ sub: user.id, role: user.role }, env.jwt.secret, {
        expiresIn: env.jwt.expiresIn,
        issuer: 'geek0thek',
      });
      return res.json({ token, user: publicUser(user) });
    }
    if (!verifyTotp(user.totp_secret, String(code))) {
      return res.status(401).json({ error: 'Code de vérification incorrect.' });
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

// ------------------------------------------------------------
// RÉINITIALISATION DU MOT DE PASSE (« identifiant / mot de passe oublié »)
//   POST /api/auth/forgot-password — body { identifier } (login OU e-mail).
//     Réponse GÉNÉRIQUE dans tous les cas (aucune énumération d'utilisateurs) :
//     si un compte actif correspond, un jeton à usage unique est créé
//     (seul son HACHAGE SHA-256 est stocké dans password_resets, expiration
//     1 h) et un e-mail est envoyé contenant l'identifiant du compte ET un
//     lien de réinitialisation temporaire :
//       ${APP_URL}/reset-password/<jeton>
//   POST /api/auth/reset-password — body { token, newPassword } : valide le
//     jeton (non expiré, non consommé), pose le nouveau mot de passe et remet
//     must_change_password = FALSE (l'utilisateur a choisi SON mot de passe
//     via un lien sécurisé — pas d'onboarding forcé ensuite). Le jeton est
//     marqué consommé (usage unique).
// ------------------------------------------------------------

/** Hachage SHA-256 (hex) d'un jeton — seul le hachage est persisté. */
function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function forgotPassword(req, res, next) {
  try {
    const identifier = String((req.body || {}).identifier || '').trim();
    if (!identifier) {
      return res.status(400).json({ error: 'Champ requis : identifier (identifiant ou e-mail).' });
    }
    // Réponse GÉNÉRIQUE : même message que le compte existe ou non (et même
    // si l'envoi d'e-mail échoue) — jamais d'énumération d'utilisateurs.
    const generic = { ok: true, message: 'Si un compte correspond à cet identifiant, un e-mail de réinitialisation lui a été envoyé.' };

    const { rows } = await query('SELECT * FROM users WHERE login = $1 OR email = $1', [identifier]);
    const user = rows[0];
    if (!user || user.is_active === false) {
      return res.json(generic);
    }

    // Jeton aléatoire (48 octets -> 96 caractères hexadécimaux).
    const token = crypto.randomBytes(48).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 heure
    try {
      await query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [user.id, hashResetToken(token), expiresAt]
      );
    } catch (dbErr) {
      // Table absente (base non migrée) : on répond de façon générique.
      console.error('[auth] forgot-password — échec d\'insertion du jeton :', dbErr.message);
      return res.json(generic);
    }

    // Envoi NON bloquant (cf. utils/emailService.js) : un échec SMTP ne doit
    // jamais faire échouer la requête ni révéler l'existence du compte.
    emailService.notifyPasswordReset({
      to: user.email,
      firstName: user.first_name,
      login: user.login,
      resetUrl: `${String(env.appUrl || '').replace(/\/+$/, '')}/reset-password/${token}`,
    }).catch(() => {});

    return res.json(generic);
  } catch (err) {
    return next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const { token, newPassword } = req.body || {};
    if (!token || !newPassword) {
      return res.status(400).json({ error: 'Champs requis : token et newPassword.' });
    }
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }

    const { rows } = await query(
      `SELECT pr.id AS resetId, pr.expires_at, pr.used_at, u.id AS userId, u.password_hash
       FROM password_resets pr JOIN users u ON u.id = pr.user_id
       WHERE pr.token_hash = $1`,
      [hashResetToken(String(token))]
    );
    const reset = rows[0];
    if (!reset || reset.used_at !== null) {
      return res.status(400).json({ error: 'Lien de réinitialisation invalide ou déjà utilisé.' });
    }
    if (new Date(reset.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Lien de réinitialisation expiré. Demandez un nouveau lien.' });
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    // Le jeton est consommé ATOMIQUEMENT avec le changement de mot de passe
    // (transaction) : l'UPDATE du jeton est conditionné sur used_at IS NULL
    // (jamais deux utilisations, même en concurrence) et tout échec du
    // changement de mot de passe annule la consommation du lien.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const consumed = await client.query(
        `UPDATE password_resets SET used_at = now() WHERE id = $1 AND used_at IS NULL`,
        [reset.resetId]
      );
      if (consumed.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Lien de réinitialisation déjà utilisé.' });
      }
      await client.query(
        `UPDATE users SET password_hash = $1, must_change_password = FALSE,
         password_changed_at = now() WHERE id = $2`,
        [passwordHash, reset.userId]
      );
      await client.query('COMMIT');
    } catch (txErr) {
      try { await client.query('ROLLBACK'); } catch { /* déjà annulé */ }
      throw txErr;
    } finally {
      client.release();
    }

    return res.json({ ok: true, message: 'Mot de passe réinitialisé. Vous pouvez vous connecter.' });
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
 * première installation non encore changés — compte créé via l'API ; l'admin
 * de test « admin »/« admin » est seedé avec le drapeau à FALSE, il n'y passe
 * pas). Impose :
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
    // Validation du MOT DE PASSE (règle assouplie : longueur minimale, tous
    // les caractères autorisés). Le message porte explicitement sur le mot de
    // passe — jamais sur « l'identifiant » (celui-ci est validé plus bas).
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
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
        // Ce message concerne l'IDENTIFIANT / pseudo de login (et non le mot
        // de passe) : il est volontairement explicite pour ne jamais être
        // confondu avec une erreur de mot de passe.
        return res.status(400).json({
          error: "L'identifiant (pseudo) n'est pas valide : 2 à 80 caractères, lettres, chiffres, point, tiret ou underscore uniquement.",
        });
      }
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    try {
      const { rows: updated } = await query(
        `UPDATE users SET login = $1, password_hash = $2, must_change_password = FALSE,
         password_changed_at = now()
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

module.exports = { login, me, onboarding, verifyTotpCode, forgotPassword, resetPassword };
