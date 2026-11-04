const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const env = require('../config/env');
const { query } = require('../config/db');
const { validatePassword } = require('../utils/password');
const emailService = require('../utils/emailService');

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function mapUser(row) {
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
    // Partage granulaire de la visibilité publique (disques / BD)
    shareVinyls: Boolean(row.share_vinyls !== false),
    shareComics: Boolean(row.share_comics !== false),
    isActive: Boolean(row.is_active),
    // Sécurité à la première connexion : TRUE tant que le compte n'a pas
    // changé ses identifiants de première installation (onboarding forcé).
    mustChangePassword: row.must_change_password === true,
    // Langue préférée (code ISO 639-1) : « fr » en dépit de toute valeur NULL
    // résiduelle (la colonne est NOT NULL DEFAULT 'fr' depuis la migration).
    language: row.language || 'fr',
    // Thème visuel préféré (cf. THEMES) : « dark » en dépit de toute valeur
    // NULL résiduelle (la colonne est NOT NULL DEFAULT 'dark' depuis la
    // migration users.theme). L'ex-clé « light » (thème « Moderne », renommé
    // « Médiathèque ») est résolue vers « library ».
    theme: migrateTheme(row.theme || 'dark'),
    avatarUrl: row.avatar_url || null,
    gender: row.gender || null,
    birthDate: row.birth_date || null,
    address: row.address || null,
    country: row.country || null,
    createdAt: row.created_at,
    vinylCount: row.vinyl_count !== undefined ? Number(row.vinyl_count) : null,
    comicCount: row.comic_count !== undefined ? Number(row.comic_count) : null,
  };
}

const BASE_SELECT = `
  SELECT u.id, u.login, u.role, u.first_name, u.last_name, u.email, u.phone,
         u.bio, u.is_public, u.share_vinyls, u.share_comics, u.is_active,
         u.must_change_password,
         u.avatar_url, u.language, u.theme, u.gender, u.birth_date, u.address, u.country,
         u.created_at,
         (SELECT COUNT(*) FROM vinyls v WHERE v.user_id = u.id)::int AS vinyl_count,
         (SELECT COUNT(*) FROM comics c WHERE c.user_id = u.id)::int AS comic_count
  FROM users u`;

// Règle de mot de passe assouplie : longueur minimale (8) + TOUS les
// caractères autorisés (lettres, chiffres, accents et symboles). La validation
// est centralisée dans utils/password.js (validatePassword) pour que tous les
// points d'entrée renvoient le même message clair portant sur le mot de passe.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GENDERS = ['H', 'F', 'O'];
// Langues supportées par l'interface (codes ISO 639-1, cf. frontend/src/i18n/i18n.js)
const LANGUAGES = ['fr', 'en', 'it', 'es', 'de', 'nl'];
// Thèmes visuels supportés (clé = valeur stockée dans users.theme ;
// cf. frontend/src/services/theme.js et frontend/src/themes/*.css) :
//   dark    — sombre (défaut de l'application)
//   library — médiathèque (lumineux, photo bg-library.jpg sous voile clair)
//   vinyl   — disquaire (tons bois, ambiance rétro)
//   comic       — bande dessinée (contrastes marqués)
//   comic-books — comic books (photo bg_comics.jpg en fond principal)
//   neon        — néon (ex-« Pastel », « pastel » : halos néon sur fond sombre)
const THEMES = ['dark', 'library', 'vinyl', 'comic', 'comic-books', 'neon'];

// Clés de thème obsolètes acceptées en entrée (préférences déjà stockées ou
// payloads d'anciens clients) et résolues vers leur remplaçante : l'ex-thème
// « Moderne » (« light ») est devenu « Médiathèque » (« library »), le retiré
// thème « cartoon » est remplacé par « Comic Books » (« comic-books »), et le
// remplacé thème « Pastel » (« pastel ») par « Néon » (« neon »).
const LEGACY_THEME_ALIASES = { light: 'library', cartoon: 'comic-books', pastel: 'neon' };

/** Réécrit une clé de thème obsolète en sa remplaçante (ex. « light » → « library »). */
function migrateTheme(theme) {
  const key = String(theme || '').trim().toLowerCase();
  return LEGACY_THEME_ALIASES[key] || key;
}

