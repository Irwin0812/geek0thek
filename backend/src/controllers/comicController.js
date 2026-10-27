const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { query } = require('../config/db');
const { downloadCoverImage, isLocalCoverPath, searchByIsbn } = require('../utils/isbnClient');
// Client dédié Google Books (clé GOOGLE_BOOKS_API_KEY, erreurs HTTP explicites,
// extraction de série, images de SUBSTITUTION) — requis ici pour l'import
// direct par code-barres (voir importComicByIsbn ci-dessous).
const googleBooks = require('../utils/googleBooksClient');
const {
  SERIES_NO_TITLE_URL,
  SERIES_UPLOAD_SUBDIR,
  findSeries,
  ensureSeries,
  autoFetchSeriesImage,
  removeSeriesImageGlobally,
} = require('../utils/seriesService');
const { canEditItem } = require('../middlewares/auth');

// Garde l'arborescence des uploads en place (volume monté de la VM hôte) :
// le sous-dossier « series/ » peut aussi bien être créé que par multer.
function ensureUploadDirs() {
  try {
    fs.mkdirSync(path.join(env.uploadDir, SERIES_UPLOAD_SUBDIR), { recursive: true });
  } catch {}
}

/**
 * Renvoie le chemin d'accès HTTP d'un fichier déjà stocké dans le volume de
 * uploads (chemin physique `file.path` fourni par multer) : le fichier du
 * champ « seriesImage » a été déposé dans <uploadDir>/series/ (voir
 * middlewares/upload.js, cf. env.seriesUploadDir). Le chemin relatif est
 * calculé sur le volume RACINE `env.uploadDir` — jamais sur le sous-dossier
 * « series/ » : une base relative au sous-dossier le retirait du chemin
 * (« /uploads/series-… » au lieu de « /uploads/series/… »), d'où une image
 * introuvable (404) après enregistrement, des fichiers orphelins jamais
 * reconnus par le nettoyage (`isLocalSeriesPath` attend
 * `/uploads/series/…`) et l'entité Série propagée avec un chemin cassé.
 */
function localSeriesFilePath(file) {
  const rel = path.relative(env.uploadDir, file.path).split(path.sep).join('/');
  return rel && !rel.startsWith('..')
    ? `/uploads/${rel}`
    : `/uploads/${SERIES_UPLOAD_SUBDIR}/${path.basename(file.path)}`;
}

/** Chemin local « /uploads/series/<fichier> » (image portée par une BD). */
function isLocalSeriesPath(value) {
  return (
    typeof value === 'string' &&
    value.startsWith(`/uploads/${SERIES_UPLOAD_SUBDIR}/`)
  );
}

/**
 * Supprime un fichier local d'image de série s'il n'est plus référencé par
 * aucune ligne de la base : les images de série sont PARTAGÉES entre TOUS
 * les tomes / utilisateurs (dédupliqués par nom de série), on ne supprime
 * donc qu'un chemin orphelin.
 */
async function deleteLocalSeriesFileIfOrphan(storedPath) {
  const raw = String(storedPath || '').trim();
  if (!isLocalSeriesPath(raw)) return;
  const rel = raw.slice('/uploads/'.length).split(/[\/\\]/).filter(Boolean).join('/');
  try {
    const stillRef = await query(
      'SELECT 1 FROM comics WHERE series_image = $1 LIMIT 1',
      [raw]
    );
    if (stillRef.rows.length === 0) {
      fs.rmSync(path.join(env.uploadDir, rel), { force: true });
    }
  } catch {}
}

/**
 * Liste TOUS les fichiers reçus sur la route, quelle que soit leur forme
 * dans `req.files`. Multer « fields() » stocke les fichiers sous forme
 * d'OBJET { champ: [fichier…] } : une lecture `Array.isArray(req.files)` y
 * renvoie donc [] et le fichier uploadé était ignoré (réparation definitive
 * du bug « image de série / artiste non sauvegardée »). Les formes
 * ArrayBuffer / ArrayBufferLegacy sont tolérées par sécurité.
 */
function uploadedFilesOf(req) {
  const files = req && req.files;
  if (files == null) return [];
  if (Array.isArray(files)) return files.filter(Boolean);
  if (typeof files === 'object') {
    const out = [];
    Object.keys(files).forEach((key) => {
      const v = files[key];
      if (v == null) return;
      if (Array.isArray(v)) v.forEach((f) => f && out.push(f));
      else if (typeof v === 'object') out.push(v);
    });
    return out;
  }
  return [files];
}

/** Renvoie le fichier du champ « fieldname » reçu par multer (ou null). */
function uploadedFileOf(req, fieldname) {
  return uploadedFilesOf(req).find((f) => f && f.fieldname === fieldname) || null;
}

/**
 * Supprime le fichier « seriesImage » reçu mais NON UTILISÉ (échec de la
 * résolution de l'image de série) : seuls les fichiers du champ séries sont
 * retirés ici — la couverture d'album (« cover ») est gérée séparément par
 * l'appelant (sert à l'insertion même si la série échoue).
 */
function removeUnusedSeriesFiles(files) {
  uploadedFilesOf(files).forEach((f) => {
    if (f && f.fieldname === 'seriesImage') {
      try { fs.rmSync(f.path, { force: true }); } catch {}
    }
  });
}

/**
 * Résout l'image de SÉRIE envoyée par le formulaire « Ajouter / Modifier une
 * BD » et la stocke LOCALEMENT dans le volume de uploads :
 *  - fichier téléversé manuellement (champ "seriesImage") -> déjà sur disque
 *    (multer), on renvoie son chemin d'accès local ;
 *  - field "seriesImageRemoteUrl" (http/https) -> téléchargement distant vers
 *    <uploadDir>/series/ puis chemin local (même pattern que les jaquettes) ;
 *  - un chemin local « /uploads/… » déjà stocké (renvoyé tel quel par le
 *    frontend lors d'une modification sans changement) -> inchangé ;
 *  - sinon null : l'appelant applique alors la chaîne de replis (réutilisation
 *    de l'image de la série existante, recherche automatique Google Books /
 *    Open Library, puis image par défaut `img/no_title.jpg`).
 * @returns {Promise<string|null>} chemin local de l'image, ou null.
 */
async function resolveComicSeriesImage(req, existingImage = null) {
  // ⚠ « fields() » : req.files est un OBJET { champ: [fichier…] } — jamais
  // une liste. La lecture listique (ancienne version) ignorait le fichier.
  const seriesFile = uploadedFileOf(req, 'seriesImage');
  if (seriesFile) {
    // Fichier FRAÎCHEMENT UPLOADÉ par multer (champ « seriesImage ») : il EST
    // la nouvelle image de série, quelle que soit la valeur existante en base.
    // On renvoie SON chemin et l'appelant ÉCRASE l'ancienne valeur
    // (série déclinée comprise) — jamais l'inverse (l'ancienne valeur ne doit
    // JAMAIS évincer le fichier nouvellement stocké, ni déclencher le repli de
    // « conservable » qui ignorerait le téléchargement en cours).
    return localSeriesFilePath(seriesFile);
  }

  const remoteUrlRaw = String(req.body.seriesImageRemoteUrl || '').trim();
  if (/^https?:\/\//i.test(remoteUrlRaw)) {
    // Déjà stocké sous cette forme : on conserve la valeur existante.
    if (remoteUrlRaw === existingImage) return null;
    try {
      const { downloadCoverImageToDir } = require('../utils/musicBrainzClient');
      return await downloadCoverImageToDir(remoteUrlRaw, SERIES_UPLOAD_SUBDIR);
    } catch (err) {
      console.warn(
        `[serie] Téléchargement de l'image de série impossible (${err.message}) : on enchaîne les replis.`
      );
      return null;
    }
  }

  // Chemin local stocké renvoyé tel quel par le frontend lors d'une
  // modification SANS changement d'image : on ne fait rien (l'appelant
  // conserve l'image courante). Toute autre valeur locale inconnue est
  // ignorée (les replis décident ensuite).
  if (remoteUrlRaw && /^\/uploads\//.test(remoteUrlRaw)) {
    const norm = remoteUrlRaw.replace(/^https?:\/\/[^/]+/i, '');
    return norm === existingImage ? null : norm;
  }
  return null;
}

