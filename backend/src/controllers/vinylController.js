const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { query } = require('../config/db');
const {
  downloadRemoteCover,
  downloadCoverImageToDir,
  MusicBrainzError,
  searchArtistMbid,
  fetchArtistArtwork,
  normalizeArtistName,
  ARTIST_NO_GROUP_URL,
} = require('../utils/musicBrainzClient');
const {
  searchArtist: searchArtistLastfm,
  fetchArtistImage: fetchLastfmArtistImage,
  isConfigured: isLastfmConfigured,
} = require('../utils/lastfmClient');
const {
  searchArtist: searchArtistDiscogs,
  isConfigured: isDiscogsConfigured,
} = require('../utils/discogsClient');
const { canEditItem } = require('../middlewares/auth');
const { findArtistId, ensureArtist, removeArtistImageGlobally } = require('../utils/artistService');

function toVinylDto(row) {
  return {
    id: row.id,
    userId: row.user_id,
    // Normalise les chemins legacy (ex. "/vinyls/" sans préfixe "/uploads")
    // pour que l'image soit servie par le volume statique /uploads.
    coverUrl: normalizeStoredCoverPath(row.cover_url),
    artist: row.artist,
    // Image d'ARTISTE (photo / logo) — utilisée uniquement dans la grille de
    // la page « Mes Disques » (tuile du groupe artiste). Jaquette d'album
    // (cover_url) inchangée : elle reste gérée par sa propre logique.
    // DISSOCIATION ARTISTE/JAQUETTE : jamais la couverture du DISQUE renvoyée
    // ici — colonne vide, emblème par défaut ou valeur identique à cover_url
    // (contamination legacy) -> null EXPLICITE ; c'est le frontend qui retombe
    // alors sur l'image par défaut img/no_group.jpg (repli propre).
    artistImage: artistImageUrlOf(row),
    title: row.title,
    trackCount: Number(row.track_count),
    tracklist: row.tracklist,
    genre: row.genre,
    label: row.label,
    releaseDate: row.release_date,
    barcode: row.barcode,
    // Identifiant MusicBrainz (release MBID) — source des champs
    // MusicBrainz de la fiche (titre, artiste, date, label, code-barres)
    mbid: row.mbid,
    // Identifiants Discogs (complément de MusicBrainz, via la recherche EAN)
    discogsReleaseId: row.discogs_release_id,
    discogsUrl: row.discogs_url,
    // Fiche Last.fm d'album (source PRIORITAIRE de la cascade d'import) :
    // URL de la fiche — provenance persistée de la jaquette / métadonnées.
    lastfmUrl: row.lastfm_url || null,
    // Remplace l'ancien « Année d'acquisition » : date exacte d'ajout du
    // disque à la collection (DATE YYYY-MM-DD), alignée sur comics.added_date.
    // ⚠ node-postgres renvoie les colonnes DATE comme objets JS Date (minuit
    // UTC) : String(date).slice(0, 10) donnait « Sat Oct 24 » — non parsable
    // par le frontend, la ligne « Date d'ajout » disparaissait de la modale
    // de détails. toIsoDate() formate proprement en YYYY-MM-DD (cf. helper).
    addedDate: toIsoDate(row.acquired_date),
    notes: row.notes,
    // Options du disque (rangée horizontale du formulaire) : TYPE DE DISQUE
    // (« Vinyle » / « Compact », défaut « Vinyle »), booléens, nombre de
    // galettes (1 → 5) et couleur de la galette (défaut « Noir »). Bornes
    // garanties côté base (CHECK) ; le resserrage défend les lignes
    // pré-migration (discs_count 6 → 20 stockées par de vieilles versions).
    discType: row.disc_type || 'Vinyle',
    isSpecialEdition: Boolean(row.is_special_edition),
    pictureDisc: Boolean(row.is_picture_disc),
    discsCount: Math.min(5, Math.max(1, Number(row.discs_count) || 1)),
    // Couleur de la galette : même nom que la colonne (le formulaire lit/envoie « color »).
    color: row.color || DEFAULT_DISC_COLOR,
    createdAt: row.created_at,
  };
}

/**
 * « Date d'ajout » envoyée par le frontend (input type="date") :
 * extrait le AAAA-MM-JJ strict, tolère une date ISO complète ou une année
 * seule (légacy, remontée vers le 1er janvier). Renvoie null si absente /
 * invalide (le SQL prend alors CURRENT_DATE via le défaut de colonne).
 */
function parseAcquiredDate(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1000 || year > 9999) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[1]}-${m[2] ? pad(Number(m[2])) : '01'}-${m[3] ? pad(Number(m[3])) : '01'}`;
}

/**
 * Convertit une valeur DATE venant de PostgreSQL en chaîne « YYYY-MM-DD ».
 * node-postgres renvoie les colonnes DATE comme objets JS Date (minuit UTC) :
 * `String(date).slice(0, 10)` produisait alors « Sat Oct 24 » — non parsable
 * par le frontend (addDateFr), la ligne « Date d'ajout » était filtrée de la
 * modale de détails. toISOString() renvoie le minuit UTC exact de la date
 * stockée : le slice(0, 10) est donc fidèle. Tolère aussi les chaînes ISO /
 * « YYYY-MM-DD » déjà formattées (repli par regex). null si absente / invalide.
 */
function toIsoDate(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
}

/**
 * Normalise un chemin de jaquette stocké en base.
 * Répare les formats legacy écrits par d'anciennes versions :
 *  - "/vinyls/<fichier>"  -> "/uploads/vinyls/<fichier>" ;
 *  - une URL complète (http://…/uploads/vinyls/…) -> chemin relatif.
 * Les chemins déjà valides ("/uploads/vinyls/…", URL distante) sont inchangés.
 */
function normalizeStoredCoverPath(value) {
  const raw = String(value || '').trim();
  // URL complète d'une image servie PAR CE SITE (http://…/uploads/…) : on ne
  // garde que le chemin local. Une vraie URL distante (sans "/uploads/") est
  // conservée telle quelle pour être téléchargée.
  if (/^https?:\/\//i.test(raw)) {
    const idx = raw.indexOf('/uploads/');
    return idx >= 0 ? raw.slice(idx) : raw;
  }
  if (!raw) return raw;
  if (raw.startsWith('/uploads/')) return raw;
  // Legacy : chemin local sans le préfixe "/uploads" (format écrit par
  // d'anciennes versions de resolveCover).
  if (raw.startsWith('/')) {
    const rel = raw.slice(1).split('/').filter(Boolean).join('/');
    return rel ? `/uploads/${rel}` : raw;
  }
  return raw;
}

/**
 * Récupère le chemin d'accès final de la jaquette à partir de la requête :
 * - fichier téléversé (field "cover")   -> chemin local dans le volume de uploads
 * - field "coverRemoteUrl" (http/https) -> téléchargement distant => stockage local
 * - field "coverRemoteUrl" = chemin local existant (aucune nouvelle jaquette)
 *   -> null : l'appelant conserve la jaquette existante
 * Le champ est stocké sous forme de chemin relatif "/uploads/vinyls/<fichier>".
 * @param {string|null} existingCover chemin local de la jaquette actuelle (en
 *        édition). Le frontend le renvoie tel quel dans "coverRemoteUrl"
 *        lorsqu'aucune nouvelle jaquette n'est fournie ; il ne doit PAS être
 *        traité comme une URL distante (ce qui provoquait une erreur 400).
 */
async function resolveCover(req, existingCover = null) {
  // ⚠ Le formulaire « Ajouter / Modifier un disque » envoie AUSSI le champ
  // "artistImage" (image d'ARTISTE — cf. routes/vinylRoutes.js
  // upload.fields([...]) et resolveArtistImage ci-dessous) : les fichiers
  // arrivent dans req.files CHAMP PAR CHAMP — on ne lit donc QUE le fichier
  // du champ "cover". DISSOCIATION ARTISTE/JAQUETTE : un fichier du champ
  // « artistImage » est JAMAIS retenu en jaquette d'album (sans cette garde,
  // un upload d'IMAGE D'ARTISTE SEUL retomberait sur files[0] et écrirait la
  // photo de l'artiste dans la colonne cover_url).
  // ⚠ « fields() » : req.files est un OBJET { champ: [fichier…] } — jamais
  // une liste (uploadedFilesOf gère les deux formes ; une lecture listique
  // trouvait JAMAIS le fichier -> jaquette ignorée, orpheline sur disque).
  const coverFile =
    uploadedFileOf(req, 'cover') || uploadedFilesOf(req).find((f) => f && f.fieldname !== 'artistImage') || null;
  if (coverFile) {
    // Multer stocke le fichier dans <uploadDir>/vinyls/ (voir middlewares/
    // upload.js, destination pilotée par le champ "cover") : on renvoie le
    // chemin d'accès HTTP exact "/uploads/vinyls/<fichier>", cohérent avec
    // downloadRemoteCover() (monter le chemin SANS le préfixe "/uploads"
    // faisait pointer le client vers <origine>/vinyls/… qui ne correspond à
    // aucune route statique : la jaquette disparaissait après enregistrement).
    const rel = path.relative(env.uploadDir, coverFile.path).split(path.sep).join('/');
    return rel ? `/uploads/${rel}` : `/uploads/${path.basename(coverFile.path)}`;
  }
  const remoteUrl = normalizeStoredCoverPath(req.body.coverRemoteUrl);
  if (!remoteUrl) {
    return null;
  }
  // Chemin local (jaquette existante — éventuellement préfixée par l'origine
  // par certains clients) et non URL distante : on ne télécharge rien et on
  // laisse l'appelant conserver la jaquette actuelle.
  if (!/^https?:\/\//i.test(remoteUrl) || remoteUrl === normalizeStoredCoverPath(existingCover)) {
    return null;
  }
  return downloadRemoteCover(remoteUrl);
}

// ------------------------------------------------------------
// Image d'ARTISTE (photo / logo) — création / mise à jour de l'entité Artiste
// ------------------------------------------------------------

/**
 * Renvoie le chemin d'accès HTTP d'un fichier déjà stocké dans le volume de
 * uploads (chemin physique `file.path` fourni par multer) : le fichier du
 * champ « artistImage » a été déposé dans `env.artistUploadDir`
 * (<uploadDir>/artists/, voir middlewares/upload.js). Le chemin relatif est
 * calculé sur le volume RACINE `env.uploadDir` — jamais sur le sous-dossier
 * « artists/ » : une base relative au sous-dossier le retirait du chemin
 * (« /uploads/artist-… » au lieu de « /uploads/artists/… »), d'où une image
 * introuvable (404) après enregistrement, des lignes non reconnues par le
 * nettoyage orphelin (`/^\/uploads\//` attendu : cleanup +
 * syncArtistEntity) et l'entité Artiste polluée par un chemin cassé.
 * @param {object} file fichier multer ({ path })
 * @returns {string} chemin d'accès "/uploads/artists/<fichier>"
 */