function cleanBirthDate(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return { error: 'Date de naissance invalide (format attendu : AAAA-MM-JJ).' };
  const now = new Date();
  if (d.getTime() > now.getTime()) return { error: 'La date de naissance ne peut pas être dans le futur.' };
  return { value: d.toISOString().slice(0, 10) };
}

// NB : les deux helpers retournent TOUJOURS un objet { value } ou { error }
// (jamais une valeur brute, jamais null) : le code appelant peut toujours
// lire .error sans risquer « Cannot read properties of null ».
function cleanGender(raw) {
  if (raw === null || raw === undefined || raw === '') return { value: null };
  const g = String(raw).trim().toUpperCase();
  return GENDERS.includes(g) ? { value: g } : { error: 'Sexe invalide (attendu : H, F ou O).' };
}

/**
 * Nettoie la langue préférée (code ISO 639-1 en minuscules, ex. « fr », « en »).
 * La colonne étant NOT NULL, toute valeur invalide est refusée (jamais null).
 */
function cleanLanguage(raw) {
  const lang = String(raw).trim().toLowerCase();
  return LANGUAGES.includes(lang)
    ? { value: lang }
    : { error: `Langue invalide (attendue : ${LANGUAGES.join(' ou ')}).` };
}

/**
 * Nettoie le thème visuel préféré (une des clés de THEMES, insensible à la
 * casse). Les alias obsolètes (ex. « light » → « library », ex-« Moderne »
 * → « Médiathèque ») sont résolus vers leur remplaçante avant validation.
 * La colonne étant NOT NULL, toute valeur invalide est refusée (jamais null).
 */
function cleanTheme(raw) {
  const theme = migrateTheme(String(raw).trim().toLowerCase());
  return THEMES.includes(theme)
    ? { value: theme }
    : { error: `Thème invalide (attendu : ${THEMES.join(', ')}).` };
}

/**
 * Conduit à la suppression du fichier d'avatar local (le cas échéant).
 * Retourne true si un fichier a été supprimé.
 */