/**
 * Recherche automatique du VISUEL GLOBAL d'une SÉRIE (distinct des
 * couvertures de tomes individuels — cf. seriesService.autoFetchSeriesImage) :
 *   1. série DÉJÀ RÉFÉRENCÉE (même nom normalisé) -> réutilisation de
 *      l'image déjà stockée sur l'entité / les tomes (LA MÊME image pour
 *      tous, y compris le repli img/no_title.jpg déjà attribué — on ne doit
 *      PAS relancer de recherche API « à chaque tome ») ;
 *   2. sinon : métadonnées SÉRIE d'Open Library (logo global), puis Google
 *      Books / Open Library sur le nom de série seul, téléchargées dans
 *      <uploads>/series/ ;
 * EN CAS D'ABSENCE DE RÉSULTAT OU D'ÉCHEC total : repli FORCÉ sur l'image
 * de secours locale img/no_title.jpg (chemin absolu :
 * C:\Users\irwin\geek0thek\img\no_title.jpg, servie sous « /img/no_title.jpg »)
 * — la création de la BD n'est JAMAIS bloquée.
 * @param {string} seriesName nom de la série tel qu'enregistré sur la BD
 * @param {string|null} [forbiddenCover] couverture du TOME en cours : si
 *   l'image déjà référencée par l'entité (réutilisation) lui est IDENTIQUE
 *   (contamination legacy), elle est rejetée au titre même de la dissociation
 *   série/tome — le repli « recherche auto puis img/no_title.jpg » s'applique
 *   à la place ; la couverture du tome ne doit JAMAIS devenir l'image de
 *   série (ni par réutilisation, ni par écriture).
 * @returns {Promise<{seriesId: number|null, image: string, from: 'existing'|'auto'|'fallback'}>}
 *   image : « /uploads/series/<fichier> » (nouveau visuel), l'image déjà
 *   stockée, ou « /img/no_title.jpg » en dernier repli.
 */
async function autoResolveComicSeriesImage(seriesName, forbiddenCover = null) {
  const found = await findSeries(seriesName);
  // RÉUTILISATION de l'image déjà référencée par l'entité — SAUF si elle est
  // interdite (identique à la couverture du TOME en cours) : jamais la
  // jaquette d'un tome en image de série ; dans ce cas on repart sur la
  // recherche automatique (forbiddenCover n'y est pas réappliquée).
  const foundImageForbidden = Boolean(
    forbiddenCover && stripOrigin(found?.image || '') === stripOrigin(forbiddenCover)
  );
  if (found && found.image && !foundImageForbidden) {
    return { seriesId: found.seriesId, image: found.image, from: 'existing' };
  }
  let fetched;
  let from = 'auto';
  try {
    fetched = await autoFetchSeriesImage(seriesName);
  } catch (err) {
    // Non bloquant : les APIs peuvent être en panne sans que la création de
    // la BD doive échouer.
    console.warn('[serie] Image de série indisponible, repli img/no_title.jpg :', err.message);
    fetched = SERIES_NO_TITLE_URL;
    from = 'fallback';
  }
  // Garantie finale : même si le service revenait à vide (fichier introuvable,
  // URL invalide, erreur non levée), la colonne doit TOUJOURS porter le repli
  // propre « /img/no_title.jpg » plutôt qu'une valeur vide.
  if (!fetched) {
    fetched = SERIES_NO_TITLE_URL;
    from = 'fallback';
  }
  return { seriesId: found ? found.seriesId : null, image: fetched, from };
}

/**
 * Synchronise l'entité Série AVANT écriture (INSERT/UPDATE comics), avec les
 * mêmes règles que la photo d'artiste : l'image de série est GLOBALE
 * (dédupliquée par nom normalisé, tous users).
 *  - `seriesImage === null`    : aucune écriture sur l'entité ;
 *  - `syncSharedComics === false` : création / rattachement d'entité SANS
 *        toucher aux autres tomes (le cas où la série a été renommée dans ce
 *        formulaire : on n'écrase pas l'image des tomes de l'autre nom) ;
 *  - sinon : l'entête reçoit l'image, et TOUS les tomes de cette série
 *    (tous users — les lignes legacy sans entité prises en compte par
 *    nom strict) adoptent la même image ; les anciens fichiers locaux
 *    vraiment orphelins sont retirés du volume.
 */
async function syncSeriesEntity(
  seriesName,
  seriesImage = null,
  { seriesId = null, syncSharedComics = true } = {}
) {
  const name = String(seriesName || '').trim();
  if (!name) return { seriesId: null, image: seriesImage };
  if (!seriesImage) return { seriesId, image: seriesImage };

  const ent = await ensureSeries(name, seriesImage);
  const targetId = ent.seriesId;

  // L'image de série est PARTAGÉE : si plusieurs lignes existantes portaient
  // d'autres images LOCALES (path /uploads/series/…), on les retire du volume
  // uniquement si plus AUCUNE ligne ne les référence.
  if (targetId != null && syncSharedComics) {
    const oldFiles = await query(
      `SELECT DISTINCT series_image AS img FROM comics
       WHERE series_image LIKE '/uploads/series/%' AND
         ((series_id = $1 AND series_image IS NOT NULL) OR (series_id IS NULL AND btrim(series) = $2))`,
      [targetId, name]
    );
    await query(
      `UPDATE comics SET series_image = $3
       WHERE (series_id = $1 AND series_image IS NOT NULL) OR (series_id IS NULL AND btrim(series) = $2)`,
      [targetId, name, seriesImage]
    );
    for (const r of oldFiles.rows) {
      if (r.img && r.img !== seriesImage) await deleteLocalSeriesFileIfOrphan(r.img);
    }
  }
  return { seriesId: targetId, image: seriesImage };
}

/**
 * Normalise un chemin de couverture stocké en base.
 * Répare les formats legacy écrits par d'anciennes versions :
 *  - "/comics/<fichier>" -> "/uploads/comics/<fichier>" ;
 *  - une URL complète servie par ce site (http://…/uploads/comics/…)
 *    -> chemin local.
 * Les chemins déjà valides et les vraies URL distantes sont inchangés.
 * (La comparaison série/couverture de seriesImageUrlOf retire elle-même le
 * préfixe d'origine des valeurs absolues, sans toucher au comportement.)
 */
function normalizeStoredCoverPath(value) {
  const raw = String(value || '').trim();
  if (/^https?:\/\//i.test(raw)) {
    const idx = raw.indexOf('/uploads/');
    return idx >= 0 ? raw.slice(idx) : raw;
  }
  if (!raw || raw.startsWith('/uploads/')) return raw;
  if (raw.startsWith('/')) {
    const rel = raw.slice(1).split('/').filter(Boolean).join('/');
    return rel ? `/uploads/${rel}` : raw;
  }
  return raw;
}

/**
 * Lecture d'un booléen POSTé : JSON (true/false) ou formulaire/multipart
 * (chaînes "true"/"false"). Toutes les autres valeurs -> false.
 */
function asBoolean(value) {
  return value === true || String(value).toLowerCase() === 'true';
}

/**
 * « Date d'ajout » envoyée par le frontend (input type="date") :
 * extrait le AAAA-MM-JJ strict, tolère une date ISO complète.
 * Renvoie null si absente / invalide (le créant applique alors défaut = aujourd'hui).
 */
function parseAddedDate(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
}

/** Détache le préfixe d'origine (https://site/…) d'une valeur stockée. */
function stripOrigin(value) {
  return String(value || '').replace(/^https?:\/\/[^/]+/i, '');
}

/**
 * Image de SÉRIE exposée par l'API (champ `seriesImageUrl` du DTO) —
 * dissociation TOTALE et définitive avec la couverture du tome :
 *  - colonne `comics.series_image` vide/null en base -> `null` EXPLICITE
 *    (le frontend retombe alors sur l'image par défaut img/no_title.jpg) ;
 *  - valeur identique à la couverture du TOME (`cover_url`, y compris avec
 *    pollution legacy : mêmes chemins, préfixe d'origine mis à part) ->
 *    `null` également. L'API ne renvoie JAMAIS la couverture du tome en
 *    tant qu'image de série.
 */
function seriesImageUrlOf(row) {
  const raw = String(row.series_image || '').trim();
  if (!raw) return null;
  const cover = stripOrigin(normalizeStoredCoverPath(row.cover_url));
  if (cover && stripOrigin(raw) === cover) return null;
  return raw;
}

/**
 * Valeur de `series_image` CONSERVABLE lors d'une modification : identique à
 * seriesImageUrlOf mais appliqué à des valeurs brutes (existantes vs couverture
 * courante) — utilisé pour ne jamais « conserver » via le COALESCE une image
 * de série qui serait en réalité la couverture du tome.
 */
function conservableSeriesImage(storedValue, coverValue) {
  return seriesImageUrlOf({ series_image: storedValue, cover_url: coverValue });
}

/**
 * Passage de la ligne SQL (snake_case) au DTO consommé par le frontend.
 */