function localArtistFilePath(file) {
  const rel = path.relative(env.uploadDir, file.path).split(path.sep).join('/');
  return rel && !rel.startsWith('..')
    ? `/uploads/${rel}`
    : `/uploads/artists/${path.basename(file.path)}`;
}

/**
 * Supprime un fichier local du volume de uploads décrit par son chemin
 * d'accès (« /uploads/… »). Ignoré silencieusement si absent ou distant.
 */
function deleteLocalArtistFile(storedPath) {
  const raw = String(storedPath || '').trim();
  if (!raw.startsWith('/uploads/')) return;
  const rel = raw.slice('/uploads/'.length).split(/[\/\\]/).filter(Boolean).join('/');
  if (!rel) return;
  try {
    fs.rmSync(path.join(env.uploadDir, rel), { force: true });
  } catch {}
}

/**
 * Liste TOUS les fichiers reçus sur la route, quelle que soit leur forme
 * dans `req.files`. Multer « fields() » (routes/vinylRoutes.js — champs
 * "cover" + "artistImage") stocke les fichiers sous forme d'OBJET
 * { champ: [fichier…] } : une lecture `Array.isArray(req.files)` y renvoie
 * donc [] et le fichier uploadé était ignoré (réparation du bug « image
 * d'artiste importée non stockée : l'ancienne photo ou no_group.jpg était
 * conservée à la place »). La forme ARRAY est tolérée par sécurité.
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
 * Supprime les fichiers « artistImage » reçus mais non utilisés (échec 400) :
 * ⚠ « fields() » -> req.files est un OBJET { champ: [fichier…] }, aplati via
 * uploadedFilesOf (une lecture listique les aurait ignorés).
 */
function removeUnusedArtistFiles(files) {
  uploadedFilesOf(files).forEach((f) => {
    if (f && f.fieldname === 'artistImage') {
      try { fs.rmSync(f.path, { force: true }); } catch {}
    }
  });
}

/** Détache le préfixe d'origine (https://site/…) d'une valeur stockée. */
function stripOrigin(value) {
  return String(value || '').replace(/^https?:\/\/[^/]+/i, '');
}

/**
 * CONTAMINATION legacy DÉTECTÉE : la colonne `artist_image` de la ligne STORE
 * la jaquette d'ALBUM de la MÊME LIGNE (`cover_url` identique, préfixe
 * d'origine mis à part) — exactement le bug que la dissociation stricte
 * ARTISTE ↔ JAQUETTE interdit. Une telle valeur ne doit NI être exposée par
 * l'API, NI conservée au COALESCE de l'UPDATE, NI réutilisée pour l'entité
 * Artiste (ni pour aucun autre disque). Valeur vide -> false.
 */
function isArtistCoverContamination(row) {
  const img = String((row && row.artist_image) || '').trim();
  if (!img) return false;
  const cover = normalizeStoredCoverPath((row && row.cover_url) || '');
  return stripOrigin(img) === stripOrigin(cover);
}

/**
 * Image d'ARTISTE exposée par l'API (champ `artistImage` du DTO), ou valeur
 * CONSERVABLE lors d'une mise à jour — dissociation stricte avec la jaquette
 * d'ALBUM de la même ligne :
 *  - colonne vide/null en base          -> null ;
 *  - emblème par défaut img/no_group.jpg -> null EXPLICITE (traité comme «
 *    absence » partout : regroupement collection.js, formulaire) ;
 *  - valeur identique à la jaquette de la ligne (contamination legacy ou
 *    doublon volontaire)                -> null. L'API ne renvoie JAMAIS la
 *    couverture d'un disque en tant que photo de son propre artiste — jamais
 *    de fallback sur cover_url ici.
 */
function artistImageUrlOf(row) {
  const raw = String((row && row.artist_image) || '').trim();
  if (!raw) return null;
  if (stripOrigin(raw) === ARTIST_NO_GROUP_URL) return null;
  if (isArtistCoverContamination(row)) return null;
  return raw;
}

/**
 * Une image LOCALE du volume d'uploads qui est AUSSI la jaquette d'ALBUM
 * d'au moins un disque déjà enregistré en base (lignes contaminées :
 * artist_image = cover_url) — donc jamais acceptable comme photo d'ARTISTE
 * (repli, adoption ou réutilisation) : même si elle ne contamine pas la LIGNE
 * courante, c'est le visuel d'un disque. Valeur non locale / absente -> false
 * ; toute erreur de requête -> false (non bloquant).
 */
