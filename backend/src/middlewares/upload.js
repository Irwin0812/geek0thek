const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const env = require('../config/env');

// Formats d'images acceptés pour les jaquettes
const ALLOWED_MIME = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

// Garantit l'existence des dossiers de uploads (volume local de la VM hôte)
// - <upload>/vinyls/   : jaquettes de disques
// - <upload>/comics/   : couvertures de BD
// - <upload>/artists/  : photos / logos d'artistes (entité Artiste)
// - <upload>/series/   : images / logos de séries (entité Série — tomes BD)
// - <upload>/avatars/  : images de profil des utilisateurs
fs.mkdirSync(env.uploadDir, { recursive: true });
fs.mkdirSync(path.join(env.uploadDir, 'vinyls'), { recursive: true });
fs.mkdirSync(env.comicUploadDir, { recursive: true });
fs.mkdirSync(env.artistUploadDir, { recursive: true });
fs.mkdirSync(env.seriesUploadDir, { recursive: true });
const avatarUploadDir = path.join(env.uploadDir, 'avatars');
fs.mkdirSync(avatarUploadDir, { recursive: true });

const storage = multer.diskStorage({
  // Redirection automatique vers le sous-dossier correspondant à la route /
  // au CHAMP du formulaire multipart :
  //   /api/comics/*        -> comics/    (couvertures de BD)
  //   /api/users/**        -> avatars/   (images de profil)
  //   champ "artistImage"  -> artists/   (photo / logo de l'entité Artiste —
  //                                       formulaire « Ajouter / Modifier un
  //                                       disque », cf. routes/vinylRoutes.js :
  //                                       le NOM DU CHAMP pilote la destination,
  //                                       car jaquette et image d'artiste partagent
  //                                       la même route /api/vinyls)
  //   /api/vinyls/* (autre)-> vinyls/    (jaquettes)
  destination: (req, file, cb) => {
    if (file && file.fieldname === 'artistImage') {
      return cb(null, env.artistUploadDir);
    }
    // champ "seriesImage" (formulaire « Ajouter / Modifier une BD », cf.
    // routes/comicRoutes.js) : image / logo de l'ENTITÉ SÉRIE (la couverture
    // d'album et l'image de série partagent la même route /api/comics — le
    // NOM DU CHAMP pilote la destination).
    if (file && file.fieldname === 'seriesImage') {
      return cb(null, env.seriesUploadDir);
    }
    const baseUrl = req.baseUrl || req.originalUrl || '';
    // Routes utilisateurs (montées sur /api/users) : avatar du profil
    if (/\/users(\/|$)/.test(baseUrl)) {
      return cb(null, avatarUploadDir);
    }
    const isComics = /\/comics(\/|$)/.test(baseUrl);
    return cb(null, isComics ? env.comicUploadDir : path.join(env.uploadDir, 'vinyls'));
  },
  filename: (req, file, cb) => {
    const ext = ALLOWED_MIME[file.mimetype] || path.extname(file.originalname.toLowerCase()) || '.jpg';
    // Nom aléatoire : évite les collisions et empêche la prédiction des chemins
    const baseUrl = req.baseUrl || req.originalUrl || '';
    // Les routes utilisateurs sont montées sur /api/users ; le champ "avatar"
    // est porté par le body multipart, pas par l'URL.
    const isAvatar = /\/users(\/|$)/.test(baseUrl);
    // Préfixe par dossier : avatar- (avatars), artist- (artists),
    // series- (images / logos de l'entité Série) ou cover- (jaquettes
    // vinyls / couvertures comics).
    const prefix =
      file && file.fieldname === 'artistImage'
        ? 'artist'
        : file && file.fieldname === 'seriesImage'
          ? 'series'
          : isAvatar
            ? 'avatar'
            : 'cover';
    cb(null, `${prefix}-${crypto.randomBytes(12).toString('hex')}${ext}`);
  },
});

// Échecs d'upload reconnaissables par le gestionnaire d'erreurs global
// (message clair sur le type de fichier, distinct du fichier trop volumineux)
class UploadTypeError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.code = 'UPLOAD_TYPE_ERROR';
    this.status = status;
  }
}

function fileFilter(req, file, cb) {
  if (ALLOWED_MIME[file.mimetype]) {
    return cb(null, true);
  }
  return cb(
    new UploadTypeError(
      `Type de fichier non autorisé (${file.mimetype || 'inconnu'}). Formats acceptés : JPG, PNG, WEBP, GIF.`
    )
  );
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.maxUploadMb * 1024 * 1024,
    files: 5,
  },
});

// Téléversement dédié aux avatars (champ "avatar", 1 fichier)
const uploadAvatar = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.maxUploadMb * 1024 * 1024,
    files: 1,
  },
});

module.exports = { upload, uploadAvatar, ALLOWED_MIME };