function toComicDto(row) {
  return {
    id: row.id,
    userId: row.user_id,
    // Normalise les chemins legacy (ex. "/comics/…" sans préfixe "/uploads")
    // pour que l'image soit servie par le volume statique /uploads.
    coverUrl: normalizeStoredCoverPath(row.cover_url),
    title: row.title,
    series: row.series,
    // Image / logo de l'ENTITÉ SÉRIE (colonne comics.series_image — portée PAR
    // BD, même pattern que la jaquette) : null si aucune série pour cette BD.
    // Le frontend reçoit aussi « /img/no_title.jpg » (image locale par défaut
    // servie statiquement) quand l'image auto ou uploadée est absente.
    // DISSOCIATION STRICTE : cette valeur ne sera JAMAIS la couverture du tome
    // (cover_url) — colonne vide ou valeur = couverture -> null explicite
    // (voir seriesImageUrlOf).
    seriesImageUrl: seriesImageUrlOf(row),
    tomeNumber: row.tome_number,
    authors: row.authors,
    illustrators: row.illustrators,
    publisher: row.publisher,
    releaseDate: row.release_date,
    genre: row.genre,
    isbn: row.isbn,
    synopsis: row.synopsis,
    // Conservé pour rétro-compat d'affichage (le formulaire ne le gère plus :
    // il a été remplacé par la date d'ajout).
    condition: row.condition,
    isSpecialEdition: Boolean(row.is_special_edition),
    // « Livre dédicacé » (case à cocher du formulaire)
    isSigned: Boolean(row.is_signed),
    // Remplace l'ancien champ « état » : date d'ajout à la collection.
    addedDate: row.added_date,
    createdAt: row.created_at,
  };
}

/**
 * Valide les champs d'une BD. Retourne { error } ou { values }.
 */
function cleanComic(body) {
  const title = String(body.title || '').trim();
  const authors = String(body.authors || '').trim();
  const publisher = String(body.publisher || '').trim();
  if (!title || !authors || !publisher) {
    return {
      error: 'Les champs Titre, Auteur(s) et Éditeur sont obligatoires.',
    };
  }
  const values = {
    title,
    series: body.series ? String(body.series).trim() : null,
    tomeNumber: body.tome_number || body.tomeNumber ? String(body.tome_number || body.tomeNumber).trim() : null,
    authors,
    illustrators: body.illustrators ? String(body.illustrators).trim() : null,
    publisher,
    releaseDate: body.release_date || body.releaseDate ? String(body.release_date || body.releaseDate).trim() : null,
    genre: body.genre ? String(body.genre).trim() : null,
    isbn: body.isbn ? String(body.isbn).replace(/[^0-9Xx]/g, '').trim() || null : null,
    synopsis: body.synopsis ? String(body.synopsis).trim() : null,
    // « Livre dédicacé » (case à cocher) : booléen is_signed.
    isSigned: asBoolean(body.is_signed ?? body.isSigned),
    // Remplace l'ancien champ « État » : date d'ajout de la BD à la
    // collection (AAAA-MM-JJ). Peut être null -> le SQL insère CURRENT_DATE.
    addedDate: parseAddedDate(body.added_date || body.addedDate),
    isSpecialEdition: asBoolean(body.is_special_edition ?? body.isSpecialEdition),
  };
  return { values };
}

/**
 * Détermine la couverture finale :
 * - fichier téléversé (field "cover")        -> /uploads/comics/<fichier>
 * - field "coverRemoteUrl" (http...)         -> téléchargement et stockage local
 * - field "coverRemoteUrl" = chemin local existant (aucune nouvelle couverture)
 *   -> undefined : l'appelant conserve la couverture existante
 * - rien (null)                               -> null / aucune couverture
 *
 * @returns {Promise<string|null|undefined>}
 *   - chemin "/uploads/comics/<fichier>" (nouvelle couverture)
 *   - null       (aucune couverture — création sans couverture, ou échec
 *                 du téléchargement d'une URL distante)
 *   - undefined  (aucune modification demandée : on garde celle d'avant)
 */
async function resolveComicCover(req, existingCover = null) {
  // Le formulaire « Ajouter / Modifier une BD » peut porter DEUX fichiers
  // (cover + seriesImage, cf. routes/comicRoutes.js upload.fields) : on
  // retient strictement le champ « cover ».
  // ⚠ « fields() » : req.files est un OBJET { champ: [fichier…] } — jamais
  // une liste (uploadedFilesOf gère les deux formes).
  const files = uploadedFilesOf(req);
  // DISSOCIATION série/tome : on ne retient JAMAIS un fichier du champ
  // « seriesImage » en couverture du volume. Sans cette garde, un upload
  // d'IMAGE DE SÉRIE SEUL (aucun fichier « cover ») retombe sur files[0]
  // et écrirait le logo de série dans la colonne cover_url — exactement la
  // confusion qu'il faut empêcher. Un champ nommé « cover » prime toujours ;
  // tout autre fichier (compat legacy : champ sans nom / premier déposé) est
  // conservé comme couverture s'il n'est pas l'image de série.
  const coverFile =
    files.find((f) => f.fieldname === 'cover') ||
    files.find((f) => f.fieldname !== 'seriesImage');
  if (coverFile) {
    // Multer route vers uploads/comics/ (voir middlewares/upload.js) : on
    // retourne le chemin d'accès HTTP exact "/uploads/comics/<fichier>"
    // (monter le chemin SANS le préfixe "/uploads" faisait pointer le client
    // vers <origine>/comics/… qui n'existe pas : image qui disparaît après
    // enregistrement).
    const rel = path.relative(env.uploadDir, coverFile.path).split(path.sep).join('/');
    return rel ? `/uploads/${rel}` : `/uploads/comics/${path.basename(coverFile.path)}`;
  }
  const remoteUrl = normalizeStoredCoverPath(req.body.coverRemoteUrl);
  if (!remoteUrl) {
    return undefined; // pas de nouvelle couverture demandée
  }
  // Chemin local existant renvoyé tel quel par le frontend lors d'une
  // modification sans changement de couverture (éventuellement préfixé par
  // l'origine) : on ne télécharge rien et on conserve la couverture actuelle
  // (downloadCoverImage ne renverrait que null pour une URL qui n'est pas
  // http/https, ce qui viderait la colonne cover_url — d'où l'erreur
  // « image qui ne s'affiche plus »).
  if (!/^https?:\/\//i.test(remoteUrl) || remoteUrl === normalizeStoredCoverPath(existingCover)) {
    return undefined;
  }
  return downloadCoverImage(remoteUrl);
}

function isLocalVinylCoverPath(value) {
  return typeof value === 'string' && value.startsWith('/uploads/');
}

/**
 * Supprime le fichier local de couverture s'il existe.
 * Gère les chemins "/uploads/comics/<fichier>" (nouveaux) et les anciens
 * "/uploads/<fichier>" stockés avant le sous-dossier "comics/".
 */
function removeLocalCover(coverUrl) {
  const raw = normalizeStoredCoverPath(coverUrl);
  if (!isLocalCoverPath(raw) && !isLocalVinylCoverPath(raw)) return;
  const rel = raw.slice('/uploads/'.length).split(/[\/\\]/).filter(Boolean).join('/');
  if (!rel) return;
  const candidates = [
    path.join(env.uploadDir, rel),
    path.join(env.uploadDir, 'comics', rel),
    path.join(env.uploadDir, path.basename(rel)),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        fs.rmSync(candidate, { force: true });
        return;
      }
    } catch {}
  }
  if (isLocalCoverPath(raw)) {
    try {
      // Compat legacy (ancien comportement : sans le sous-dossier "comics/")
      fs.rmSync(path.join(env.uploadDir, path.relative('/uploads', raw)), { force: true });
    } catch {}
  }
}

// ------------------------------------------------------------
// GET /api/comics — collection BD de l'utilisateur courant
// ?q= recherche sur titre, auteurs, éditeur, série, ISBN
// ------------------------------------------------------------
async function listMyComics(req, res, next) {
  try {
    const q = String(req.query.q || '').trim();
    let sql = 'SELECT * FROM comics WHERE user_id = $1';
    const params = [req.user.id];
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (title ILIKE $2 OR authors ILIKE $2 OR publisher ILIKE $2
                    OR series ILIKE $2 OR isbn ILIKE $2)`;
    }
    sql += ' ORDER BY created_at DESC';
    const { rows } = await query(sql, params);
    return res.json({ comics: rows.map(toComicDto), total: rows.length });
  } catch (err) {
    return next(err);
  }
}

// ------------------------------------------------------------
// GET /api/comics/user/:userId — collection BD d'un UTILISATEUR DONNÉ
// Propriétaire ou admin uniquement (l'admin gère toutes les collections).
// ------------------------------------------------------------
async function listComicsByUser(req, res, next) {
  try {
    const userId = Number(req.params.userId);
    if (!canEditItem(req.user, userId)) {
      return res.status(403).json({ error: 'Accès réservé au propriétaire ou à un administrateur.' });
    }
    const q = String(req.query.q || '').trim();
    let sql = 'SELECT * FROM comics WHERE user_id = $1';
    const params = [userId];
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (title ILIKE $2 OR authors ILIKE $2 OR publisher ILIKE $2
                    OR series ILIKE $2 OR isbn ILIKE $2)`;
    }
    sql += ' ORDER BY created_at DESC';
    const { rows } = await query(sql, params);
    const { rows: ownerRows } = await query(
      'SELECT id, login, first_name, last_name FROM users WHERE id = $1',
      [userId]
    );
    const owner = ownerRows[0] || { id: userId, login: '—', firstName: '', lastName: '' };
    return res.json({
      comics: rows.map(toComicDto),
      total: rows.length,
      owner: {
        id: owner.id,
        login: owner.login,
        firstName: owner.firstName,
        lastName: owner.lastName,
      },
    });
  } catch (err) {
    return next(err);
  }
}