async function isStoredAlbumCover(imagePath) {
  const raw = stripOrigin(String(imagePath || '').trim());
  if (!raw.startsWith('/uploads/')) return false;
  try {
    const { rows } = await query(
      'SELECT 1 FROM vinyls WHERE btrim(artist_image) = $1 AND btrim(artist_image) = btrim(cover_url) LIMIT 1',
      [raw]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Résout l'image d'ARTISTE envoyée par le formulaire « Ajouter / Modifier un
 * disque » (multipart) et la stocke LOCALEMENT dans le volume de uploads :
 *  - fichier téléversé (champ "artistImage") -> déjà sur disque (multer), on
 *    renvoie son chemin d'accès local ;
 *  - field "artistImageRemoteUrl" (http/https) -> téléchargement distant vers
 *    <uploadDir>/artists/ puis chemin local (même pattern que les jaquettes,
 *    cf. resolveCover / downloadRemoteCover) ;
 *  - sinon null : l'appelant applique alors le repli automatique (cascade
 *    Last.fm -> Discogs / MusicBrainz + Cover Art Archive), puis l'image par
 *    défaut `img/no_group.jpg`.
 * Le champ est stocké sous la forme « /uploads/artists/<fichier> ».
 * @param {object} req requête Express (req.files = array multer, req.body)
 * @returns {Promise<string|null>} chemin local de l'image, ou null.
 * @throws {MusicBrainzError} 502 si le téléchargement d'une URL distante échoue.
 */
async function resolveArtistImage(req) {
  // ⚠ CONTRAT Multipart -> le middleware multer upload.fields() des routes (POST/PUT
  // /api/vinyls, cf. routes/vinylRoutes.js) intercepte les champs fichiers « cover »
  // ET « artistImage » : chaque dépôt arrive dans req.files AVANT l'action, avec
  // son fieldname d'origine. Le fichier du champ « artistImage » est déposé par
  // multer dans <uploadDir>/artists/ (cf. middlewares/upload.js — destination
  // pilotée par le NOM DU CHAMP).
  // ⚠ « fields() » : req.files est un OBJET { champ: [fichier…] } — jamais
  // une liste : une lecture `Array.isArray(req.files)` renvoyait [] et le
  // fichier importé était ignoré (orphelin sur disque + repli sur l'ancienne
  // photo de l'artiste ou img/no_group.jpg). uploadedFilesOf gère les deux
  // formes (réparation définitive, cf. comicController).
  const artistFile = uploadedFileOf(req, 'artistImage');
  if (artistFile) {
    // Fichier FRAÎCHEMENT UPLOADÉ par multer (champ « artistImage ») : il EST
    // la nouvelle photo de l'ARTISTE, quelle que soit la valeur existante en
    // base. On renvoie SON chemin et l'appelant ÉCRASE explicitement l'ancienne
    // valeur (colonne vinyls.artist_image + entité Artiste, propagation via
    // syncArtistEntity) — jamais l'inverse : l'ancienne photo en base ne doit
    // JAMAIS évincer le fichier nouvellement stocké.
    return localArtistFilePath(artistFile);
  }

  const remoteUrl = String(req.body.artistImageRemoteUrl || '').trim();
  if (/^https?:\/\//i.test(remoteUrl)) {
    try {
      return await downloadCoverImageToDir(remoteUrl, 'artists');
    } catch (err) {
      throw new MusicBrainzError(
        `Téléchargement de l'image d'artiste impossible (${err.message}).`,
        502
      );
    }
  }
  return null;
}

/**
 * Recherche automatique d'une photo / logo d'artiste en cas d'ABSENCE
 * d'image manuelle — CASCADE de sources, dans l'ordre de PRIORITÉ :
 *   PRIORITÉ 1 — API LAST.FM (artist.search puis artist.getInfo) : l'image du
 *      groupe est retournée directe par l'API ;
 *   2. DISCOGS (si LASTFM non configuré / inconnu / aucun artwork) :
 *       recherche d'artiste `?q=<nom>&type=artist` — l'image haute résolution
 *       (`cover_image`) de l'entrée est téléchargée dans <uploadDir>/artists/ ;
 *   3. MUSICBRAINZ (+ Cover Art Archive) si Discogs n'a rien renvoyé :
 *      nom -> MBID -> image « front » téléchargée localement ;
 * EN CAS D'ÉCHEC OU D'ABSENCE DE RÉSULTAT (artiste inconnu, API injoignable,
 * aucun artwork) : repli propre sur l'image par défaut locale
 * `img/no_group.jpg` — le disque est TOUJOURS créé, jamais bloqué.
 * @param {string} artistName nom de l'artiste tel qu'enregistré en base
 * @returns {Promise<string>} "/uploads/artists/<fichier>" ou "/img/no_group.jpg".
 */
async function autoFetchArtistImage(artistName) {
  const name = String(artistName || '').trim();
  if (!name) return ARTIST_NO_GROUP_URL;

  // ------------------------------------------------------------------
  // 1. PRIORITÉ 1 — Last.fm : artiste.search -> artist.getInfo (images).
  //    `fetchArtistImage` renvoie null sans lever (inconnu / API en panne)
  //    ; tout échec non classé (timeout…) est non bloquant : on enchaîne
  //    sur Discogs.
  // ------------------------------------------------------------------
  if (isLastfmConfigured()) {
    try {
      const found = await searchArtistLastfm(name);
      if (found && found.name) {
        const imageUrl = await fetchLastfmArtistImage(found.name);
        if (imageUrl) return await downloadCoverImageToDir(imageUrl, 'artists');
      }
    } catch (err) {
      // Non bloquant : Last.fm peut être en panne / au quota sans que la
      // création du disque doive échouer — repli Discogs / MusicBrainz.
      console.warn('[artistImage] Recherche Last.fm impossible, repli :', err.message);
    }
  }

  // ------------------------------------------------------------------
  // 2. PRIORITÉ 2 — DISCOGS (si configuré) : recherche d'artiste type=artist,
  //    l'image haute résolution `cover_image` est déjà sur la ligne de
  //    résultat (aucun second appel requis).
  // ------------------------------------------------------------------
  if (isDiscogsConfigured()) {
    try {
      const found = await searchArtistDiscogs(name);
      if (found && found.imageUrl) {
        return await downloadCoverImageToDir(found.imageUrl, 'artists');
      }
    } catch (err) {
      // Non bloquant : quota Discogs (25/min), jeton expiré… : on enchaîne
      // sur MusicBrainz.
      console.warn('[artistImage] Recherche Discogs impossible, repli :', err.message);
    }
  }

  // ------------------------------------------------------------------
  // 3. MUSICBRAINZ + Cover Art Archive : dernier repli distant.
  // ------------------------------------------------------------------
  try {
    const found = await searchArtistMbid(name);
    if (found && found.id) {
      const url = await fetchArtistArtwork(found.id);
      if (url) return await downloadCoverImageToDir(url, 'artists');
    }
  } catch (err) {
    // Non bloquant : l'API MusicBrainz / Cover Art Archive peut être en panne
    // sans que la création du disque doive échouer.
    console.warn('[artistImage] Recherche MusicBrainz impossible :', err.message);
  }

  // Repli final : image de secours locale img/no_group.jpg
  return ARTIST_NO_GROUP_URL;
}

/**
 * Artiste DÉJÀ RÉFÉRENCÉ : réutilise l'image d'ARTISTE (et son id d'entité)
 * déjà enregistrée pour le même nom d'artiste — ainsi un artiste apparaît
 * « une fois » dans la grille « Mes Disques » : tous ses disques affichent
 * LA MÊME photo / logo. La comparaison des noms passe par
 * normalizeArtistName (minuscules, espaces réduits, apostrophes harmonisées) :
 * même logique que le regroupement frontend (collection.js) et la table
 * `artists` (norm_name). L'image est portée par la colonne
 * `vinyls.artist_image` (même pattern que cover_url).
 * @param {string} artistName nom de l'artiste tel qu'enregistré en base
 * @returns {Promise<{image: string, artistId: number|null}|null>} image déjà
 *   stockée + id de l'entité, ou null si aucun disque du même artiste
 *   n'a d'image réutilisable.
 */
async function existingArtistWithImage(artistName) {
  const wanted = normalizeArtistName(artistName);
  if (!wanted) return null;
  const { rows } = await query(
    `SELECT artist, artist_image, artist_id FROM vinyls
     WHERE artist_image IS NOT NULL AND btrim(artist_image) <> ''`
  );
  for (const r of rows) {
    if (normalizeArtistName(r.artist) === wanted && r.artist_image) {
      return {
        image: String(r.artist_image),
        artistId: r.artist_id != null ? Number(r.artist_id) : null,
      };
    }
  }
  return null;
}

// ------------------------------------------------------------
// PROPAGATION de l'image d'ARTISTE — entité Artiste + TOUS les disques
// de cet artiste (tous users) -> tuile du groupe « Mes Disques »
// ------------------------------------------------------------

/**
 * Synchronise l'entité Artiste et propage l'image à TOUS les disques de cet
 * artiste (et donc à la TUILE du groupe « Mes Disques », dont l'image est
 * dérivée par le frontend des colonnes `vinyls.artist_image`). L'image est
 * GLOBALE : dédupliquée par nom normalisé, partagée entre TOUS les
 * utilisateurs — une image manuelle OU automaticement récupérée redéfinit LA
 * PHOTO DE L'ARTISTE pour toute la base :
 *  - l'ENTITÉ Artiste (table `artists`) reçoit l'image (INSERT si première
 *    création de l'artiste, UPDATE sinon) ;
 *  - TOUS les disques déjà enregistrés sous ce nom adoptent la même image
 *    (tous users — les lignes legacy sans entité prises en compte par nom
 *    strict via `artist_id IS NULL`) : le disque courant, inséré / mis à jour
 *    AVANT cet appel, est couvert par le même UPDATE (réécriture idempotente) ;
 *  - les fichiers LOCAUX d'images d'artistes (path `/uploads/artists/…` ou
 *    `/uploads/*.<ext>`) devenus orphelins sont retirés du volume — seulement
 *    si plus AUCUN disque de la base entière ne les référence (l'image est
 *    partagée entre tous les utilisateurs).
 * @param {string} artistName nom d'affichage tel qu'enregistré sur le disque
 * @param {string|null} artistImage image à propager (« /uploads/artists/… »,
 *        « /img/no_group.jpg » ou URL distante) — null : aucune écriture
 * @returns {Promise<{artistId: number|null, image: string|null}>} id de
 *   l'entité Artiste + l'image effective.
 */
async function syncArtistEntity(artistName, artistImage = null) {
  const name = String(artistName || '').trim();
  if (!name || !artistImage) return { artistId: null, image: artistImage };

  // 1) Entité Artiste : création (1er disque de l'artiste -> 1ère image) ou
  //    remplacement de la photo sur l'entité.
  const ent = await ensureArtist(name, artistImage);
  const targetId = ent.artistId;
  if (targetId == null) return { artistId: null, image: artistImage };

  // 2) Propagation à TOUS les disques de cet artiste (tous users) :
  //    - lignes rattachées à l'entité (`artist_id = targetId`, image non vide) ;
  //    - lignes legacy sans entité, rattachées par nom strict.
  // Les fichiers LOCAUX d'images que ces lignes remplaçaient ne sont retirés
  // du volume qu'une fois la bascule faite (orphan check complet en dessous).
  const oldFiles = await query(
    `SELECT DISTINCT artist_image AS img FROM vinyls
     WHERE artist_image ~ '^/uploads/' AND
       ((artist_id = $1 AND artist_image IS NOT NULL) OR (artist_id IS NULL AND btrim(artist) = $2))`,
    [targetId, name]
  );
  await query(
    `UPDATE vinyls SET artist_image = $3
     WHERE (artist_id = $1 AND artist_image IS NOT NULL) OR (artist_id IS NULL AND btrim(artist) = $2)`,
    [targetId, name, artistImage]
  );

  // 3) Nettoyage : un ancien fichier local n'est supprimé que si plus AUCUN
  //    disque (tous utilisateurs) ne le référence.
  for (const r of oldFiles.rows) {
    if (!r.img || r.img === artistImage) continue;
    const stillRef = await query(
      'SELECT 1 FROM vinyls WHERE artist_image = $1 LIMIT 1',
      [r.img]
    );
    if (stillRef.rows.length === 0) deleteLocalArtistFile(r.img);
  }

  return { artistId: targetId, image: artistImage };
}

/**
 * Conserve le GENRE DE RÉFÉRENCE d'un artiste sur l'ENTITÉ Artiste (table
 * `artists`) — appelé UNIQUEMENT au CAS A (premier disque de l'artiste) par
 * createVinyl / updateVinyl : le genre du tout premier disque devient la
 * référence IMMUEBLE des futurs albums de cet artiste. SANS jamais modifier ni
 * écraser les disques déjà enregistrés en base.
 *  - l'ENTITÉ Artiste reçoit le genre (INSERT si première création de
 *    l'artiste, UPDATE sinon) : c'est LA source du pré-remplissage du champ
 *    « Genre » à la création d'un futur album de cet artiste (cf.
 *    defaultGenreOfArtist, appelé par createVinyl / updateVinyl quand le
 *    formulaire n'en fournit pas et qu'aucun disque de l'artiste n'existe
 *    encore) ;
 *  - les disques EXISTANTS ne sont JAMAIS retouchés : ni le disque courant
 *    (inséré / mis à jour AVANT cet appel par l'INSERT / UPDATE principal), ni
 *    aucun autre — chacun garde le genre qu'il porte déjà.
 * Non bloquant : toute panne (base non migrée « artists.genre »…) ne doit
 * JAMAIS empêcher la création / la modification du disque — le genre reste
 * écrit sur la ligne courante par l'INSERT / UPDATE principal.
 * @param {string} artistName nom d'affichage tel qu'enregistré sur le disque
 * @param {string|null} genre genre musical à conserver sur l'entité — null : aucune écriture
 * @returns {Promise<number|null>} id de l'entité Artiste (null si inconnue).
 */
async function syncArtistGenre(artistName, genre = null) {
  const name = String(artistName || '').trim();
  const g = String(genre || '').trim() || null;
  if (!name || !g) return null;

  // Entité Artiste : création (1er disque de l'artiste -> 1er genre, référence
  // immuable) — jamais appelé au CAS B (disques suivants), où le genre du tout
  // premier disque reste la référence. C'est la SEULE écriture : les disques
  // déjà enregistrés ne sont JAMAIS retouchés (ni le disque courant, ni aucun
  // autre) — leur genre reste celui qu'ils portent déjà. Le pré-remplissage
  // des FUTURS albums passe par defaultGenreOfArtist (createVinyl /
  // updateVinyl), qui lit cette valeur de l'entité.
  const ent = await ensureArtist(name, null);
  const targetId = ent.artistId;
  if (targetId == null) return null;
  await query(
    'UPDATE artists SET genre = $1, updated_at = now() WHERE id = $2',
    [g, targetId]
  );

  return targetId;
}

/**
 * Renvoie le GENRE MUSICAL par défaut porté par l'ENTITÉ Artiste (table
 * `artists`) pour un nom donné — null si inconnu ou jamais défini. Sert au
 * pré-remplissage du champ « Genre » à la création d'un album : les futurs
 * disques de l'artiste repartent sur le genre déjà propagé. Lecture seule,
 * non bloquante (base non migrée « artists.genre » -> null).
 * @param {string} artistName nom d'affichage tel qu'enregistré sur le disque
 * @returns {Promise<string|null>}
 */
async function defaultGenreOfArtist(artistName) {
  const name = String(artistName || '').trim();
  if (!name) return null;
  try {
    const id = await findArtistId(name);
    if (id == null) return null;
    const { rows } = await query('SELECT genre FROM artists WHERE id = $1', [id]);
    return rows[0] && rows[0].genre ? String(rows[0].genre).trim() : null;
  } catch {
    // Base non migrée (colonne `artists.genre` absente) : aucun défaut.
    return null;
  }
}

/**
 * Renvoie le GENRE DE RÉFÉRENCE d'un artiste : le genre du TOUT PREMIER disque
 * de cet artiste déjà stocké en base — le plus ancien par ordre d'insertion
 * (created_at, puis id). null si l'artiste n'a encore aucun disque, ou si son
 * premier disque n'a pas de genre. Lecture seule, non bloquante : toute panne
 * (base non migrée « artists »…) renvoie null — le contrôleur retombe alors sur
 * le genre fourni par le formulaire (CAS A).
 * Rattachement des disques à l'artiste : lignes rattachées à l'ENTITÉ
 * (`artist_id`) + lignes legacy sans entité par nom strict — mêmes cibles que
 * syncArtistEntity.
 * @param {string} artistName nom d'affichage tel qu'enregistré sur le disque
 * @returns {Promise<string|null>} genre du tout premier disque, ou null.
 */
async function firstDiscGenreOfArtist(artistName) {
  const name = String(artistName || '').trim();
  if (!name) return null;
  try {
    const artistId = await findArtistId(name);
    const { rows } = await query(
      `SELECT genre FROM vinyls
       WHERE ((artist_id IS NOT NULL AND artist_id = $1)
              OR (artist_id IS NULL AND btrim(artist) = $2))
         AND genre IS NOT NULL AND btrim(genre) <> ''
       ORDER BY created_at ASC, id ASC
       LIMIT 1`,
      [artistId, name]
    );
    return rows[0] && rows[0].genre ? String(rows[0].genre).trim() : null;
  } catch {
    // Base non migrée (table `artists` absente) : aucun genre de référence.
    return null;
  }
}

/**
 * Sanitize une valeur numérique entrante (JSON, FormData ou query string).
 * null, undefined, chaîne vide, "NaN" ou texte non numérique → `fallback`.
 * Retourne toujours un entier fini (ou le fallback) : jamais NaN, jamais une
 * chaîne, de façon à ne pas provoquer côté PostgreSQL
 * « invalid input syntax for type integer ».
 */
function toInteger(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = parseInt(String(value).trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Convertit une valeur venant de FormData / JSON en booléen strict.
 * Gère les variantes envoyées par le frontend : boolean natif, "true"/"false"
 * (FormData), "oui"/"non", "1"/"0". Absence → `fallback`.
 */
function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|oui|yes)$/i.test(String(value).trim());
}

/** Couleurs de galettes du select « Couleur » (défaut « Noir ») : base,
 *  transparente et finitions métallisées / spéciales. */
const DEFAULT_DISC_COLOR = 'Noir';

/**
 * Valide les champs d'un disque. Retourne { erreur } ou { valeurs }.
 */
function cleanVinyl(body) {
  const artist = String(body.artist || '').trim();
  const title = String(body.title || '').trim();
  if (!artist || !title) {
    return { error: "Artiste et titre de l'album sont obligatoires." };
  }
  // MBID MusicBrainz (UUID de la release, 32+ caractères hex en retirant
  // les tirets). Colonnes VARCHAR(40). null si absent ou invalide.
  const mbidRaw = String(body.mbid || '').trim();
  const mbidClean = mbidRaw.replace(/[^0-9a-f-]/gi, '');
  const mbid =
    mbidRaw && mbidClean.length >= 32 && mbidClean.length <= 36
      ? mbidClean.toUpperCase()
      : null;
  // Identifiants Discogs : id numérique de la release + URL de la fiche.
  // Colonnes BIGINT / TEXT, null si absents ou invalides.
  const discogsReleaseIdRaw = String(body.discogs_release_id || body.discogsReleaseId || '').trim();
  const discogsReleaseId =
    /^\d{1,10}$/.test(discogsReleaseIdRaw) ? parseInt(discogsReleaseIdRaw, 10) : null;
  const discogsUrlRaw = String(body.discogs_url || body.discogsUrl || '').trim();
  const discogsUrl = /^https:\/\/(www\.)?discogs\.com\/releases\/\d+/i.test(discogsUrlRaw)
    ? discogsUrlRaw
    : null;
  // Fiche Last.fm d'album (provenance PRIORITAIRE de la cascade d'import —
  // jaquette + métadonnées issues de album.getInfo). Colonnes TEXT ; null si
  // absente ou non conforme (URL https du format « https://www.last.fm/music/… »).
  const lastfmUrlRaw = String(body.lastfm_url || body.lastfmUrl || '').trim();
  const lastfmUrl = /^https:\/\/(www\.)?last\.fm\/music\/.+$/i.test(lastfmUrlRaw)
    ? lastfmUrlRaw
    : null;
  // Champs entiers : vide, "NaN", indéfini ou invalide deviennent 0 (track_count,
  // colonne NOT NULL CHECK >= 0) — jamais la chaîne "NaN" vers Postgres
  // (« invalid input syntax for type integer »). toInteger accepte les chaînes
  // FormData / JSON (nombres et texte).
  const trackCount = Math.max(0, toInteger(body.track_count ?? body.trackCount, 0));
  const values = {
    artist,
    title,
    trackCount,
    tracklist: body.tracklist ? String(body.tracklist) : null,
    genre: body.genre ? String(body.genre).trim() : null,
    label: body.label ? String(body.label).trim() : null,
    releaseDate: body.release_date || body.releaseDate || null,
    barcode: body.barcode ? String(body.barcode).trim() : null,
    mbid,
    discogsReleaseId,
    discogsUrl,
    lastfmUrl,
    // Remplace l'ancien « Année d'acquisition » : date exacte d'ajout à la
    // collection (AAAA-MM-JJ) — envoi snake_case `acquired_date` (FormData et
    // JSON ; camelCase toléré). Renvoie null si absente / invalide :
    //  - à la CRÉATION, l'INSERT ne fournit alors pas la valeur -> la colonne
    //    prend son défaut d'aujourd'hui (CURRENT_DATE, migration 004/007) ;
    //  - en ÉDITION, l'UPDATE utilise COALESCE($n, acquired_date) pour
    //    conserver la date existante. Prérequis : la colonne `acquired_date`
    //    EXISTE dans la base — sinon Postgres renvoie le 42703
    //    « column "acquired_date" does not exist » (migration 007 +
    //    auto-migration « vinyls.added-date » montée au boot, db.js).
    acquiredDate: parseAcquiredDate(body.acquired_date ?? body.acquiredDate),
    notes: body.notes ? String(body.notes).trim() : null,
    // Options du disque (rangée horizontale du formulaire) — mêmes entrées
    // snake_case / camelCase que le reste, avec tolérance des chaînes texte.
    // « Type de Disque » (menu déroulant, 1er élément de la rangée) :
    // « Vinyle » (défaut — option « Disque Vinyle » renommée) ou « Compact ».
    // Toute autre valeur (vide, incohérente, typographié…) retombe sur le
    // défaut « Vinyle » — aucun blanc stocké en base (colonne NOT NULL).
    discType: /^\s*(vinyle|compact)\s*$/i.test(String(body.disc_type ?? body.discType ?? ''))
      ? (/^vinyle$/i.test(String(body.disc_type ?? body.discType).trim()) ? 'Vinyle' : 'Compact')
      : 'Vinyle',
    isSpecialEdition: asBoolean(
      body.is_special_edition ?? body.isSpecialEdition,
      false
    ),
    pictureDisc: asBoolean(body.is_picture_disc ?? body.pictureDisc, false),
    // 1 → 5 garé dans la plage (colonne CHECK BETWEEN 1 AND 5, migration 006) :
    // une valeur absente / invalide retombe sur le défaut 1 ; hors plage -> bornes.
    discsCount: Math.min(
      5,
      Math.max(1, toInteger(body.discs_count ?? body.discsCount, 1))
    ),
    // Couleur de la galette (VARCHAR) : jamais null — défaut « Noir ».
    discColor: String(body.color || '').trim() || DEFAULT_DISC_COLOR,
  };
  return { values };
}


/**
 * GET /api/vinyls — collection de l'utilisateur courant.
 * Recherche optionnelle ?q=(artiste/titre/genre/label).
 */
async function listMyVinyls(req, res, next) {
  try {
    const q = String(req.query.q || '').trim();
    let sql = 'SELECT * FROM vinyls WHERE user_id = $1';
    const params = [req.user.id];
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (artist ILIKE $2 OR title ILIKE $2 OR genre ILIKE $2
                    OR label ILIKE $2 OR barcode ILIKE $2)`;
    }
    sql += ' ORDER BY release_date DESC NULLS LAST, created_at DESC';
    const { rows } = await query(sql, params);
    return res.json({ vinyls: rows.map(toVinylDto), total: rows.length });
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/vinyls/user/:userId — collection d'un UTILISATEUR DONNÉ.
 * Propriétaire ou admin uniquement (l'admin gère toutes les collections).
 */
async function listVinylsByUser(req, res, next) {
  try {
    const userId = Number(req.params.userId);
    if (!canEditItem(req.user, userId)) {
      return res.status(403).json({ error: 'Accès réservé au propriétaire ou à un administrateur.' });
    }
    const q = String(req.query.q || '').trim();
    let sql = 'SELECT * FROM vinyls WHERE user_id = $1';
    const params = [userId];
    if (q) {
      params.push(`%${q}%`);
      sql += ` AND (artist ILIKE $2 OR title ILIKE $2 OR genre ILIKE $2
                    OR label ILIKE $2 OR barcode ILIKE $2)`;
    }
    sql += ' ORDER BY release_date DESC NULLS LAST, created_at DESC';
    const { rows } = await query(sql, params);
    const { rows: ownerRows } = await query(
      'SELECT id, login, first_name, last_name FROM users WHERE id = $1',
      [userId]
    );
    const owner = ownerRows[0] || { id: userId, login: '—', firstName: '', lastName: '' };
    return res.json({
      vinyls: rows.map(toVinylDto),
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

/**
 * GET /api/vinyls/public — disques des collections PUBLIQUES (lecture seule).
 * ?q= recherche, ?genre= filtre, ?label= filtre.
 */
async function listPublicVinyls(req, res, next) {
  try {
    const q = String(req.query.q || '').trim();
    const genre = String(req.query.genre || '').trim();
    const label = String(req.query.label || '').trim();
    // Partage granulaire : un user public n'expose ses disques que s'il
    // a conservé share_vinyls = TRUE.
    const clauses = ["u.is_public = TRUE", "u.share_vinyls = TRUE"];
    const params = [];
    if (q) {
      params.push(`%${q}%`);
      clauses.push(`(v.artist ILIKE $${params.length} OR v.title ILIKE $${params.length}
                    OR v.barcode ILIKE $${params.length})`);
    }
    if (genre) {
      params.push(`%${genre}%`);
      clauses.push(`(v.genre ILIKE $${params.length})`);
    }
    if (label) {
      params.push(`%${label}%`);
      clauses.push(`(v.label ILIKE $${params.length})`);
    }
    const sql = `
      SELECT v.*, u.first_name AS owner_first_name, u.last_name AS owner_last_name
      FROM vinyls v
      JOIN users u ON u.id = v.user_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY v.release_date DESC NULLS LAST, v.created_at DESC`;
    const { rows } = await query(sql, params);
    const dto = rows.map((row) => ({
      ...toVinylDto(row),
      owner: {
        firstName: row.owner_first_name,
        lastName: row.owner_last_name,
      },
    }));
    return res.json({ vinyls: dto, total: dto.length });
  } catch (err) {
    return next(err);
  }
}

/**
 * POST /api/vinyls — création (jaquette téléversée en multipart ou URL distante).
 */
async function createVinyl(req, res, next) {
  try {
    const { error, values } = cleanVinyl(req.body);
    if (error) {
      // Échec de validation AVANT toute écriture : les fichiers éventuellement
      // déposés par multer (jaquette / photo d'artiste) sont des orphelins —
      // on les retire du volume.
      uploadedFilesOf(req).forEach((f) => {
        if (f && f.path) { try { fs.rmSync(f.path, { force: true }); } catch {} }
      });
      return res.status(400).json({ error });
    }
    // --------------------------------------------------------------
    // PROPAGATION DU GENRE MUSICAL — règle définitive (vérification
    // préalable EN BASE avant l'INSERT) :
    //   CAS A — PREMIER DISQUE de l'artiste (aucun disque déjà enregistré
    //   pour ce nom, tous users) : le genre importé par l'API et laissé tel
    //   quel, ou saisi / modifié manuellement par l'utilisateur, est
    //   enregistré tel quel. Il devient la RÉFÉRENCE IMMUEBLE de l'artiste.
    //   CAS B — DISQUES SUIVANTS (l'artiste possède déjà au moins un disque)
    //   : le genre renvoyé par l'API / le formulaire est IGNORÉ ; le nouveau
    //   disque reçoit AUTOMATIQUEMENT le genre du TOUT PREMIER disque de cet
    //   artiste déjà stocké en base (le plus ancien par created_at, puis id).
    //   RÈGLE ABSOLUE : les genres des disques déjà présents dans la
    //   collection ne sont JAMAIS mis à jour, modifiés ou écrasés — la
    //   propagation s'applique uniquement EN CASCADE DESCENDANTE vers les
    //   nouveaux ajouts (aucun UPDATE de genre sur les lignes existantes).
    // --------------------------------------------------------------
    const existingGenre = await firstDiscGenreOfArtist(values.artist);
    if (existingGenre) {
      // CAS B : artiste déjà référencé -> le genre du formulaire / de l'API
      // est ignoré, celui du tout premier disque est imposé au nouveau disque.
      values.genre = existingGenre;
    } else if (!values.genre) {
      // CAS A (premier disque) sans genre fourni : repli sur le genre porté
      // par l'ENTITÉ Artiste (table `artists`) — lecture seule, non bloquante
      // (base non migrée -> null : aucun pré-remplissage).
      values.genre = await defaultGenreOfArtist(values.artist);
    }
    const coverUrl = await resolveCover(req);
    if (!coverUrl) {
      // La route utilise upload.fields() : les fichiers arrivent dans
      // req.files champ par champ (jaquette "cover" + photo "artistImage") —
      // ⚠ sous forme d'OBJET { champ: [fichier…] } (aplati via uploadedFilesOf ;
      // une lecture listique `req.files.length` valait undefined et nettoyait
      // RIEN : fichiers orphelins sur le volume). En cas d'échec, on retire
      // TOUS les fichiers reçus du volume.
      uploadedFilesOf(req).forEach((f) => {
        if (f && f.path) { try { fs.rmSync(f.path, { force: true }); } catch {} }
      });
      return res.status(400).json({
        error: 'Jaquette requise : téléversez un fichier ou renseignez une URL distante.',
      });
    }
    // --------------------------------------------------------------
    // IMAGE D'ARTISTE (photo / logo) — portée par la colonne
    // `vinyls.artist_image` : 1. si le formulaire en fournit une
    // (champ "artistImage" ou URL distante), elle est utilisée ;
    // 2. sinon, artiste DÉJÀ RÉFÉRENCÉ (autre disque du même nom) : on
    //    réutilise l'image déjà stockée — tous les disques d'un artiste
    //    affichent la même photo dans la grille « Mes Disques » ;
    // 3. sinon : recherche automatique — CASCADE Last.fm (priorité) ->
    //    Discogs / MusicBrainz + Cover Art Archive, téléchargée localement ;
    //    en cas d'ÉCHEC OU D'ABSENCE DE RÉSULTAT, repli PROPRE sur l'image
    //    par défaut locale img/no_group.jpg — la création du disque n'est
    //    JAMAIS bloquée. Cette image ne sert QUE dans la grille « Mes Disques
    //    » : elle n'affecte EN RIEN la jaquette d'album ci-dessus.
    // --------------------------------------------------------------
    let artistImage;
    let artistId = null; // id de l'entité Artiste (null si table `artists` absente)
    // Image d'ARTISTE fournie par le formulaire — connue AVANT le try pour que
    // le catch ci-dessous (panne de propagation à l'entité) sache ce qu'il DOIT
    // conserver : une image manuelle RÉSOLUE avec succès (fichier fraîchement
    // uploadé par multer, OU URL distante déjà téléchargée sur le volume) EST le
    // choix de l'utilisateur : elle est écrite sur la ligne même si
    // syncArtistEntity échoue — jamais supprimée ni remplacée par le repli
    // img/no_group.jpg (sinon le fichier téléchargé/uploadé serait un orphelin
    // jamais référencé). Seule une résolution EN COURS d'échec (téléchargement
    // qui lève) retombe sur le repli : rien n'est écrit alors.
    let manualArtistImage = null;
    let manualKeepOnCatch = false;
    try {
      manualArtistImage = await resolveArtistImage(req);
      if (manualArtistImage) manualKeepOnCatch = true;
      // GARDE-FOU ARTISTE/JAQUETTE (DANS createVinyl) : une image MANUELLE
      // identique à la jaquette d'ALBUM du disque en cours est REJETÉE AVANT
      // toute propagation à l'entité — jamais la couverture d'un disque ne
      // devient sa photo (ni la photo de l'ARTISTE) ; le fichier uploadé est
      // retiré du volume et on repart sur la chaîne de replis ci-dessous.
      if (manualArtistImage && coverUrl && stripOrigin(manualArtistImage) === stripOrigin(coverUrl)) {
        console.warn(`[artistImage] Refus d'inscrire la jaquette du disque dans artist_image (${manualArtistImage}) : image manuelle ignorée, repli automatique.`);
        // ⚠ « fields() » : req.files est un OBJET { champ: [fichier…] } — jamais
        // une liste (uploadedFilesOf gère les deux formes) ; sans cette forme,
        // le fichier rejeté ne serait jamais retiré du volume (orphelin).
        const rejectedFile = uploadedFileOf(req, 'artistImage');
        if (rejectedFile) {
          try { fs.rmSync(rejectedFile.path, { force: true }); } catch {}
        }
        // Fichier rejeté : plus rien à conserver (déjà retiré du volume) — on
        // repart sur la chaîne de replis ci-dessous (artiste déjà référencé,
        // sinon recherche auto) : à NULL ici pour que le `if` suivant retombe
        // dans la cascade au lieu de laisser `artistImage` indéfini (null en
        // base -> image par défaut, choix de l'utilisateur perdu).
        manualKeepOnCatch = false;
        manualArtistImage = null;
      }
      if (manualArtistImage) {
        // 1) Image MANUELLE fournie par le formulaire : elle prime. L'entité
        //    artiste est créée / mise à jour avec cette photo — et, si
        //    d'autres disques de cet utilisateur partagent déjà l'entité,
        //    ils adoptent la même image (grille « Mes Disques » cohérente).
        // PROPAGATION à l'entité + TOUS les disques de cet artiste (tous
        // users, lignes legacy comprises) : la tuile du groupe « Mes Disques »
        // affiche alors partout la même photo.
        const synced = await syncArtistEntity(values.artist, manualArtistImage);
        artistId = synced.artistId || null;
        artistImage = manualArtistImage;
      } else {
        // 2. Artiste DÉJÀ RÉFÉRENCÉ : on réutilise l'image (et l'entité) déjà
        //    stockée — tous les disques d'un artiste affichent LA MÊME photo ;
        // 3. Nouveau artiste : recherche automatique (CASCADE Last.fm ->
        //    Discogs / MusicBrainz + Cover Art Archive), téléchargée localement,
        //    repli PROPRE sur img/no_group.jpg.
        const found = await existingArtistWithImage(values.artist);
        // DISSOCIATION ARTISTE/JAQUETTE : une image déjà réutilisée qui EST en
        // réalité la jaquette d'ALBUM DÉPOSÉE EN COURS — ou d'au moins un autre
        // disque déjà enregistré (lignes contaminées historiques) — est ICI
        // refusée ; on repart alors sur la cascade automatique.
        // repart sur la cascade automatique (repli propre img/no_group.jpg).
        if (
          found &&
          ((coverUrl && stripOrigin(found.image) === stripOrigin(coverUrl)) ||
            (await isStoredAlbumCover(found.image)))
        ) {
          found = null;
        }
        if (found) {
          artistImage = found.image;
          artistId =
            found.artistId != null
              ? found.artistId
              : (await ensureArtist(values.artist, found.image)).artistId || null;
        } else {
          const fetched = await autoFetchArtistImage(values.artist);
          artistId = (await ensureArtist(values.artist, fetched)).artistId || null;
          artistImage = fetched;
        }
      }
    } catch (err) {
      // Non bloquant : toute panne (URL distante injoignable, base partiellement
      // migrée « artists »…) n'empêche JAMAIS la création du disque.
      console.warn(
        '[artistImage] Résolution de l\'image d\'artiste impossible — choix de ' +
          'l\'utilisateur conservé si un fichier a été téléversé, sinon repli ' +
          'img/no_group.jpg :',
        err.message
      );
      if (manualKeepOnCatch && manualArtistImage) {
        // FICHIER DÉJÀ DÉPOSÉ PAR MULTER avant toute erreur : il EST le choix
        // de l'utilisateur — il est CONSERVÉ sur disque et ÉCRIT sur la ligne,
        // jamais supprimé ni remplacé par le repli par défaut (même si la
        // propagation à l'entité a échoué ; celle-ci se retentera au prochain
        // enregistrement d'un disque de cet artiste). ⚠ Ne PAS appeler
        // removeUnusedArtistFiles ici : elle supprimerait le fichier que nous
        // précisons ici (c'est le choix de l'utilisateur, conservé sur disque).
        artistId = null; // entité non rattachée (rattachée au prochain enregistrement)
        artistImage = manualArtistImage;
      } else {
        // Aucun fichier à conserver (échec du téléchargement d'une URL distante,
        // échec pendant/avant la résolution, ou upload rejeté par la garde-
        // fou artiste/jaquette) : nettoyage éventuel + repli propre.
        removeUnusedArtistFiles(req.files);
        artistImage = ARTIST_NO_GROUP_URL;
      }
    }
    const { rows } = await query(
      `INSERT INTO vinyls (user_id, cover_url, artist, artist_id, artist_image, title, track_count, tracklist,
                           genre, label, release_date, barcode, mbid, discogs_release_id,
                           discogs_url, lastfm_url, acquired_date, notes, disc_type,
                           is_special_edition,
                           is_picture_disc, discs_count, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
               COALESCE($17, CURRENT_DATE), $18, $19, $20, $21, $22, $23)
       RETURNING *`,
      [
        req.user.id,
        coverUrl,
        values.artist,
        // ENTITÉ ARTISTE : id (null si la table artists est absente, cf.
        // auto-migration « artists.table » de config/db.js) + photo / logo d'artiste
        // avec repli propre « /img/no_group.jpg ». Colonne VARCHAR/TEXT :
        // jamais null en base (défaut img/no_group.jpg), donc pas de COALESCE.
        artistId,
        artistImage,
        values.title,
        values.trackCount,
        values.tracklist,
        values.genre,
        values.label,
        values.releaseDate,
        values.barcode,
        values.mbid,
        values.discogsReleaseId,
        values.discogsUrl,
        // Fiche Last.fm (source PRIORITAIRE de la cascade d'import) : URL de
        // la fiche album — provenance persistée de la jaquette / métadonnées.
        values.lastfmUrl || null,
        // « Date d'ajout » : null si le formulaire n'en fournit pas ->
        // la colonne prend CURRENT_DATE (défaut d'aujourd'hui).
        values.acquiredDate || null,
        values.notes,
        // « Type de Disque » (« Vinyle » / « Compact », défaut « Vinyle » —
        // proprement normalisé par cleanVinyl ; colonne NOT NULL).
        values.discType,
        // Options du disque (defaults de boiserie en cas d'absence) :
        // édition spéciale, picture disc, nombre de galettes, couleur.
        values.isSpecialEdition,
        values.pictureDisc,
        values.discsCount,
        values.discColor,
      ]
    );
    // --------------------------------------------------------------
    // GENRE DE RÉFÉRENCE DE L'ARTISTE (table `artists`) : seul le CAS A —
    // PREMIER DISQUE de l'artiste — écrit le genre sur l'ENTITÉ Artiste : il
    // devient la référence immuable des futurs albums. CAS B : l'entité est
    // JAMAIS retouchée (le genre du tout premier disque reste la référence —
    // jamais mis à jour, modifié ou écrasé). SANS retoucher les disques déjà
    // enregistrés (ni celui-ci, ni aucun autre). Non bloquant : toute panne ne
    // doit jamais empêcher la création du disque — le genre reste écrit sur la
    // ligne courante par l'INSERT ci-dessus.
    // --------------------------------------------------------------
    if (!existingGenre && values.genre) {
      try {
        await syncArtistGenre(values.artist, values.genre);
      } catch (err) {
        console.warn(
          `[genre] Propagation du genre « ${values.genre} » à l'artiste « ${values.artist} » impossible :`,
          err.message
        );
      }
    }
    return res.status(201).json({ vinyl: toVinylDto(rows[0]) });
  } catch (err) {
    if (err instanceof MusicBrainzError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Un disque avec ce code-barres existe déjà.' });
    }
    // Code 42703 = colonne inexistente : diagnostic explicite plutôt que le
    // message brut Postgres (appliquer la migration 007 résout le problème).
    if (err.code === '42703') {
      console.error('[vinylController] Colonne absente de la base :', err.message,
        '-> appliquer database/migrations/007_ensure_vinyl_acquired_date.sql');
      return res.status(500).json({
        error: 'Base de données incomplète (colonne absente) : appliquez la migration 007 puis relancez l’API.',
      });
    }
    // Symétrique de comicController : toute panne APRÈS le dépôt des fichiers
    // par multer mais AVANT l'INSERT (contrainte NOT NULL, disque plein,
    // pool DB…) laisse les fichiers déposés sur le volume sans aucune ligne
    // qui les référence — orphelins. On les retire avant de remonter l'erreur.
    uploadedFilesOf(req).forEach((f) => {
      if (f && f.path) { try { fs.rmSync(f.path, { force: true }); } catch {} }
    });
    return next(err);
  }
}