function removeAvatarFile(avatarUrl) {
  if (!avatarUrl || typeof avatarUrl !== 'string') return false;
  if (!avatarUrl.startsWith('/uploads/avatars/') || /[/\\]/.test(avatarUrl.slice(1).split('/').pop() || '')) {
    return false; // jamais de chemin hors du dossier des avatars
  }
  try {
    fs.unlinkSync(path.join(env.uploadDir, 'avatars', path.basename(avatarUrl)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Récupère le fichier d'avatar uploadé, quelle que soit la stratégie multer
 * employée par la route :
 *   - uploadAvatar.single('avatar') -> req.file   (stratégie VALUE)
 *   - uploadAvatar.array('avatar')   -> req.files  (stratégie ARRAY)
 * Historiquement seul req.files était lu : avec .single() il reste undefined
 * et l'avatar n'était donc jamais enregistré (retour avatarUrl = null).
 * Renvoie l'objet fichier { path, ... } ou null.
 */
function getUploadedAvatarFile(req) {
  if (req.file && req.file.path) return req.file;
  if (req.files && req.files.length > 0 && req.files[0].path) return req.files[0];
  return null;
}

/**
 * Applique les champs de profil (identiques pour /me et PUT /:id) :
 * valide chaque champ présent et construit la clause SET paramétrée.
 * Retourne { values, fields } ou { error }.
 */
function profileUpdateFields(body) {
  const values = [];
  const fields = [];
  const set = (column, value) => {
    values.push(value);
    fields.push(`${column} = $${values.length}`);
  };
  if (body.email !== undefined) set('email', String(body.email).trim());
  if (body.login !== undefined) set('login', String(body.login).trim());
  if (body.lastName !== undefined) set('last_name', String(body.lastName).trim());
  if (body.firstName !== undefined) set('first_name', String(body.firstName).trim());
  if (body.phone !== undefined) set('phone', body.phone ? String(body.phone).trim() : null);
  if (body.bio !== undefined) set('bio', body.bio ? String(body.bio).trim() : null);
  if (body.isPublic !== undefined) {
    // JSON : vrai booléen ; multipart (avatars) : chaîne 'true' / 'false' —
    // 'false' non vide est vrai, d'où la conversion explicite.
    const raw = body.isPublic;
    set('is_public', raw === true || String(raw) === 'true');
  }
  // Partage granulaire : mêmes conversions booléen / 'true'/'false' que isPublic
  if (body.shareVinyls !== undefined) {
    const raw = body.shareVinyls;
    set('share_vinyls', raw === true || String(raw) === 'true');
  }
  if (body.shareComics !== undefined) {
    const raw = body.shareComics;
    set('share_comics', raw === true || String(raw) === 'true');
  }
  if (body.language !== undefined) {
    const l = cleanLanguage(body.language);
    if (l.error) return { error: l.error };
    set('language', l.value);
  }
  if (body.theme !== undefined) {
    const th = cleanTheme(body.theme);
    if (th.error) return { error: th.error };
    set('theme', th.value);
  }
  if (body.address !== undefined) set('address', body.address ? String(body.address).trim() : null);
  if (body.country !== undefined) set('country', body.country ? String(body.country).trim() : null);
  if (body.birthDate !== undefined) {
    const bd = cleanBirthDate(body.birthDate);
    if (bd.error) return { error: bd.error };
    set('birth_date', bd.value);
  }
  if (body.gender !== undefined) {
    const g = cleanGender(body.gender);
    if (g.error) return { error: g.error };
    set('gender', g.value);
  }
  return { values, fields };
}

/**
 * UPDATE users paramétré : `values` ne contient QUE les valeurs de la
 * clause SET ; l'id cible est ajouté ici pour la clause WHERE.
 * Toute valeur en trop (comme un id ajouté deux fois) créerait un
 * paramètre orphelin et l'erreur PostgreSQL
 * « could not determine data type of parameter $N » : d'où la
 * vérification systématique de l'alignement fields ↔ valeurs.
 */
async function updateUserRow(userId, fields, values) {
  if (fields.length !== values.length) {
    throw new Error(
      `[users] Désalignement SET : ${fields.length} champ(s) pour ${values.length} valeur(s).`
    );
  }
  fields.forEach((field, i) => {
    if (!field.endsWith(`$${i + 1}`)) {
      throw new Error(`[users] Placeholder SET invalide : « ${field} » (attendu : $${i + 1}).`);
    }
  });
  const params = [...values, userId];
  const { rows } = await query(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return rows[0];
}

/**
 * Valide les informations d'identification courantes du compte :
 *  - le compte doit exister et être ACTIF (un compte désactivé ne peut
 *    plus se connecter, ni changer son mot de passe),
 *  - le mot de passe actuel doit être fourni et correct.
 * Retourne le hash du mot de passe courant, null si rien à faire,
 * ou { error, status } en cas d'échec.
 */
async function resolvePasswordChange(userId, currentPassword, newPassword) {
  if (!newPassword) return null;
  // Règle assouplie : longueur minimale + tous les caractères autorisés.
  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    return { error: passwordError, status: 400 };
  }
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  if (!rows[0]) return { error: 'Compte introuvable.', status: 404 };
  if (currentPassword === undefined || currentPassword === null || String(currentPassword) === '') {
    return { error: 'Mot de passe actuel requis pour changer le mot de passe.', status: 400 };
  }
  const ok = await bcrypt.compare(String(currentPassword), rows[0].password_hash);
  if (!ok) return { error: 'Mot de passe actuel incorrect.', status: 401 };
  return bcrypt.hash(String(newPassword), 10);
}

// ------------------------------------------------------------
// Routes
// ------------------------------------------------------------

/**
 * GET /api/users (admin) — liste tous les comptes.
 */
async function listUsers(req, res, next) {
  try {
    const { rows } = await query(`${BASE_SELECT} ORDER BY u.created_at ASC`);
    return res.json({ users: rows.map(mapUser) });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/users/me — profil courant (compteurs de disques / BD inclus).
 */
async function getMe(req, res, next) {
  try {
    const { rows } = await query(`${BASE_SELECT} WHERE u.id = $1`, [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    return res.json({ user: mapUser(rows[0]) });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/users (admin) — création d'un compte.
 * Champs obligatoires : Nom, Prénom, E-mail, Identifiant (login),
 * Mot de passe, Rôle. Tous les autres profils sont facultatifs.
 */
async function createUser(req, res, next) {
  try {
    const {
      lastName, firstName, email, login, password, role,
      phone, bio, isPublic, avatar, language, gender, birthDate, address, country,
    } = req.body || {};
    if (!lastName || !firstName || !email || !login || !password) {
      return res
        .status(400)
        .json({ error: 'Champs requis : Nom, Prénom, Email, Identifiant, Mot de passe.' });
    }
    if (!EMAIL_RE.test(String(email).trim())) {
      return res.status(400).json({ error: "Adresse e-mail invalide." });
    }
    // Règle assouplie : longueur minimale + tous les caractères autorisés.
    const passwordError = validatePassword(password);
    if (passwordError) {
      return res.status(400).json({ error: passwordError });
    }
    const userRole = String(role || 'user').trim();
    if (!['admin', 'user'].includes(userRole)) {
      return res.status(400).json({ error: 'Rôle invalide (attendu : admin ou user).' });
    }
    const genderValue = cleanGender(gender);
    if (genderValue.error) return res.status(400).json({ error: genderValue.error });
    const bd = cleanBirthDate(birthDate);
    if (bd.error) return res.status(400).json({ error: bd.error });
    // Langue (facultative) : défaut 'fr' à la création si non fourni.
    let languageValue = 'fr';
    if (language !== undefined && language !== null && String(language).trim() !== '') {
      const l = cleanLanguage(language);
      if (l.error) return res.status(400).json({ error: l.error });
      languageValue = l.value;
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    // Avatar fourni en création (multipart, champ "avatar")
    const uploadedAvatar = getUploadedAvatarFile(req);
    const avatarUrl = uploadedAvatar
      ? `/uploads/avatars/${path.basename(uploadedAvatar.path)}`
      : null;

    try {
      const { rows } = await query(
        `INSERT INTO users (last_name, first_name, email, login, password_hash, role,
                            phone, bio, is_public, share_vinyls, share_comics,
                            is_active, must_change_password, avatar_url, language, gender, birth_date, address, country)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, true), true, true,
                 true, TRUE, $10, $11, $12, $13, $14, $15)
         RETURNING *`,
        [
          String(lastName).trim(),
          String(firstName).trim(),
          String(email).trim(),
          String(login).trim(),
          passwordHash,
          userRole,
          phone ? String(phone).trim() : null,
          bio ? String(bio).trim() : null,
          isPublic,
          avatarUrl,
          languageValue,
          genderValue.value,
          bd.value,
          address ? String(address).trim() : null,
          country ? String(country).trim() : null,
        ]
      );
      // Déclencheur e-mail n°1 — CRÉATION DE COMPTE PAR UN ADMIN :
      // confirmation de la création + accès (identifiant / mot de passe
      // provisoire) envoyés au NOUVEL UTILISATEUR. Envoi NON bloquant : un
      // échec d'envoi (SMTP non configuré, réseau…) ne fait JAMAIS échouer la
      // création du compte (cf. utils/emailService.js).
      emailService.notifyAccountCreated({
        to: String(email).trim(),
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        login: String(login).trim(),
        password: String(password),
      }).catch(() => {});
      return res.status(201).json({ user: mapUser(rows[0]) });
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

/**
 * PUT /api/users/:id (admin) — modification d'un compte.
 * Champs profil + rôle, activation / désactivation (isActive),
 * réinitialisation du mot de passe (newPassword, sans mot actuel),
 * avatar (multipart "avatar" / "removeAvatar").
 */
async function updateUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};

    const { rows: targetRows } = await query('SELECT * FROM users WHERE id = $1', [id]);
    const target = targetRows[0];
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });

    // Changement de rôle : valeur validée + protection du dernier admin.
    let nextRole = null;
    if (body.role !== undefined && body.role !== null && String(body.role).trim() !== '') {
      const r = String(body.role).trim();
      if (!['admin', 'user'].includes(r)) {
        return res.status(400).json({ error: 'Rôle invalide (attendu : admin ou user).' });
      }
      if (target.role === 'admin' && r !== 'admin') {
        const { rows: admins } = await query(
          `SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND is_active = TRUE`
        );
        if (admins[0].c <= 1) {
          return res.status(400).json({ error: 'Impossible de révoquer le dernier administrateur actif.' });
        }
      }
      nextRole = r;
    }

    // Activation / désactivation
    let active = null;
    if (body.isActive !== undefined) {
      active = Boolean(body.isActive);
      // Empêche un admin de se désactiver lui-même (perte d'accès admin)
      if (!active && id === Number(req.user.id)) {
        return res.status(400).json({ error: 'Vous ne pouvez pas désactiver votre propre compte.' });
      }
    }

    // Champs profil standard
    const profile = profileUpdateFields(body);
    if (profile.error) return res.status(400).json({ error: profile.error });

    // Avatar : nouveau fichier, suppression, ou inchangé
    let avatarUrl = null;
    let removeFile = null;
    const uploaded = getUploadedAvatarFile(req);
    if (uploaded) {
      avatarUrl = `/uploads/avatars/${path.basename(uploaded.path)}`;
      removeFile = target.avatar_url;
    } else if (body.removeAvatar) {
      avatarUrl = null;
      removeFile = target.avatar_url;
    }
    if (removeFile) removeAvatarFile(removeFile);

    const values = [...profile.values];
    const fields = [...profile.fields];
    if (nextRole) {
      values.push(nextRole);
      fields.push(`role = $${values.length}`);
    }
    if (active !== null) {
      values.push(active);
      fields.push(`is_active = $${values.length}`);
    }
    if (avatarUrl !== null) {
      values.push(avatarUrl);
      fields.push(`avatar_url = $${values.length}`);
    }
    if (body.newPassword) {
      // Règle assouplie : longueur minimale + tous les caractères autorisés.
      const passwordError = validatePassword(body.newPassword);
      if (passwordError) {
        return res.status(400).json({ error: passwordError });
      }
      values.push(await bcrypt.hash(String(body.newPassword), 10));
      fields.push(`password_hash = $${values.length}`);
      // Réinitialisation par un admin : le compte redevient « à onborder » —
      // sa prochaine connexion forcera la modification du mot de passe.
      values.push(true);
      fields.push(`must_change_password = $${values.length}`);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à modifier.' });
    }

    try {
      const row = await updateUserRow(id, fields, values);
      if (!row) return res.status(404).json({ error: 'Utilisateur introuvable.' });
      return res.json({ user: mapUser(row) });
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

/**
 * PUT /api/users/me — modification de son propre profil (tous les champs
 * du profil, y compris l'avatar en multipart) et changement de mot de
 * passe avec mot de passe actuel. Impossible de se désactiver soi-même.
 */
async function updateMe(req, res, next) {
  try {
    const { currentPassword, newPassword, ...rest } = req.body || {};

    const profile = profileUpdateFields(rest);
    if (profile.error) return res.status(400).json({ error: profile.error });

    // resolvePasswordChange renvoie : null (rien à faire) | hash | { error, status }
    let passwordHash = null;
    if (newPassword) {
      const result = await resolvePasswordChange(req.user.id, currentPassword, newPassword);
      if (result !== null && typeof result === 'object') {
        return res.status(result.status || 400).json({ error: result.error });
      }
      passwordHash = result;
    }

    let avatarUrl = null;
    const uploaded = getUploadedAvatarFile(req);
    if (uploaded) {
      avatarUrl = `/uploads/avatars/${path.basename(uploaded.path)}`;
      const { rows } = await query('SELECT avatar_url FROM users WHERE id = $1', [req.user.id]);
      if (rows[0] && rows[0].avatar_url) removeAvatarFile(rows[0].avatar_url);
    } else if (rest.removeAvatar) {
      const { rows } = await query('SELECT avatar_url FROM users WHERE id = $1', [req.user.id]);
      if (rows[0] && rows[0].avatar_url) removeAvatarFile(rows[0].avatar_url);
      avatarUrl = null;
    }

    const values = [...profile.values];
    const fields = [...profile.fields];
    if (avatarUrl !== null) {
      values.push(avatarUrl);
      fields.push(`avatar_url = $${values.length}`);
    }
    if (passwordHash) {
      values.push(passwordHash);
      fields.push(`password_hash = $${values.length}`);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: 'Aucun champ à modifier.' });
    }

    try {
      const row = await updateUserRow(req.user.id, fields, values);
      if (!row) return res.status(404).json({ error: 'Utilisateur introuvable.' });
      return res.json({ user: mapUser(row) });
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

/**
 * PATCH /api/users/profile/language — modification de sa langue préférée.
 * Body : { "language": "fr" } (code ISO 639-1 : fr, en, it, es, de, nl).
 * Endpoint léger et explicite, à côté de PUT /me (qui accepte le même
 * champ « language » parmi les autres champs du profil).
 */
async function updateProfileLanguage(req, res, next) {
  try {
    const { language } = req.body || {};
    if (language === undefined || language === null || String(language).trim() === '') {
      return res.status(400).json({
        error: `Champ requis : language (attendu : ${LANGUAGES.join(' ou ')}).`,
      });
    }
    const l = cleanLanguage(language);
    if (l.error) return res.status(400).json({ error: l.error });

    const { rows } = await query('UPDATE users SET language = $1 WHERE id = $2 RETURNING *', [
      l.value,
      req.user.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    return res.json({ user: mapUser(rows[0]) });
  } catch (err) {
    return next(err);
  }
}

/**
 * PATCH /api/users/profile/theme — modification de son thème visuel préféré.
 * Body : { "theme": "dark" | "library" | "vinyl" | "comic" | "comic-books" | "neon" }
 * (l'ancienne clé « light » du thème ex-« Moderne » est acceptée et résolue
 * automatiquement vers « library » / « Médiathèque »).
 * Endpoint léger et explicite, à côté de PATCH /profile/language (PUT /me
 * accepte aussi le même champ « theme » parmi les autres champs du profil).
 */
async function updateProfileTheme(req, res, next) {
  try {
    const { theme } = req.body || {};
    if (theme === undefined || theme === null || String(theme).trim() === '') {
      return res.status(400).json({
        error: `Champ requis : theme (attendu : ${THEMES.join(', ')}).`,
      });
    }
    const th = cleanTheme(theme);
    if (th.error) return res.status(400).json({ error: th.error });

    const { rows } = await query('UPDATE users SET theme = $1 WHERE id = $2 RETURNING *', [
      th.value,
      req.user.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    return res.json({ user: mapUser(rows[0]) });
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /api/users/:id (admin) — suppression d'un compte + sa collection.
 */
async function deleteUser(req, res, next) {
  try {
    const id = Number(req.params.id);
    if (id === Number(req.user.id)) {
      return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte.' });
    }
    const { rows } = await query('SELECT id, role, avatar_url FROM users WHERE id = $1', [id]);
    const target = rows[0];
    if (!target) return res.status(404).json({ error: 'Utilisateur introuvable.' });
    if (target.role === 'admin') {
      const admins = await query(
        `SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND is_active = TRUE`
      );
      if (admins.rows[0].c <= 1) {
        return res.status(400).json({ error: 'Impossible de supprimer le dernier administrateur actif.' });
      }
    }
    await query('DELETE FROM users WHERE id = $1', [id]);
    removeAvatarFile(target.avatar_url);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/users/public — liste des utilisateurs dont la collection est
 * PUBLIQUE et dont le compte est actif (sans authentification).
 */
async function listPublicUsers(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT u.id, u.login, u.first_name AS "firstName", u.last_name AS "lastName",
              u.bio, u.avatar_url AS "avatarUrl",
              u.share_vinyls, u.share_comics,
              c.comic_count::int AS "comicCount",
              v.vinyl_count::int AS "vinylCount"
       FROM users u
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS comic_count
         FROM comics c WHERE c.user_id = u.id AND u.share_comics = TRUE
       ) c ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS vinyl_count
         FROM vinyls v WHERE v.user_id = u.id AND u.share_vinyls = TRUE
       ) v ON TRUE
       WHERE u.is_public = TRUE AND u.is_active = TRUE
         AND (u.share_vinyls = TRUE OR u.share_comics = TRUE)
       ORDER BY u.last_name ASC, u.first_name ASC`
    );
    return res.json({ users: rows.map((r) => ({
      id: r.id,
      login: r.login,
      firstName: r.firstName,
      lastName: r.lastName,
      bio: r.bio,
      avatarUrl: r.avatarUrl || null,
      // Partage granulaire réexposé : le frontend ne sollicite que les
      // collections réellement partagées (ex. : BD d'un utilisateur qui
      // n'expose que ses disques -> [] au lieu d'une erreur 403).
      shareVinyls: r.share_vinyls === true,
      shareComics: r.share_comics === true,
      comicCount: r.comicCount,
      vinylCount: r.vinylCount,
    })) });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/users/all — liste des MEMBRES pour tout utilisateur authentifié
 * (pas besoin d'être admin). Utilisée par la page « Bibliothèques partagées » :
 * chaque membre doit pouvoir voir les AUTRES utilisateurs de l'application
 * pour leur ouvrir (ou retirer) l'accès en consultation à sa collection.
 * Données limitées aux infos d'identification + compteurs de collection —
 * jamais téléphone / adresse / date de naissance / rôle.
 */
async function listAllUsers(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT u.id, u.login, u.first_name, u.last_name, u.email, u.avatar_url,
              (SELECT COUNT(*) FROM vinyls v WHERE v.user_id = u.id)::int AS vinyl_count,
              (SELECT COUNT(*) FROM comics c WHERE c.user_id = u.id)::int AS comic_count
       FROM users u
       WHERE u.is_active = TRUE
       ORDER BY u.last_name ASC, u.first_name ASC`
    );
    return res.json({
      users: rows.map((r) => ({
        id: r.id,
        login: r.login,
        firstName: r.first_name,
        lastName: r.last_name,
        email: r.email,
        avatarUrl: r.avatar_url || null,
        vinylCount: Number(r.vinyl_count),
        comicCount: Number(r.comic_count),
      })),
    });
  } catch (err) {
    return next(err);
  }
}

// ------------------------------------------------------------
// PARTAGE DE BIBLIOTHÈQUE (accès en consultation)
//   Un utilisateur (ou un admin) ouvre l'accès EN CONSULTATION à sa
//   collection à un autre utilisateur. C'est cette action qui déclenche la
//   notification e-mail n°2 (cf. utils/emailService.js -> notifyLibraryShared).
//   Les partages sont persistés dans la table `library_shares` (migration
//   « library-shares.table ») et honorés par les routes de lecture des
//   collections (cf. canConsult de middlewares/auth.js).
// ------------------------------------------------------------

const SHARE_SCOPES = ['vinyls', 'comics', 'all'];
const SCOPE_LABELS = { vinyls: 'disques', comics: 'BD', all: 'disques et BD' };

/** Construit le DTO d'un partage à partir d'une ligne jointe (ls.* + u.*). */
function shareDto(row) {
  return {
    id: row.id,
    scope: row.scope,
    createdAt: row.created_at,
    user: {
      id: row.uid,
      login: row.login,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
    },
  };
}

/**
 * GET /api/users/library-shares — partages de bibliothèque du compte courant.
 * Renvoie :
 *   sharedWith   — collections auxquelles JE donne l'accès en consultation
 *   sharedWithMe — collections d'autrui auxquelles J'ai reçu l'accès
 */
async function listLibraryShares(req, res, next) {
  try {
    const me = req.user.id;
    const { rows: shared } = await query(
      `SELECT ls.id, ls.scope, ls.created_at, u.id AS uid, u.login, u.first_name, u.last_name, u.email
       FROM library_shares ls JOIN users u ON u.id = ls.granted_to_id
       WHERE ls.owner_id = $1 ORDER BY ls.created_at DESC`,
      [me]
    );
    const { rows: received } = await query(
      `SELECT ls.id, ls.scope, ls.created_at, u.id AS uid, u.login, u.first_name, u.last_name, u.email
       FROM library_shares ls JOIN users u ON u.id = ls.owner_id
       WHERE ls.granted_to_id = $1 ORDER BY ls.created_at DESC`,
      [me]
    );
    return res.json({ sharedWith: shared.map(shareDto), sharedWithMe: received.map(shareDto) });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/users/library-shares — ouverture de l'accès en consultation.
 * Body : { userId, scope, [ownerId] }
 *   - userId  : utilisateur DESTINATAIRE qui reçoit l'accès (requis)
 *   - scope   : « vinyls » | « comics » | « all » (défaut « all »)
 *   - ownerId : propriétaire de la collection (admin uniquement ; défaut = soi)
 * Déclenche l'e-mail n°2 au DESTINATAIRE.
 */
async function createLibraryShare(req, res, next) {
  try {
    const body = req.body || {};
    const recipientId = Number(body.userId);
    const scope = String(body.scope || 'all').trim().toLowerCase();
    if (!recipientId || Number.isNaN(recipientId)) {
      return res.status(400).json({ error: 'Champ requis : userId (utilisateur destinataire).' });
    }
    if (!SHARE_SCOPES.includes(scope)) {
      return res.status(400).json({ error: `Scope invalide (attendu : ${SHARE_SCOPES.join(', ')}).` });
    }

    // Le propriétaire de la collection : par défaut le compte courant ; un
    // ADMIN peut ouvrir l'accès à la collection d'un autre utilisateur.
    const ownerId = req.user.role === 'admin' && body.ownerId
      ? Number(body.ownerId)
      : req.user.id;
    if (ownerId === recipientId) {
      return res.status(400).json({ error: 'Impossible de partager une collection avec soi-même.' });
    }
    // Un non-admin ne peut partager QUE sa propre collection.
    if (req.user.role !== 'admin' && ownerId !== req.user.id) {
      return res.status(403).json({ error: 'Vous ne pouvez partager que votre propre collection.' });
    }

    const { rows: ownerRows } = await query('SELECT * FROM users WHERE id = $1', [ownerId]);
    const owner = ownerRows[0];
    if (!owner) return res.status(404).json({ error: 'Propriétaire de la collection introuvable.' });
    const { rows: recipientRows } = await query('SELECT * FROM users WHERE id = $1', [recipientId]);
    const recipient = recipientRows[0];
    if (!recipient) return res.status(404).json({ error: 'Utilisateur destinataire introuvable.' });

    let share;
    try {
      // Idempotent : re-partager le même (owner, destinataire, scope) met à
      // jour l'horodatage au lieu de créer un doublon (contrainte unique).
      const { rows } = await query(
        `INSERT INTO library_shares (owner_id, granted_to_id, scope, created_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (owner_id, granted_to_id, scope) DO UPDATE SET created_at = now()
         RETURNING *`,
        [ownerId, recipientId, scope, req.user.id]
      );
      share = rows[0];
    } catch (dbErr) {
      if (dbErr.code === '23503') {
        return res.status(400).json({ error: 'Référence utilisateur invalide.' });
      }
      throw dbErr;
    }

    // Déclencheur e-mail n°2 — PARTAGE DE BIBLIOTHÈQUE : notification au
    // DESTINATAIRE qu'un autre utilisateur lui a ouvert l'accès en
    // consultation à sa collection. Envoi NON bloquant (cf. emailService).
    emailService.notifyLibraryShared({
      to: recipient.email,
      recipientName: recipient.first_name,
      ownerName: `${owner.first_name} ${owner.last_name}`.trim(),
      scope: SCOPE_LABELS[scope],
    }).catch(() => {});

    return res.status(201).json({
      share: {
        id: share.id,
        scope: share.scope,
        createdAt: share.created_at,
        user: {
          id: recipient.id,
          login: recipient.login,
          firstName: recipient.first_name,
          lastName: recipient.last_name,
          email: recipient.email,
        },
      },
    });
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /api/users/library-shares/:id — retrait de l'accès en consultation.
 * Seul le PROPRIÉTAIRE de la collection (ou un admin) peut retirer l'accès.
 */
async function deleteLibraryShare(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT * FROM library_shares WHERE id = $1', [id]);
    const share = rows[0];
    if (!share) return res.status(404).json({ error: 'Partage introuvable.' });
    if (req.user.role !== 'admin' && Number(share.owner_id) !== req.user.id) {
      return res.status(403).json({ error: 'Seul le propriétaire ou un administrateur peut retirer cet accès.' });
    }
    await query('DELETE FROM library_shares WHERE id = $1', [id]);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listUsers,
  listAllUsers,
  listPublicUsers,
  getMe,
  createUser,
  updateUser,
  updateMe,
  updateProfileLanguage,
  updateProfileTheme,
  deleteUser,
  listLibraryShares,
  createLibraryShare,
  deleteLibraryShare,
};