// ------------------------------------------------------------
// GET /api/comics/public/user/:userId — BD d'une collection publique
// (visible uniquement si l'utilisateur a activé la visibilité publique)
// ------------------------------------------------------------
async function listPublicComicsByUser(req, res, next) {
  try {
    const userId = Number(req.params.userId);
    const { rows } = await query(
      'SELECT id, first_name, last_name, is_public, share_comics FROM users WHERE id = $1',
      [userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable.' });
    }
    if (!rows[0].is_public) {
      return res.status(403).json({ error: 'Cette collection est privée.' });
    }
    // Partage granulaire : l'utilisateur peut partager ses disques ET masquer
    // ses BD — la page publique ne doit alors renvoyer qu'un [] neutre
    // (les appels se font en parallèle sans savoir ce que chaque user partage).
    if (rows[0].share_comics === false) {
      return res.json({
        owner: { firstName: rows[0].first_name, lastName: rows[0].last_name },
        comics: [],
        total: 0,
      });
    }

    const result = await query(
      'SELECT * FROM comics WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    return res.json({
      owner: { firstName: rows[0].first_name, lastName: rows[0].last_name },
      comics: result.rows.map(toComicDto),
      total: result.rows.length,
    });
  } catch (err) {
    return next(err);
  }
}

// ------------------------------------------------------------
// GET /api/comics/:id — détail d'une BD (propriétaire ou admin)
// ------------------------------------------------------------
async function getComic(req, res, next) {
  try {
    const id = Number(req.params.id);
    let sql = 'SELECT * FROM comics WHERE id = $1';
    const params = [id];
    if (req.user.role !== 'admin') {
      sql += ' AND user_id = $2';
      params.push(req.user.id);
    }
    const { rows } = await query(sql, params);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'BD introuvable.' });
    }
    return res.json({ comic: toComicDto(rows[0]) });
  } catch (err) {
    return next(err);
  }
}

// ------------------------------------------------------------
// POST /api/comics — création (couverture en multipart ou URL distante,
// image de série uploadée manuellement (champ "seriesImage") ou automatique)
// ------------------------------------------------------------
async function createComic(req, res, next) {
  try {
    const { error, values } = cleanComic(req.body);
    if (error) return res.status(400).json({ error });

    // undefined (pas de champ couverture) devient null : colonne nullable,
    // jamais un paramètre SQL indéfini.
    const coverUrl = (await resolveComicCover(req, null)) ?? null;

    // --------------------------------------------------------------
    // IMAGE DE SÉRIE (image / logo) — portée par la colonne
    // `comics.series_image` : 1. si le formulaire en fournit une
    // (champ "seriesImage" ou URL distante), elle est utilisée ;
    // 2. sinon, série DÉJÀ RÉFÉRENCÉE (autre BD du même nom) : on
    //    réutilise l'image déjà stockée — tous les tomes d'une série
    //    affichent LA MÊME image ;
    // 3. sinon : recherche automatique d'une image / logo (Open Library,
    //    Google Books) téléchargée localement ; en cas d'ABSENCE DE
    //    RÉSULTAT OU D'ÉCHEC : repli PROPRE sur l'image locale par défaut
    //    img/no_title.jpg. La création de la BD n'est JAMAIS bloquée.
    // L'ENTITÉ SÉRIE (table `series`) est créée / mise à jour en même temps.
    // --------------------------------------------------------------
    let seriesId = null;
    let seriesImage = values.series ? SERIES_NO_TITLE_URL : null;
    // Image de SÉRIE fournie par le formulaire — connue AVANT le try pour que
    // le catch ci-dessous (panne de propagation à l'entité syncSeriesEntity)
    // sache ce qu'il DOIT conserver : une image manuelle RÉSOLUE avec succès
    // (fichier fraîchement uploadé par multer, OU URL distante déjà téléchargée
    // sur le volume) EST le choix de l'utilisateur : elle est écrite sur la
    // ligne même si syncSeriesEntity échoue — jamais supprimée ni remplacée par
    // le repli img/no_title.jpg (sinon le fichier uploadé/téléchargé serait un
    // orphelin jamais référencé). Un chemin local RENVOYÉ TEL QUEL par le
    // frontend (édit sans changement) n'est PAS compté comme nouveau — il est
    // déjà la valeur courante, rien à écrire. Seule une résolution EN COURS
    // d'échec (téléchargement qui échoue en interne -> null) retombe sur le
    // repli : rien n'est écrit alors.
    let manualSeriesImage = null;
    let manualKeepOnCatch = false;
    if (values.series) {
      try {
        ensureUploadDirs();
        manualSeriesImage = await resolveComicSeriesImage(req, null);
        // Toute image manuelle RÉSOLUE (fichier fraîchement uploadé OU URL
        // distante déjà téléchargée sur le volume) est le choix de l'utilisateur :
        // le catch ci-dessous la conserve et l'écrit si syncSeriesEntity échoue.
        if (manualSeriesImage) manualKeepOnCatch = true;
        let resolvedImage = null; // valeur finale avant écriture
        if (manualSeriesImage) {
          // 1) Image MANUELLE fournie par le formulaire : elle prime.
          resolvedImage = manualSeriesImage;
        } else {
          // 2/3) Série référencée -> réutilisation ; sinon recherche auto,
          // repli propre img/no_title.jpg. La couverture du TOME est passée en
          // interdiction : une image de série identique à la jaquette n'est
          // JAMAIS réutilisée (dissociation totale).
          const resolved = await autoResolveComicSeriesImage(values.series, coverUrl);
          resolvedImage = resolved.image;
        }
        // GARDE-FOU série/tome (DANS createComic) : jamais la couverture du
        // TOME dans la colonne series_image (upload volontairement identique
        // compris) -> valeur NULLE au lieu de l'image contestée, et le
        // fichier uploadé éventuel est retiré. Contrôle APPLIQUÉ AVANT
        // syncSeriesEntity : sinon l'entité SÉRIE aurait déjà propagé la
        // jaquette à tous les tomes du même nom.
        if (resolvedImage && coverUrl && stripOrigin(resolvedImage) === stripOrigin(coverUrl)) {
          console.warn(`[serie] Refus d'inscrire la couverture du tome dans series_image (${resolvedImage}) : aucun stockage de l'image de série pour cette BD.`);
          const upFiles = uploadedFilesOf(req);
          const rejectedFile = upFiles.find((f) => f.fieldname === 'seriesImage');
          if (rejectedFile) {
            try { fs.rmSync(rejectedFile.path, { force: true }); } catch {}
          }
          resolvedImage = null;
          // Fichier rejeté (et retiré du volume) : plus rien à conserver — le
          // catch ci-dessous ne doit pas réécrire une image dont le fichier est
          // déjà détruit.
          manualKeepOnCatch = false;
        }
        seriesImage = resolvedImage;
        // Création / rattachement de l'entité SÉRIE + propagation de l'image
        // à TOUS les tomes déjà enregistrés sous ce nom (tous users).
        if (seriesImage) {
          const synced = await syncSeriesEntity(values.series, seriesImage);
          seriesId = synced.seriesId || null;
        } else {
          // Aucune image valide pour cette BD (upload rejeté par la garde
          // série/tome ci-dessus) : le tome reste RATTACHÉ à son entité
          // (série) — mais sans ÉCRIRE d'image sur l'entité : jamais la
          // couverture du tome, jamais de réécriture des autres tomes.
          try {
            const ent = await ensureSeries(values.series, null);
            seriesId = ent.seriesId || null;
          } catch {}
        }
      } catch (err) {
        // Non bloquant : toute panne (base non migrée « series… », APIs
        // injoignables…) n'empêche JAMAIS la création de la BD.
        console.warn(
          '[serie] Résolution de l\'image de série impossible — choix de ' +
            'l\'utilisateur conservé si une image manuelle a été résolue, ' +
            'sinon repli ' + SERIES_NO_TITLE_URL + ' :',
          err.message
        );
        if (manualKeepOnCatch && manualSeriesImage) {
          // Image manuelle DÉJÀ RÉSOLUE sur disque (fichier uploadé par multer
          // OU URL distante téléchargée) : elle EST le choix de l'utilisateur —
          // elle est CONSERVÉE et ÉCRITE sur la ligne, jamais supprimée ni
          // remplacée par img/no_title.jpg (la propagation à l'entité se
          // retentera au prochain enregistrement d'un tome de cette série).
          // ⚠ Ne PAS appeler removeUnusedSeriesFiles ici : elle supprimerait
          // le fichier que nous écrivons.
          seriesId = null; // entité non rattachée pour l'instant
          seriesImage = manualSeriesImage;
        } else {
          // Rien à conserver (échec du téléchargement d'une URL distante, ou
          // upload rejeté par la garde-fou série/tome) : nettoyage éventuel +
          // repli propre.
          removeUnusedSeriesFiles(req.files);
          seriesImage = SERIES_NO_TITLE_URL;
        }
      }
    }

    // GARDE-FOU série/tome : jamais la couverture du TOME dans la
    // colonne series_image (upload volontairement identique sur les deux
    // champs compris) -> colonne laissée NULL, l'affichage retombe sur le
    // repli propre img/no_title.jpg. La dissociation est totale.
    if (seriesImage && coverUrl && stripOrigin(seriesImage) === stripOrigin(coverUrl)) {
      console.warn(`[serie] Refus d'inscrire la couverture du tome dans series_image (${seriesImage}) : colonne laissée NULL.`);
      seriesImage = null;
    }

    // ⚠ added_date / acquired_date (vinyls) : NOT NULL DEFAULT CURRENT_DATE.
    // Un paramètre NULL envoyé EXPLICITEMENT l'emporte sur le DEFAULT de la
    // colonne -> « null value in column "acquired_date" violates not-null
    // constraint ». On applique donc la COALESCE dans le SQL lui-même :
    // valeur fournie -> conservée, sinon CURRENT_DATE.
    const { rows } = await query(
      `INSERT INTO comics (user_id, cover_url, title, series, tome_number,
                           authors, illustrators, publisher, release_date,
                           genre, isbn, synopsis, is_special_edition, is_signed, added_date,
                           series_id, series_image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               COALESCE($15, CURRENT_DATE), $16, $17)
       RETURNING *`,
      [
        req.user.id,
        coverUrl,
        values.title,
        values.series,
        values.tomeNumber,
        values.authors,
        values.illustrators,
        values.publisher,
        values.releaseDate,
        values.genre,
        values.isbn,
        values.synopsis,
        values.isSpecialEdition,
        values.isSigned,
        // « Date d'ajout » : null si le formulaire n'en fournit pas ->
        // la colonne prend CURRENT_DATE (défaut d'aujourd'hui).
        values.addedDate || null,
        // ENTITÉ SÉRIE : id (null si la table `series` est absente — cf.
        // auto-migration « series.table » de config/db.js) + image / logo
        // avec repli propre « /img/no_title.jpg ». Colonne TEXT : jamais
        // null en base quand une série est renseignée (pas de COALESCE).
        seriesId,
        seriesImage,
      ]
    );
    return res.status(201).json({ comic: toComicDto(rows[0]) });
  } catch (err) {
    // Nettoie les fichiers téléversés si l'insertion échoue.
    uploadedFilesOf(req).forEach((f) => {
      if (f && f.path) { try { fs.rmSync(f.path, { force: true }); } catch {} }
    });
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Une BD avec cet ISBN existe déjà dans votre collection.' });
    }
    return next(err);
  }
}