/**
 * Supprime le fichier local de jaquette décrit par le chemin stocké en base
 * ("/uploads/vinyls/<fichier>" ou "/uploads/<fichier>" pour les anciennes
 * lignes). Résout d'abord le chemin physique réel (avec gestion du
 * sous-dossier "vinyls/") pour que le bon fichier soit retiré.
 */
function deleteLocalCoverFile(coverUrl) {
  const raw = normalizeStoredCoverPath(coverUrl);
  if (!raw.startsWith('/uploads/')) return;
  const rel = raw.slice('/uploads/'.length).split(/[\/\\]/).filter(Boolean).join('/');
  if (!rel) return;
  const candidates = [
    path.join(env.uploadDir, rel),
    path.join(env.uploadDir, 'vinyls', rel),
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
}

/**
 * PUT /api/vinyls/:id — modification (jaquette remplaçable, même règle).
 */
async function updateVinyl(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT * FROM vinyls WHERE id = $1', [id]);
    const vinyl = rows[0];
    if (!vinyl) return res.status(404).json({ error: 'Disque introuvable.' });
    if (!canEditItem(req.user, vinyl.user_id)) {
      return res.status(403).json({ error: 'Seul le propriétaire ou un administrateur peut modifier ce disque.' });
    }

    // --------------------------------------------------------------
    // IMAGE D'ARTISTE UPLOADÉE MANUELLEMENT — PRIORITÉ ABSOLUE :
    // dès qu'un fichier « artistImage » est présent dans la requête
    // (multipart/form-data via multer, cf. routes/vinylRoutes.js), son
    // chemin de stockage local est récupéré IMMÉDIATEMENT — avant toute
    // lecture du body, résolution de jaquette ou logique de repli. La
    // requête SQL UPDATE ci-dessous met alors EXPLICITEMENT la colonne
    // `vinyls.artist_image` à ce chemin (bloc « PRIORITÉ ABSOLUE » après
    // l'UPDATE), et toute étape susceptible de l'écraser par NULL
    // (drapeau remove_artist_image, purge contamination legacy) ou de la
    // replacer par l'ancienne photo (COALESCE « conserver » / cascade auto
    // d'adoption) est neutralisée dès que ce chemin a été écrit. Jamais
    // l'inverse : le fichier fraîchement stocké n'est ni supprimé, ni évincé.
    // --------------------------------------------------------------
    // ⚠ « fields() » : req.files est un OBJET { champ: [fichier…] } — jamais
    // une liste (uploadedFilesOf gère les deux formes). Avant cette correction,
    // la lecture listique ne trouvait JAMAIS le fichier importé : il restait
    // déposé sur disque (orphelin) et la colonne artist_image était conservée
    // au COALESCE / reconquise par la cascade — exactement le bug signalé.
    // « let » : la branche de SUPPRESSION EXPLICITE ci-dessous peut le
    // neutraliser (fichier retiré du volume -> le chemin ne doit plus être
    // écrit sur la colonne par le bloc « PRIORITÉ ABSOLUE »).
    const manualArtistFile = uploadedFileOf(req, 'artistImage');
    let manualArtistUploadPath = manualArtistFile ? localArtistFilePath(manualArtistFile) : null;

    const { error, values } = cleanVinyl(req.body);
    if (error) return res.status(400).json({ error });

    // --------------------------------------------------------------
    // PROPAGATION DU GENRE MUSICAL — règle définitive (vérification
    // préalable EN BASE avant l'UPDATE) :
    //   CAS A — PREMIER DISQUE de l'artiste (aucun AUTRE disque déjà
    //   enregistré pour ce nom, tous users) : le genre importé par l'API et
    //   laissé tel quel, ou saisi / modifié manuellement par l'utilisateur,
    //   est enregistré tel quel. Il devient la RÉFÉRENCE IMMUEBLE de
    //   l'artiste.
    //   CAS B — DISQUES SUIVANTS (l'artiste possède déjà au moins un AUTRE
    //   disque) : le genre renvoyé par l'API / le formulaire est IGNORÉ ; le
    //   disque reçoit AUTOMATIQUEMENT le genre du TOUT PREMIER disque de cet
    //   artiste déjà stocké en base (le plus ancien par created_at, puis id).
    //   RÈGLE ABSOLUE : les genres des disques déjà présents dans la
    //   collection ne sont JAMAIS mis à jour, modifiés ou écrasés — la
    //   propagation s'applique uniquement EN CASCADE DESCENDANTE vers les
    //   nouveaux ajouts (aucun UPDATE de genre sur les lignes existantes).
    // --------------------------------------------------------------
    const existingGenre = await firstDiscGenreOfArtist(values.artist);
    if (existingGenre) {
      // CAS B : artiste déjà référencé -> le genre du formulaire / de l'API
      // est ignoré, celui du tout premier disque est imposé au disque édité.
      values.genre = existingGenre;
    } else if (!values.genre) {
      // CAS A (premier disque) sans genre fourni : repli sur le genre porté
      // par l'ENTITÉ Artiste (table `artists`) — lecture seule, non bloquante
      // (base non migrée -> null : aucun pré-remplissage).
      values.genre = await defaultGenreOfArtist(values.artist);
    }

    // ------------------------------------------------------------
    // SUPPRESSION EXPLICITE des images (bouton « Retirer le fichier » du
    // formulaire « Modifier le disque ») — drapeaux booléens envoyés par le
    // frontend (FormData ou JSON, "true"/true) :
    //  - remove_cover=true        -> colonne cover_url   ÉCRASÉE par NULL ;
    //  - remove_artist_image=true -> colonne artist_image ÉCRASÉE par NULL
    //      (jamais l'ancienne photo conservée, jamais la jaquette d'album) —
    //      tuiles « Mes Disques » sur l'image de secours img/no_group.jpg.
    // Ils PRIMENT sur toute autre donnée de la requête (fichier « cover » /
    // « artistImage », URL distante, chemin local repassé tel quel) : sans
    // cette garde, le COALESCE du dessous — ou le repli « conserve la
    // jaquette courante » via coverRemoteUrl, ou la cascade auto qui aurait
    // réattribué une photo d'artiste — réexposerait l'image retirée.
    // ------------------------------------------------------------
    const wantRemoveCover = asBoolean(req.body.remove_cover ?? req.body.removeCover);
    const wantRemoveArtistImage = asBoolean(
      req.body.remove_artist_image ?? req.body.removeArtistImage
    );

    let coverUrl = vinyl.cover_url;
    if (wantRemoveCover) {
      // SUPPRESSION EXPLICITE de la jaquette : NULL forcé sur cover_url. Un
      // fichier « cover » fourni malgré le drapeau est retiré du volume, et
      // l'ancienne jaquette locale est nettoyée (chemin par disque — jamais
      // partagé avec une autre ligne).
      // ⚠ « fields() » : req.files est un OBJET { champ: [fichier…] } — jamais
      // une liste (uploadedFilesOf gère les deux formes) ; sinon le fichier
      // rejeté ne serait jamais retiré du volume (orphelin).
      const rejectedCover = uploadedFileOf(req, 'cover');
      if (rejectedCover) {
        try { fs.rmSync(rejectedCover.path, { force: true }); } catch {}
      }
      if (vinyl.cover_url) deleteLocalCoverFile(vinyl.cover_url);
      coverUrl = null;
    } else {
      // En l'absence de nouvelle jaquette, "coverRemoteUrl" contient le chemin
      // local existant : resolveCover le détecte et renvoie null (on conserve
      // la jaquette actuelle au lieu de lever une erreur 400).
      const newCover = await resolveCover(req, vinyl.cover_url);
      if (newCover) {
        coverUrl = newCover;
        if (newCover.startsWith('/uploads/')) {
          // Retire l'ancienne jaquette locale (chemin physique résolu avec ou
          // sans le sous-dossier "vinyls/") lorsqu'elle diffère du nouveau
          // chemin stocké.
          if (String(vinyl.cover_url || '') !== newCover) {
            deleteLocalCoverFile(vinyl.cover_url);
          }
        }
      }
    }
    // --------------------------------------------------------------
    // ENTITÉ ARTISTE (photo / logo) — mise à jour associée : si le formulaire
    // en fournit une, l'image d'artiste est remplacée (image téléversée dans
    // le champ "artistImage" ou télé chargée depuis "artistImageRemoteUrl"),
    // sinon l'image courante de l'entité est conservée. En cas de renommage
    // de l'artiste, on rattache l'entité existante correspondante (sans créer
    // de doublon) — cette image ne sert QUE dans la grille « Mes Disques ».
    // --------------------------------------------------------------
    let artistId = vinyl.artist_id || null;
    let artistImage = null; // null -> on conserve l'image courante (COALESCE)
    // Image d'ARTISTE fournie par le formulaire — connue AVANT le try pour que
    // le catch ci-dessous (panne de propagation à l'entité) sache ce qu'il DOIT
    // conserver : une image manuelle RÉSOLUE avec succès (fichier fraîchement
    // uploadé par multer, OU URL distante déjà téléchargée sur le volume) EST le
    // choix de l'utilisateur : elle est écrite sur la ligne (écrasement du
    // COALESCE « conserver l'ancienne valeur ») — jamais supprimée ni remplacée
    // par l'image courante. Seule une résolution EN COURS d'échec tombe au
    // COALESCE : rien n'est écrit alors.
    let manualArtistImage = null;
    let manualKeepOnCatch = false;
    if (wantRemoveArtistImage) {
      // ------------------------------------------------------------
      // SUPPRESSION EXPLICITE de l'image d'ARTISTE (bouton « Retirer le
      // fichier » du formulaire) : la colonne artist_image de CETTE LIGNE est
      // ÉCRASÉE par NULL — l'ancienne photo n'est plus conservée ni réexposée
      // par le COALESCE, et JAMAIS la jaquette d'album (cover_url) ne remplit
      // la colonne : dissociation totale. NULL ne pouvant traverser le
      // COALESCE SQL du UPDATE principal (null = « conserver »), la purge est
      // faite explicitement APRÈS l'UPDATE (voir bloc
      // « PURGE EXPLICITE » ci-dessous). L'image d'artiste étant GLOBALE
      // (partagée entre TOUS les disques d'un même artiste, tous users), la
      // suppression se propage à l'entité + à toutes ses lignes : plus aucune
      // image n'est réutilisable au prochain enregistrement (ni via
      // existingArtistWithImage) et l'ancien fichier local orphelin y est
      // nettoyé. Les tuiles « Mes Disques » affichent alors l'image de secours
      // locale img/no_group.jpg — exactement ce que le formulaire montre après
      // la suppression. Un fichier « artistImage » fourni malgré le drapeau ne
      // rétablit AUCUNE image (retiré du volume).
      // ------------------------------------------------------------
      // ⚠ « fields() » : req.files est un OBJET { champ: [fichier…] } — jamais
      // une liste (uploadedFilesOf gère les deux formes) ; sinon les fichiers
      // déposés par multer (et tout fichier téléchargé depuis une URL distante)
      // resteraient des ORPHELINS sur le volume.
      uploadedFilesOf(req).forEach((f) => {
        if (f && f.path) { try { fs.rmSync(f.path, { force: true }); } catch {} }
      });
      // ⚠ Le fichier « artistImage » fourni malgré le drapeau vient d'être
      // retiré du volume : le bloc « PRIORITÉ ABSOLUE » post-UPDATE ne doit
      // PAS écrire SON chemin sur la colonne (il pointerait vers un fichier
      // inexistant — 404 garanti). On neutralise le flag ici.
      if (manualArtistUploadPath) manualArtistUploadPath = null;
      artistId = null; // COALESCE SQL : on conserve le rattachement courant à l'entité
      try {
        await removeArtistImageGlobally(values.artist, vinyl.artist_id || null);
      } catch (err) {
        // Non bloquant (base non migrée « artists »…) : la purge NULL de la
        // ligne courante ci-dessous s'applique quand même.
        console.warn(`[artistImage] Purge globale de l'image d'artiste impossible (« ${values.artist} ») :`, err.message);
      }
    } else {
      // ⚠ Un fichier « artistImage » uploadé par multer est LA nouvelle photo
      // de l'artiste, quel que soit l'état courant en base — son chemin local
      // est déjà connu (manualArtistUploadPath, tête de l'action) : il n'est
      // PAS une URL distante et ne passe PAS par resolveArtistImage. Avant
      // cette correction la condition ci-devant (!manualArtistUploadPath)
      // SAUTAIT TOUTE cette branche en cas de fichier uploadé : l'édition
      // écrivait la ligne courante via « PRIORITÉ ABSOLUE » mais ne propageait
      // NI à l'entité Artiste, NI aux autres disques du même artiste (la tuile
      // du groupe « Mes Disques » restait sur l'ancienne photo — le désajout
      // signalé). Le fichier uploadé suit exactement le même chemin que la
      // URL distante : syncArtistEntity + écriture de la ligne.
      try {
        if (manualArtistUploadPath) {
          manualArtistImage = manualArtistUploadPath;
        } else {
          manualArtistImage = await resolveArtistImage(req);
        }
        // Fichier DÉPOSÉ PAR MULTER avant l'action (champ « artistImage ») : il
        // EST le choix de l'utilisateur — le catch ci-dessous le conserve et
        // l'écrit sur la ligne même si la propagation à l'entité échoue.
        if (manualArtistImage && uploadedFileOf(req, 'artistImage')) {
          manualKeepOnCatch = true;
        }
        if (manualArtistImage) {
          // 1. Le formulaire fournit une photo / logo : création de l'entité
        //    avec cette image si elle n'existe pas, remplacement sinon.
        //    L'entité Artiste est GLOBALE : toutes les lignes de cet artiste
        //    (tous users) adoptent la nouvelle photo — y compris les lignes
        //    legacy sans entité (artist_id IS NULL, rattachement par nom).
        // PROPAGATION à l'entité + TOUS les disques de cet artiste (tous
        // users, lignes legacy comprises) : même routine que createVinyl /
        // syncSeriesEntity côté BD — l'ancien fichier local orphelin y est
        // nettoyé après la bascule.
        const synced = await syncArtistEntity(values.artist, manualArtistImage);
        artistId = synced.artistId || null;
        artistImage = manualArtistImage;
      } else {
        const renamed = values.artist !== String(vinyl.artist || '').trim();
        let targetId = artistId; // conserve l'entité courante par défaut
        let adoptedImage = null;
        if (renamed) {
          // 2. RENOMMAGE : adopte l'image déjà stockée pour le NOUVEAU nom
          //    (tous les disques de cet artiste repartagent la même photo).
          const found = await existingArtistWithImage(values.artist);
          if (found) {
            targetId = found.artistId != null ? found.artistId : null;
            adoptedImage = found.image || null;
            // DISSOCIATION ARTISTE/JAQUETTE : une image « déjà stockée » qui
            // EST la jaquette d'ALBUM du disque en cours — voire d'AUTO autre
            // disque déjà enregistré (lignes contaminées historiques) — est
            // refusée (repli automatique ci-dessous) : jamais la couverture
            // d'un disque en photo d'artiste.
            if (
              adoptedImage &&
              ((coverUrl && stripOrigin(adoptedImage) === stripOrigin(coverUrl)) ||
                (await isStoredAlbumCover(adoptedImage)))
            ) {
              adoptedImage = null;
            }
          }
        } else if (!artistId && String(vinyl.artist_image || '').trim()) {
          // Ligne legacy sans entité : création de l'entité avec son image —
          // SAUF CONTAMINATION : si la colonne porte la jaquette d'ALBUM de la
          // LIGNE elle-même (état historique du bug), on ne crée pas l'entité
          // avec ce visuel (propagation interdite à tous les disques de
          // l'artiste) ; on repart sur la cascade automatique.
          if (isArtistCoverContamination(vinyl)) {
            adoptedImage = null;
          } else {
            adoptedImage = vinyl.artist_image;
          }
        }
        if (targetId == null) {
          targetId =
            (await ensureArtist(values.artist, adoptedImage)).artistId || null;
        }
        if (adoptedImage) {
          artistImage = adoptedImage; // image trouvée existante : on l'adopte
        } else if (!renamed && String(vinyl.artist_image || '').trim()) {
          artistImage = null; // rien de nouveau : on conserve la valeur courante
        } else {
          // 3. Nouvel artiste sans image connue (ou ligne legacy sans image) :
          //    recherche AUTOMATIQUE (CASCADE Last.fm -> Discogs / MusicBrainz
          //    + Cover Art Archive), repli propre img/no_group.jpg. L'entité
          //    reçoit la photo trouvée.
          const fetched = await autoFetchArtistImage(values.artist);
          if (targetId != null) await ensureArtist(values.artist, fetched);
          artistImage = fetched;
        }
        artistId = targetId;
      }
     } catch (err) {
       // Non bloquant : table `artists` absente (base non migrée, cf. auto-
       // migration « artists.table » de config/db.js), URL distante injoignable…
       // Une image manuelle déjà résolue (fichier uploadé / téléchargement)
       // EST le choix de l'utilisateur : conservée + écrite sur la ligne ;
       // sinon nettoyage éventuel + COALESCE « conserver l'état en base ».
       console.error(
         '[vinylController] Entité artiste indisponible, reprise (choix de ' +
           'l\'utilisateur conservé si une image manuelle a été résolue) :',
         err.message
       );
       if (manualKeepOnCatch && manualArtistImage) {
         // Image manuelle DÉJÀ RÉSOLUE avant l'erreur (fichier fraîchement
         // uploadé par multer OU URL distante déjà téléchargée) : elle EST le
         // choix de l'utilisateur — CONSERVÉE sur disque et ÉCRITE sur la ligne
         // (jamais d'abandon au COALESCE « conserver l'ancienne valeur »).
         // ⚠ removeUnusedArtistFiles NON appelée ici : elle supprimerait le
         // fichier que nous écrivons. La propagation à l'entité se retentera
         // au prochain enregistrement d'un disque de cet artiste.
         artistId = vinyl.artist_id || null; // entité non rattachée pour l'instant
         artistImage = manualArtistImage;
       } else {
         // Aucune image manuelle à conserver : nettoyage éventuel du fichier
         // reçu + COALESCE « conserver l'état en base ».
         removeUnusedArtistFiles(req.files);
         artistId = vinyl.artist_id || null;
         artistImage = null;
       }
        } // fin try/catch interne de la branche « sans suppression explicite »
     } // fin else — branche artiste (fichier uploadé OU résolution repli)
     // Le bloc « PRIORITÉ ABSOLUE » ci-dessous réécrit EXPLICITEMENT la colonne
     // avec le chemin du fichier uploadé (manualArtistUploadPath, tête de
     // l'action) — jamais via le COALESCE du UPDATE principal : même si la
     // propagation ci-dessus a échoué partiellement, le choix de l'utilisateur
     // reste écrit sur LA LIGNE ÉDITÉE. Dès qu'un fichier a été présent, la
     // propagation ENTITÉ + autres disques a déjà eu lieu dans la branche
     // ci-dessus (syncArtistEntity) — plus aucun « saut » possible.

    const updated = await query(
      `UPDATE vinyls SET artist=$1, title=$2, track_count=$3, tracklist=$4, genre=$5,
                         label=$6, release_date=$7, barcode=$8, mbid=$9,
                         discogs_release_id=$10, discogs_url=$11, lastfm_url=$12,
                         acquired_date=COALESCE($13, acquired_date),
                         notes=$14, cover_url=$15, disc_type=$16,
                         is_special_edition=$17,
                         is_picture_disc=$18, discs_count=$19, color=$20,
                          artist_id=COALESCE($21, artist_id),
                          artist_image=COALESCE($22, artist_image)
        WHERE id=$23 RETURNING *`,
      [
        values.artist,
        values.title,
        values.trackCount,
        values.tracklist,
        values.genre,
        values.label,
        values.releaseDate,
        values.barcode,
        values.mbid,
        values.discogsReleaseId,
        values.discogsUrl,
        // Fiche Last.fm (source PRIORITAIRE de la cascade) : jamais le
        // COALESCE — la valeur du formulaire écrase (null = reprise sans
        // source Last.fm connue).
        values.lastfmUrl || null,
        // « Date d'ajout » : null -> on conserve la date existante en base.
        values.acquiredDate || null,
        values.notes,
        coverUrl,
        // « Type de Disque » (« Vinyle » / « Compact ») : toujours écrasé —
        // le formulaire est la source de vérité (défaut normalisé par
        // cleanVinyl ; colonne NOT NULL DEFAULT 'Vinyle').
        values.discType,
        // Options du disque : toujours écrasées (le formulaire est la source
        // de vérité ; les défauts sont portés par cleanVinyl).
        values.isSpecialEdition,
        values.pictureDisc,
        values.discsCount,
        values.discColor,
        // ENTITÉ ARTISTE (photo / logo) : id + image. COALESCE côté SQL :
        // null -> on conserve la valeur courante de la colonne.
        artistId,
        artistImage,
        // $23 : id de la ligne à mettre à jour (clause WHERE) — 23 PARAMÈTRES
        // pour 23 placeholders, comptez-les. Causes historiques du bug
        // « column "acquired_date" does not exist » sur le PUT, toutes
        // éliminées (ne pas les faire réapparaître) :
        //   (a) $19 absent ici -> 18 paramètres pour une requête à 19 slots
        //       (« bind message supplied 18 parameters, but prepared
        //       statement requires 19 »), qui masquait la vraie erreur SQL ;
        //   (b) colonne réellement absente sur une base partiellement migrée
        //       -> levée par la migration 007 / l'auto-migration « vinyls.
        //       added-date » appliquée au boot (config/db.js) — et ce
        //       mécanisme ne dépend plus de la bonne fortune du cascadeur : un
        //       échec d'une migration antérieure ne bloque plus les suivantes.
        // Un 42703 resté inexpliqué renvoie un message lisible (cf. catch
        // ci-dessous) ; réparation définitive via psql → migration 007.
        id,
      ]
    );

    // (SUPPRESSION EXPLICITE de l'image d'artiste : le bloc « PURGE EXPLICITE »
    // ci-dessous force NULL sur la ligne — la propagation globale entité +
    // autres disques a déjà eu lieu via removeArtistImageGlobally.)

    // PURGE / AUTO-RÉPARATION de l'image d'ARTISTE : déclenchée quand :
    //   a) SUPPRESSION EXPLICITE (bouton « Retirer le fichier », drapeau
    //      remove_artist_image=true) — la colonne DOIT porter NULL : jamais la
    //      photo antérieure, JAMAIS la jaquette d'album. Le COALESCE du UPDATE
    //      principal (« conserver » quand null) impose une purge explicite en
    //      SUITE sur la ligne courante ; l'affichage (tuile + formulaire)
    //      retombe sur l'image de secours locale img/no_group.jpg ;
    //   b) la colonne RÉSULTANTE de l'UPDATE ci-dessus EST en réalité la
    //      jaquette d'ALBUM de la ligne (contamination legacy conservée par le
    //      COALESCE — ligne historique jamais ré-éditée côté image, échec des
    //      branches ci-dessus compris) : purge NULL propre sans propagation à
    //      l'entité ni aux autres disques (leur colonne est PARTAGÉE, qu'on ne
    //      doit pas isoler des leurs ; le vieil fichier local éventuel n'est
    //      PAS touché ici). Non bloquant (base non migrée « artists »…) : on
    //      répond alors sur la ligne « pré-purge » — le DTO filtre la
    //      contamination de toute façon.
    // PRIORITÉ ABSOLUE — image d'ARTISTE uploadée MANUELLEMENT : dès que la
    // requête portait le fichier « artistImage », son chemin local
    // (récupéré IMMÉDIATEMENT en tête de l'action, cf. bloc ci-dessus) est
    // écrit EXPLICITEMENT sur la colonne `vinyls.artist_image` — jamais via
    // le COALESCE du UPDATE principal (null = « conserver l'ancienne photo »)
    // et SANS que les purges ci-dessous (drapeau de suppression, contamination
    // legacy conservée par le COALESCE) ne puissent le ramener à NULL ni le
    // replacer par l'ancienne image : le REPLI sur l'état d'avant est interdit,
    // seul le choix de l'utilisateur compte. Le rattachement à l'entité
    // ARTISTE et la propagation aux disques du même nom ont déjà eu lieu dans
    // la branche ci-dessus (syncArtistEntity).
    let finalRow = updated.rows[0];
    if (manualArtistUploadPath) {
      try {
        const forced = await query(
          'UPDATE vinyls SET artist_image = $1 WHERE id = $2 RETURNING *',
          [manualArtistUploadPath, id]
        );
        finalRow = forced.rows[0] || finalRow;
      } catch (err) {
        // Non bloquant : la valeur (ou l'absence de valeur) du UPDATE
        // principal reste exposée dans le DTO.
        console.warn(
          "[artistImage] Écriture explicite de l'image uploadée impossible :",
          err.message
        );
      }
    } else if (wantRemoveArtistImage || isArtistCoverContamination(finalRow)) {
      try {
        await query('UPDATE vinyls SET artist_image = NULL WHERE id = $1', [id]);
        const resetRes = await query('SELECT * FROM vinyls WHERE id = $1', [id]);
        finalRow = resetRes.rows[0] || { ...finalRow, artist_image: null };
      } catch {}
    }

    // --------------------------------------------------------------
    // GENRE DE RÉFÉRENCE DE L'ARTISTE (table `artists`) : seul le CAS A —
    // PREMIER DISQUE de l'artiste — écrit le genre sur l'ENTITÉ Artiste : il
    // devient la référence immuable des futurs albums. CAS B : l'entité est
    // JAMAIS retouchée (le genre du tout premier disque reste la référence —
    // jamais mis à jour, modifié ou écrasé). SANS retoucher les disques déjà
    // enregistrés (ni celui-ci, ni aucun autre). Non bloquant : toute panne ne
    // doit jamais empêcher la modification du disque — le genre reste écrit sur
    // la ligne courante par l'UPDATE principal ci-dessus.
    // --------------------------------------------------------------
    if (!existingGenre && values.genre) {
      try {
        await syncArtistGenre(values.artist, values.genre);
      } catch (err) {
        console.warn(
          `[genre] Propagation du genre « ${values.genre} » à l'artiste « ${values.artist} » impossible :`,
          err.message
        );
      }
    }

    return res.json({ vinyl: toVinylDto(finalRow) });
  } catch (err) {
    if (err instanceof MusicBrainzError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Un disque avec ce code-barres existe déjà.' });
    }
    // Symétrique de createVinyl : message « réparation » clair au lieu du
    // 500 brut « column "acquired_date" does not exist », et diagnostic en
    // console (appliquer migration 007 / vérifier les logs de démarrage).
    if (err.code === '42703') {
      console.error('[vinylController] Colonne absente de la base :', err.message,
        '-> appliquer database/migrations/007_ensure_vinyl_acquired_date.sql');
      return res.status(500).json({
        error: 'Base de données incomplète (colonne absente) : appliquez la migration 007 puis relancez l’API.',
      });
    }
    // Symétrique de createVinyl : toute panne APRÈS le dépôt des fichiers par
    // multer mais AVANT l'écriture en base ne doit laisser AUCUN orphelin sur
    // le volume (jaquette / photo d'artiste, y compris téléchargée depuis une
    // URL distante).
    uploadedFilesOf(req).forEach((f) => {
      if (f && f.path) { try { fs.rmSync(f.path, { force: true }); } catch {} }
    });
    return next(err);
  }
}