// ------------------------------------------------------------
// PUT /api/comics/:id — modification (couverture remplaçable, image de série
// remplaçable par upload manuel « seriesImage » ou recherche automatique)
// ------------------------------------------------------------
async function updateComic(req, res, next) {
  try {
    const id = Number(req.params.id);
    let checkSql = 'SELECT * FROM comics WHERE id = $1';
    const checkParams = [id];
    if (req.user.role !== 'admin') {
      checkSql += ' AND user_id = $2';
      checkParams.push(req.user.id);
    }
    const { rows } = await query(checkSql, checkParams);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'BD introuvable.' });
    }
    const existing = rows[0];

    // --------------------------------------------------------------
    // IMAGE DE SÉRIE UPLOADÉE MANUELLEMENT — PRIORITÉ ABSOLUE :
    // dès qu'un fichier « seriesImage » est présent dans la requête
    // (multipart/form-data via multer, cf. routes/comicRoutes.js), son
    // chemin de stockage local est récupéré IMMÉDIATEMENT — avant toute
    // lecture du body, résolution de couverture ou logique de repli. La
    // requête SQL UPDATE ci-dessous met alors EXPLICITEMENT la colonne
    // `comics.series_image` à ce chemin (bloc « PRIORITÉ ABSOLUE » après
    // l'UPDATE), et toute étape susceptible de l'écraser par NULL (drapeau
    // remove_series_image, purge auto-réparation, contamination legacy) ou
    // de la replacer par l'ancienne image (COALESCE « conserver ») est
    // neutralisée dès que ce chemin a été écrit. Jamais l'inverse : le
    // fichier fraîchement stocké n'est ni supprimé, ni évincé.
    // --------------------------------------------------------------
    // ⚠ « fields() » : req.files est un OBJET { champ: [fichier…] } — jamais
    // une liste (uploadedFilesOf gère les deux formes). Avant cette correction,
    // la lecture listique ne trouvait JAMAIS le fichier : il restait déposé sur
    // disque (orphan) et la colonne série était ignorée / replacée.
    const manualSeriesFile = uploadedFileOf(req, 'seriesImage');
    const manualSeriesUploadPath = manualSeriesFile ? localSeriesFilePath(manualSeriesFile) : null;

    const { error, values } = cleanComic({
      ...req.body,
      title: req.body.title || existing.title,
      authors: req.body.authors || existing.authors,
      publisher: req.body.publisher || existing.publisher,
    });
    if (error) return res.status(400).json({ error });

    // ------------------------------------------------------------
    // SUPPRESSION EXPLICITE des images (bouton « Retirer le fichier » du
    // formulaire « Modifier la BD ») — drapeaux booléens envoyés par le
    // frontend (FormData ou JSON, "true"/true) :
    //  - remove_cover=true        -> colonne cover_url   ÉCRASÉE par NULL ;
    //  - remove_series_image=true -> colonne series_image ÉCRASÉE par NULL
    //      (jamais l'ancienne image, jamais la couverture du TOME) — l'affichage
    //      retombe sur le repli propre img/no_title.jpg, exactement comme une
    //      série jamais illustrée.
    // Ils PRIMENT sur toute autre donnée de la requête (fichier « cover » /
    // « seriesImage », URL distante, chemin local repassé tel quel) : sans
    // cette garde, le COALESCE de l'UPDATE ci-dessous — ou le repli
    // « conserve l'image courante » via coverRemoteUrl — réexposerait
    // l'image que l'utilisateur vient de retirer.
    // ------------------------------------------------------------
    const wantRemoveCover = asBoolean(req.body.remove_cover ?? req.body.removeCover);
    const wantRemoveSeriesImage = asBoolean(
      req.body.remove_series_image ?? req.body.removeSeriesImage
    );

    let coverUrl = existing.cover_url;
    if (wantRemoveCover) {
      // SUPPRESSION EXPLICITE de la couverture : NULL forcé sur cover_url.
      // Un fichier « cover » fourni malgré le drapeau est retiré du volume,
      // et l'ancienne jaquette locale est nettoyée (chemin par BD — jamais
      // partagé avec une autre ligne).
      const upFiles = uploadedFilesOf(req);
      const rejectedCover = upFiles.find((f) => f.fieldname !== 'seriesImage');
      if (rejectedCover) {
        try { fs.rmSync(rejectedCover.path, { force: true }); } catch {}
      }
      if (existing.cover_url) removeLocalCover(existing.cover_url);
      coverUrl = null;
    } else {
      const newCover = await resolveComicCover(req, existing.cover_url);
      if (newCover !== undefined) {
        // Nouvelle couverture demandée (upload multipart ou URL distante).
        // newCover vaut le chemin stocké final ("/uploads/comics/…" ou null —
        // null uniquement si le téléchargement de l'URL distante a échoué,
        // auquel cas on conserve la couverture existante).
        if (newCover === null && existing.cover_url) {
          coverUrl = existing.cover_url;
        } else {
          coverUrl = newCover ?? null;
          // Supprime l'ancienne couverture locale si le nouveau chemin stocké
          // diffère (chaque upload / téléchargement génère un nom aléatoire).
          if (coverUrl !== existing.cover_url) {
            removeLocalCover(existing.cover_url);
          }
        }
      }
    }

    // --------------------------------------------------------------
    // IMAGE DE SÉRIE (image / logo) — portée par la colonne
    // `comics.series_image`, GLOBALE par nom de série normalisé (mêmes règles
    // que la photo d'artiste, cf. « ENTITÉ ARTISTE » de vinylController.js) :
    //  - série DÉCLARÉE + image manuelle fournie ("seriesImage" / URL) :
    //    elle remplace l'image de la SÉRIE (entité + TOUS les tomes du même
    //    nom, tous users, y compris les lignes legacy prises en compte par nom
    //    strict) ; l'ancien fichier local orphelin est nettoyé ;
    //  - série DÉCLARÉE, aucun changement demandé : on conserve l'image
    //    courante (aucune requête API, aucune réécriture) ; une ligne legacy
    //    sans entité est simplement rattachée à son entité existante ;
    //  - série DÉCLARÉE avec image absente ou NOM RENOMMÉ (nom inconnu) :
    //    recherche automatique Open Library / Google Books, téléchargement
    //    local, repli propre img/no_title.jpg — l'entité reçoit l'image et
    //    tous les tomes du même nom l'adoptent ;
    //  - série VIDE : reset des colonnes du tome vers NULL (après l'UPDATE,
    //    le fichier local n'est retiré qu'une fois devenu orphelin — il est
    //    partagé avec les autres tomes de l'ancien nom).
    // Aucune étape n'est bloquante : en cas d'échec, on répond simplement
    // avec la situation en base conservée (COALESCE).
    // --------------------------------------------------------------
    let seriesIdToWrite = null; // null -> COALESCE : id d'entité courant conservé
    let seriesImageToWrite = null; // null -> COALESCE : image courante conservée
    // Image de SÉRIE fournie par le formulaire — connue AVANT le try pour que
    // le catch ci-dessous (panne de propagation à l'entité syncSeriesEntity)
    // sache ce qu'il DOIT conserver : un fichier FRAICHEMENT UPLOADÉ par multer
    // (ou une URL distante déjà téléchargée sur le volume) EST le choix de
    // l'utilisateur : il est écrit sur la ligne même si syncSeriesEntity échoue
    // — jamais supprimé ni remplacé par l'image courante conservée au COALESCE.
    // Un chemin local renvoyé tel quel (édit sans changement d'image) n'est PAS
    // compté comme nouveau : rien à écrire alors (COALESCE suffit).
    let manualSeriesImage = null;
    let manualKeepOnCatch = false;
    const renamedSeries = Boolean(values.series) && values.series !== existing.series;
    // Image de série courante CONSERVABLE (jamais la couverture du TOME, même
    // contaminée legacy) : référence unique des comparaisons de cette branche
    // (« nouvelle image fournie ? », « rien ne change -> on conserve »).
    const existingConservableImage = conservableSeriesImage(
      existing.series_image,
      coverUrl
    );

    if (!manualSeriesUploadPath && wantRemoveSeriesImage) {
      // ------------------------------------------------------------
      // SUPPRESSION EXPLICITE de l'image de série (bouton « Retirer le
      // fichier » du formulaire) — NÉGLIGÉE dès qu'un nouveau fichier
      // « seriesImage » est présent dans la MÊME requête : le téléversement
      // manuel a LA PRIORITÉ ABSOLUE (remplacement, jamais suppression).
      // Colonne series_image de CETTE LIGNE :
      // ÉCRASÉE par NULL — l'ancienne image n'est plus conservée, JAMAIS la
      // couverture du TOME qui ne remplit jamais la colonne (dissociation
      // série/tome totale). NULL ne pouvant traverser le COALESCE SQL du UPDATE
      // principal (null = « conserver »), la purge est faite explicitement
      // APRÈS l'UPDATE (bloc « PURGE / AUTO-RÉPARATION des colonnes série »
      // ci-dessous, déclenché par ce drapeau) : plus aucune image n'est portée
      // ni réutilisable au prochain enregistrement (recherches auto comprises),
      // et l'affichage (tome + tuile) retombe sur le repli propre
      // img/no_title.jpg — exactement ce que le formulaire montre après la
      // suppression. Un fichier « seriesImage » fourni malgré le drapeau ne
      // rétablit AUCUNE image (retiré du volume). Propagation GLOBALE (entité
      // Série + TOUS les tomes du même nom, tous users, lignes legacy
      // comprises) via removeSeriesImageGlobally — ancien fichier local
      // orphelin nettoyé.
      // ------------------------------------------------------------
      seriesIdToWrite = null; // COALESCE : l'entité SÉRIE reste rattachée au tome
      const upFiles = uploadedFilesOf(req);
      const rejectedFile = upFiles.find((f) => f.fieldname === 'seriesImage');
      if (rejectedFile) {
        try { fs.rmSync(rejectedFile.path, { force: true }); } catch {}
      }
      if (values.series) {
        try {
          await removeSeriesImageGlobally(values.series, existing.series_id || null);
        } catch (err) {
          // Non bloquant (base non migrée « série… ») : la purge NULL de la
          // ligne courante ci-dessous s'applique quand même.
          console.warn(`[serie] Purge globale de l'image de série impossible (« ${values.series} ») :`, err.message);
        }
      } else {
        // Série vide (cas pathologique — le formulaire ne propose pas la
        // suppression dans ce contexte) : la purge explicite ci-dessous force
        // NULL sur ce tome après l'UPDATE.
      }
    } else if (values.series) {
      try {
        ensureUploadDirs();
        // Comparaison « même image envoyée / déjà stockée » : sur la valeur
        // CONSERVABLE (jamais la couverture du tome) pour que le détecteur
        // de « sans changement » ne considère jamais une couverture dupliquée.
        manualSeriesImage = await resolveComicSeriesImage(
          req,
          existingConservableImage || null
        );
        // Toute image manuelle RÉSOLUE (fichier fraîchement uploadé OU URL
        // distante déjà téléchargée) est le choix de l'utilisateur : le catch
        // ci-dessous la conserve et l'écrit si syncSeriesEntity échoue.
        if (manualSeriesImage) manualKeepOnCatch = true;
        // GARDE-FOU série/tome (upload manuel) : une image de série identique
        // à la couverture du TOME est rejetée AVANT toute propagation à
        // l'entité — elle est traitée comme si aucune image n'avait été
        // fournie (les replis ci-dessous décident alors). Fichier retiré.
        if (manualSeriesImage && stripOrigin(manualSeriesImage) === stripOrigin(coverUrl)) {
          console.warn(`[serie] Refus d'inscrire la couverture du tome dans series_image (${manualSeriesImage}) : image manuelle ignorée.`);
          const rejectedFile = uploadedFileOf(req, 'seriesImage');
          if (rejectedFile) {
            try { fs.rmSync(rejectedFile.path, { force: true }); } catch {}
          }
          manualSeriesImage = null;
          // Fichier rejeté (et retiré du volume) : plus rien à conserver.
          manualKeepOnCatch = false;
        }
        if (manualSeriesImage && manualSeriesImage !== (existingConservableImage || null)) {
          // 1) Image MANUELLE (upload « seriesImage » ou URL distante) : elle
          //    prime — remplacement de l'image de la série sur l'entité et
          //    propagation à TOUS les tomes du même nom (lignes legacy prises
          //    en compte par nom strict ; nettoyage du fichier local devenu
          //    orphelin une fois la bascule faite).
          seriesImageToWrite = manualSeriesImage;
          const synced = await syncSeriesEntity(values.series, manualSeriesImage);
          seriesIdToWrite = synced.seriesId || null;
        } else if (!renamedSeries && existingConservableImage) {
          // 2) Rien de nouveau fourni et image DÉDIÉE déjà présente : on
          //    conserve. (Ligne legacy sans entité : rattachement à l'entité
          //    existante.) Une valeur contaminée (= couverture) ne retombe
          //    PAS ici : elle est recalculée par la branche 3.
          if (!existing.series_id) {
            const found = await findSeries(values.series);
            if (found) seriesIdToWrite = found.seriesId;
          }
        } else {
          // 3) Nom inconnu (renommage), image absente OU contaminée (=
          //    couverture du tome legacy) : recherche AUTOMATIQUE Open
          //    Library / Google Books sur le NOM DE SÉRIE seul, téléchargée
          //    localement, repli PROPRE img/no_title.jpg — l'entité reçoit
          //    l'image et tous les tomes du même nom l'adoptent. La couverture
          //    du tome n'est JAMAIS réécrite dans series_image (forbiddenCover).
          const resolved = await autoResolveComicSeriesImage(values.series, coverUrl);
          seriesImageToWrite = resolved.image;
          const synced = await syncSeriesEntity(values.series, resolved.image);
          seriesIdToWrite = synced.seriesId || null;
        }
      } catch (err) {
        // Non bloquant (base non migrée « series… », APIs injoignables…) : on
        // conserve la situation en base CONSISTANTE — si seule une valeur
        // contaminée était en base, elle est purgée (= NULL), jamais « gardée »
        // telle quelle ; la BD reste modifiée.
        console.warn(
          "[serie] Résolution de l'image de série impossible, reprise avec le " +
            "choix de l'utilisateur conservé si une image manuelle a été résolue :",
          err.message
        );
        if (manualKeepOnCatch && manualSeriesImage) {
          // Image manuelle DÉJÀ RÉSOLUE sur disque (fichier uploadé par multer
          // OU URL distante téléchargée) : elle EST le choix de l'utilisateur —
          // elle est CONSERVÉE et ÉCRITE sur la ligne (écrasement du COALESCE),
          // jamais supprimée ni remplacée par l'image courante (la propagation à
          // l'entité se retentera au prochain enregistrement d'un tome de cette
          // série). ⚠ Ne PAS appeler removeUnusedSeriesFiles ici : elle
          // supprimerait le fichier que nous écrivons — une colonne pointant
          // vers un fichier absent donnerait une image cassée (404) sur la tuile.
          seriesImageToWrite = manualSeriesImage;
        } else {
          // Rien à conserver : nettoyage éventuel + le COALESCE du UPDATE
          // conserve l'état en base (jamais une image dont le fichier est
          // supprimé).
          removeUnusedSeriesFiles(req.files);
        }
        // Note : si la seule valeur d'image en base était une copie de la
        // couverture du tome (contamination legacy), l'« update » COALESCE ne
        // la réexpose pas durablement — la purge explicite finale force NULL.
      }
    }

    const updated = await query(
      `UPDATE comics SET cover_url=$1, title=$2, series=$3, tome_number=$4,
                          authors=$5, illustrators=$6, publisher=$7, release_date=$8,
                          genre=$9, isbn=$10, synopsis=$11,
                          is_special_edition=$12, is_signed=$13,
                          added_date=COALESCE($14, added_date),
                          series_id=COALESCE($15, series_id),
                          series_image=COALESCE($16, series_image)
       WHERE id=$17 RETURNING *`,
      [
        coverUrl,
        values.title,
        values.series,
        values.tomeNumber,
        values.authors,
        values.illustrators,
        values.publisher,
        values.releaseDate,
        values.genre,
        values.isbn,
        values.synopsis,
        values.isSpecialEdition,
        values.isSigned,
        // « Date d'ajout » : null -> on conserve la date existante en base.
        values.addedDate || null,
        seriesIdToWrite,
        seriesImageToWrite,
        id,
      ]
    );

    // PURGE / AUTO-RÉPARATION des colonnes série (le COALESCE du dessus ne
    // permet pas de forcer NULL). Déclenchée quand :
    //   a) SUPPRESSION EXPLICITE de l'image de série (drapeau
    //      remove_series_image=true, bouton « Retirer le fichier ») — la
    //      colonne series_image DOIT porter NULL : jamais l'ancienne image du
    //      tomes, JAMAIS la couverture du TOME qui ne remplit jamais la
    //      colonne. L'image retirée a déjà été purgée globalement (entité +
    //      tous les tomes du même nom via removeSeriesImageGlobally) ; ici on
    //      force NULL sur CETTE LIGNE, dont le COALESCE du UPDATE principal
    //      « conserve » la valeur d'avant : jamais l'image retirée, ni la
    //      jaquette du tome. La dissociation série/tome est totale ;
    //   b) la série a été RETIRÉE sur ce tome (reset habituel — cols
    //      series_id + series_image -> NULL, fichier local retiré s'il devient
    //      orphelin : il est partagé avec les autres tomes de l'ancien nom,
    //      qu'on ne touche pas) ;
    //   c) la colonne series_image PORTAIT / PORTE la couverture du TOME
    //      (contamination legacy non corrigée par la branche auto — échec
    //      APIs compris) : NULL propre plutôt que réexposer la jaquette en
    //      tant qu'image de série. Dissociation totale garantie.
    // Non bloquant si les colonnes sont absentes (base non migrée « series… »)
    // : on répond alors sur la ligne « pré-reset ».
    let row = updated.rows[0];
    const contaminatedAfterUpdate =
      String(row.series_image || '').trim() !== '' &&
      !conservableSeriesImage(row.series_image, row.cover_url);
    // PRIORITÉ ABSOLUE — image de SÉRIE uploadée MANUELLEMENT : dès que la
    // requête portait le fichier « seriesImage », son chemin local
    // (récupéré IMMÉDIATEMENT en tête de l'action, cf. bloc ci-dessus) est
    // écrit EXPLICITEMENT sur la colonne `comics.series_image` — jamais via
    // le COALESCE du UPDATE principal (null = « conserver l'image courante »)
    // et SANS que les purges / auto-réparations ci-dessous (drapeau de
    // suppression, reset série vide, contamination legacy) ne puissent la
    // ramener à NULL ni la replacer par l'ancienne image : le REPLI sur
    // l'état d'avant est interdit, seul le choix de l'utilisateur compte.
    // Le rattachement à l'entité SÉRIE et la propagation aux tomes du même
    // nom ont déjà eu lieu dans la branche ci-dessus (syncSeriesEntity).
    if (manualSeriesUploadPath) {
      // Garde physique : si la branche ci-dessus a REJETÉ le fichier (garde-
      // fou série/tome : image = couverture du tome, fichier retiré du volume),
      // on n'écrit PAS un chemin vers un fichier inexistant (404 garanti) —
      // le COALESCE de l'UPDATE principal conserve alors l'état en base.
      const stillOnDisk = fs.existsSync(
        path.join(env.uploadDir, manualSeriesUploadPath.slice('/uploads/'.length))
      );
      if (!stillOnDisk) {
        console.warn(
          `[serie] Fichier « seriesImage » déjà retiré du volume (rejeté en amont) : aucune écriture de « ${manualSeriesUploadPath} ».`,
        );
        manualSeriesUploadPath = null;
      }
    }
    if (manualSeriesUploadPath) {
      try {
        const forced = await query(
          'UPDATE comics SET series_image = $1 WHERE id = $2 RETURNING *',
          [manualSeriesUploadPath, id]
        );
        row = forced.rows[0] || row;
      } catch (err) {
        // Non bloquant : la valeur du UPDATE principal reste exposée.
        console.warn(
          "[serie] Écriture explicite de l'image uploadée impossible :",
          err.message
        );
      }
    } else if (wantRemoveSeriesImage) {
      // Image retirée explicitement : NULL forcé sur la ligne — jamais
      // l'ancienne image, jamais la couverture du TOME. Le rattachement à
      // l'entité est conservé quand la série reste déclarée (le cas général
      // du bouton « Retirer le fichier » sur l'image seule).
      try {
        if (values.series) {
          await query('UPDATE comics SET series_image = NULL WHERE id = $1', [id]);
        } else {
          await query('UPDATE comics SET series_id = NULL, series_image = NULL WHERE id = $1', [id]);
        }
        const purgeImage = row.series_image || existing.series_image;
        if (purgeImage && isLocalSeriesPath(purgeImage)) {
          await deleteLocalSeriesFileIfOrphan(purgeImage);
        }
        const resetRes = await query('SELECT * FROM comics WHERE id = $1', [id]);
        row = resetRes.rows[0] || { ...row, series_image: null };
      } catch {}
    } else if ((!values.series && existing.series) || contaminatedAfterUpdate) {
      try {
        await query('UPDATE comics SET series_id = NULL, series_image = NULL WHERE id = $1', [id]);
        const purgeImage = row.series_image || existing.series_image;
        if (purgeImage && isLocalSeriesPath(purgeImage)) {
          await deleteLocalSeriesFileIfOrphan(purgeImage);
        }
        const resetRes = await query('SELECT * FROM comics WHERE id = $1', [id]);
        row = resetRes.rows[0] || { ...row, series_id: null, series_image: null };
      } catch {}
    }

    return res.json({ comic: toComicDto(row) });
  } catch (err) {
    uploadedFilesOf(req).forEach((f) => {
      if (f && f.path) { try { fs.rmSync(f.path, { force: true }); } catch {} }
    });
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Une BD avec cet ISBN existe déjà dans votre collection.' });
    }
    return next(err);
  }
}