/**
 * GET /api/vinyls/:id — détail d'un disque (propriétaire uniquement).
 */
async function getVinyl(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT * FROM vinyls WHERE id = $1', [id]);
    const vinyl = rows[0];
    if (!vinyl) return res.status(404).json({ error: 'Disque introuvable.' });
    if (!canEditItem(req.user, vinyl.user_id)) {
      return res.status(403).json({ error: 'Seul le propriétaire ou un administrateur peut consulter ce disque.' });
    }
    return res.json({ vinyl: toVinylDto(vinyl) });
  } catch (err) {
    return next(err);
  }
}

/**
 * DELETE /api/vinyls/:id — suppression + nettoyage du fichier de jaquette locale.
 */
async function deleteVinyl(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT * FROM vinyls WHERE id = $1', [id]);
    const vinyl = rows[0];
    if (!vinyl) return res.status(404).json({ error: 'Disque introuvable.' });
    if (!canEditItem(req.user, vinyl.user_id)) {
      return res.status(403).json({ error: 'Seul le propriétaire ou un administrateur peut supprimer ce disque.' });
    }
    await query('DELETE FROM vinyls WHERE id = $1', [id]);
    deleteLocalCoverFile(vinyl.cover_url);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listMyVinyls,
  listVinylsByUser,
  listPublicVinyls,
  getVinyl,
  createVinyl,
  updateVinyl,
  deleteVinyl,
  toVinylDto,
};