// ------------------------------------------------------------
// POST /api/comics/import/isbn — import PAR CODE-BARRES (ISBN) via Google Books
// ------------------------------------------------------------
// ⚠ ROUTE À DÉCLARER AVANT `/:id` (voir routes/comicRoutes.js), sinon
// « import » serait capté par le paramètre :id.
//
// EXEMPLE D'INTÉGRATION du module googleBooksClient.js avec ASSOCIATION À UNE
// SÉRIE — la chaîne complète, en gardant TOUS les comportements de la création
// manuelle (dissociation série/tome, image de substitution, entité Série) :
//   1. ISBN scanné -> fetchBookByIsbn isbClient.js (qui délègue à
//      googleBooksClient.fetchBookByIsbn) : métadonnées standardisées + SÉRIE
//      (métadonnée « series » sinon déduction du titre « Série — Album »,
//      « Série, tome N ») + image de SUBSTITUTION générique si aucune couverture.
//   2. Réponse du client -> corps POST (mêmes champs que le formulaire :
//      title, series, tome_number, authors, illustrator(s), publisher,
//      release_date ISO strict, genre, isbn, synopsis…) -> cleanComic() applique
//      exactement les même règles de validation / nettoyage.
//   3. Couverture : URL distante téléchargée en LOCAL (jamais une URL Google
//      persistée) ; image de substitution « /img/no_title.jpg » laissée telle
//      quelle (pas de téléchargement : le statique frontend la sert déjà).
//   4. ASSOCIATION À LA SÉRIE : même algorithme que createComic — image manuelle
//      (optionnelle, via « seriesImage ») sinon réutilisation de l'entité Série
//      existante / recherche auto Open Library & Google Books (NOM DE SÉRIE seul),
//      repli img/no_title.jpg ; entité créée / rattachée via ensureSeries avec
//      propagation du visuel à tous les tomes du même nom (syncSeriesEntity).
//   5. Garanties : l'ISBN inconnu répond 404 (le serveur ne plante JAMAIS —
//      googleBooksClient renvoie null et lève des erreurs explicites en
//      français, jamais de chaîne non échappée) ; doublon ISBN -> 409 ; aucun
//      champ requis manquant -> 400.
async function importComicByIsbn(req, res, next) {
  try {
    // ----- 1) Recherche par ISBN (Google Books d'abord, Open Library en
    // --------------------------------------------------- secours) : le
    // client « isbn » compose les deux fournisseurs sur l'objet standard de
    // googleBooksClient — sans clé API il retombe proprement sur les quotas
    // publics, et sur la recherche de secours.
    const comicData = await searchByIsbn(req.params.isbn);
    if (!comicData || !comicData.title) {
      return res.status(404).json({
        error: "Aucun livre n'a été trouvé pour cet ISBN : enregistrez la BD manuellement.",
      });
    }

    // ----- 2) Corps de création : mêmes champs que le formulaire « Ajouter une
    // ------------------------------------ BD ». Le champ `synopsis` est
    // optionnel ; l'« état » et le genre reçoivent les valeurs standard du
    // client (DEFAULT_CONDITION / normalisation des catégories).
    const body = {
      title: comicData.title,
      series: comicData.series || null,
      tome_number: comicData.tome_number || null,
      authors: comicData.authors || null,
      illustrators: comicData.illustrators || null,
      publisher: comicData.publisher || null,
      release_date: comicData.release_date || null, // ISO strict AAAA-MM-JJ (sinon null)
      genre: comicData.genre || null,
      isbn: String(comicData.isbn || '').replace(/[^0-9xX]/g, ''),
      synopsis: comicData.synopsis || null,
    };

    // ----- 2a) Contrôle des champs requis (mêmes règles que createComic).
    const { error, values } = cleanComic(body);
    if (error) {
      return res.status(400).json({ error: `Métadonnées incomplètes pour l'ISBN ${body.isbn} : ${error}` });
    }

    // ----- 3) COUVERTURE (image de SUBSTITUTION comprise) :
    //   - « /img/no_title.jpg » (aucune image proposée par Google/Library) ->
    //     chemin statique du frontend, tel quel, PAS téléchargé ;
    //   - URL distante http(s) (couverture réelle) -> téléchargée en LOCAL
    //     (/uploads/comics/<fichier>) ; l'échec du téléchargement ne fait jamais
    //     échouer l'import : on bascule sur l'image générique.
    let coverUrl = null;
    if (comicData.cover_image && !isLocalCoverPath(comicData.cover_image)) {
      const downloaded = await downloadCoverImage(comicData.cover_image).catch(() => null);
      coverUrl = downloaded || googleBooks.DEFAULT_BOOK_COVER_URL;
    } else if (comicData.cover_image) {
      // Chemin local fourni par le client (image de substitution) : tel quel.
      coverUrl = comicData.cover_image;
    } else {
      coverUrl = googleBooks.DEFAULT_BOOK_COVER_URL;
    }

    // ----- 4) ASSOCIATION À LA SÉRIE — exact même algorithme que createComic
    // --------------------------------------------------- (copie volontaire du
    // bloc « IMAGE DE SÉRIE » : aucun code en double — voir la section
    // « IMAGE DE SÉRIE » de createComic ci-dessus, seule source de vérité).
    let seriesId = null;
    let seriesImage = values.series ? SERIES_NO_TITLE_URL : null;
    if (values.series) {
      try {
        ensureUploadDirs();
        // Image MANUELLE fournie optionnellement avec l'import (« seriesImage ») :
        // elle prime sur toute recherche automatique — même chaîne que le formulaire.
        const manualSeriesImage = await resolveComicSeriesImage(req, null);
        let resolvedImage = null;
        if (manualSeriesImage) {
          resolvedImage = manualSeriesImage;
        } else {
          // Série DÉJÀ RÉFÉRENCÉE -> réutilisation du visuel existant ; sinon
          // recherche auto Open Library / Google Books (NOM DE SÉRIE seul) —
          // le client googleBooks est déjà intégré à autoFetchSeriesImage.
          const resolved = await autoResolveComicSeriesImage(values.series, coverUrl);
          resolvedImage = resolved.image;
        }
        // GARDE-FOU série/tome (import par ISBN) : jamais la couverture du TOME
        // dans series_image — colonne mise à null, l'affichage retombe proprement
        // sur le repli img/no_title.jpg (jamais de blocage de l'import).
        if (resolvedImage && coverUrl && stripOrigin(resolvedImage) === stripOrigin(coverUrl)) {
          console.warn(`[serie] Refus d'inscrire la couverture du tome dans series_image (${resolvedImage}) lors de l'ISBN ${values.isbn}.`);
          resolvedImage = null;
        }
        seriesImage = resolvedImage;
        if (seriesImage) {
          const synced = await syncSeriesEntity(values.series, seriesImage);
          seriesId = synced.seriesId || null;
        } else {
          try {
            const ent = await ensureSeries(values.series, null);
            seriesId = ent.seriesId || null;
          } catch {}
        }
      } catch (err) {
        // Non bloquant : la création de la BD n'est JAMAIS stoppée par la série.
        console.warn("[serie] Résolution de l'image de série impossible lors de l'import ISBN — repli img/no_title.jpg :", err.message);
        removeUnusedSeriesFiles(req.files);
        seriesImage = SERIES_NO_TITLE_URL;
      }
    }

    // GARDE-FOU final avant écriture (série/tome).
    if (seriesImage && coverUrl && stripOrigin(seriesImage) === stripOrigin(coverUrl)) {
      console.warn(`[serie] Refus d'inscrire la couverture du tome dans series_image (${seriesImage}) lors de l'ISBN ${values.isbn}.`);
      seriesImage = null;
    }

    // ----- 5) Insertion SQL : mêmes colonnes que createComic.
    const { rows } = await query(
      `INSERT INTO comics (user_id, cover_url, title, series, tome_number,
                           authors, illustrators, publisher, release_date,
                           genre, isbn, synopsis, is_special_edition, is_signed, added_date,
                           series_id, series_image)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               COALESCE($15, CURRENT_DATE), $16, $17)
       RETURNING *`,
      [
        req.user.id,
        coverUrl,
        values.title,
        values.series,
        values.tomeNumber,
        values.authors,
        values.illustrators,
        values.publisher,
        values.releaseDate,
        values.genre,
        values.isbn,
        values.synopsis,
        values.isSpecialEdition || false,
        values.isSigned || false,
        values.addedDate || null,
        seriesId,
        seriesImage,
      ]
    );

    return res.status(201).json({ comic: toComicDto(rows[0]) });
  } catch (err) {
    // Garde-fous : NETTOYAGE des fichiers éventuellement uploadés puis réponses
    // explicites (le serveur ne plante JAMAIS sur un ISBN introuvable — les
    // erreurs de googleBooksClient sont déjà en français, sans apostrophe cassante).
    uploadedFilesOf(req).forEach((f) => {
      if (f && f.path) { try { fs.rmSync(f.path, { force: true }); } catch {} }
    });
    if (err.code === '23505') {
      return res.status(409).json({ error: "Une BD avec cet ISBN existe déjà dans votre collection." });
    }
    if (/ISBN invalide/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    if (typeof err.message === 'string' && /Google Books|quota/i.test(err.message)) {
      // Erreur explicite du client (400/403/429/5xx) : message lisible tel quel.
      return res.status(502).json({ error: "Recherche Google Books indisponible. Réessayez ou enregistrez la BD manuellement." });
    }
    console.error('[importComicByIsbn]', err);
    return next(err);
  }
}

// ------------------------------------------------------------
// DELETE /api/comics/:id — suppression + nettoyage de la couverture locale
// ------------------------------------------------------------
async function deleteComic(req, res, next) {
  try {
    const id = Number(req.params.id);
    let checkSql = 'SELECT * FROM comics WHERE id = $1';
    const checkParams = [id];
    if (req.user.role !== 'admin') {
      checkSql += ' AND user_id = $2';
      checkParams.push(req.user.id);
    }
    const { rows } = await query(checkSql, checkParams);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'BD introuvable.' });
    }

    const comic = rows[0];
    await query('DELETE FROM comics WHERE id = $1', [id]);
    // Normalise d'abord : les lignes legacy ("//comics/…" sans préfixe)
    // restent reconnues comme fichiers locaux et sont nettoyées.
    const storedCover = normalizeStoredCoverPath(comic.cover_url);
    if (isLocalCoverPath(storedCover) || isLocalVinylCoverPath(storedCover)) {
      removeLocalCover(storedCover);
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listMyComics,
  listComicsByUser,
  listPublicComicsByUser,
  getComic,
  createComic,
  updateComic,
  deleteComic,
  importComicByIsbn,
  toComicDto,
  // Résolveur du visuel global de série (util + smoke tests) : réutilisation
  // d'une image déjà référencée, sinon recherche auto (Open Library séries /
  // Google Books, nom de série seul), repli forcé img/no_title.jpg.
  autoResolveComicSeriesImage,
};
