const path = require('path');
// Chargement du .env : par défaut il est recherché dans le cwd (backend/ en
// développement local), mais il vit à la RACINE du dépôt (geek0thek/.env) :
// on retente depuis deux chemins connus sans jamais ÉCRASER une variable déjà
// définie (dotenv ne remplace pas l'existant — l'environnement Docker/CI garde
// donc toujours le priorité sur un .env local).
require('dotenv').config();
for (const dir of [path.join(__dirname, '..', '..', '..'), process.cwd()]) {
  try {
    require('dotenv').config({ path: path.join(dir, '.env') });
  } catch (_) {
    /* fichier absent : rien à faire (le fallback sans clé prend le relais) */
  }
}

const toInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: toInt(process.env.PORT, 8080),

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: toInt(process.env.DB_PORT, 5432),
    user: process.env.DB_USER || 'vinyl',
    password: process.env.DB_PASSWORD || 'vinyl',
    database: process.env.DB_NAME || 'geek0thek',
  },

  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-a-changer-en-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  // Origine(s) autorisée(s) pour le CORS (reverse proxy / VM cible)
  corsOrigins: (process.env.CORS_ORIGIN || 'http://172.16.2.75')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  // Stockage local des jaquettes (volume Docker ./uploads -> /app/uploads)
  uploadDir: process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : path.join(__dirname, '..', '..', 'uploads'),
  // Sous-dossier des couvertures de BD
  comicUploadDir: path.join(
    process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, '..', '..', 'uploads'),
    'comics'
  ),
  // Sous-dossier des photos / logos d'ARTISTES (entité Artiste — grille « Mes Disques »)
  artistUploadDir: path.join(
    process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, '..', '..', 'uploads'),
    'artists'
  ),
  // Sous-dossier des images / logos de SÉRIES (entité Série — tomes BD regroupés
  // par série, image auto Open Library / Google Books ou upload manuel « seriesImage »)
  seriesUploadDir: path.join(
    process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(__dirname, '..', '..', 'uploads'),
    'series'
  ),
  maxUploadMb: toInt(process.env.MAX_UPLOAD_MB, 10),

  // Google Books / Open Library — import de BD par ISBN
  books: {
    userAgent: 'Geek0thek-ComicsApp/1.0 (médiathèque BD, usage personnel)',
  },

  // API Last.fm — PRIORITÉ 1 pour la photo / logo d'artiste des disques.
  // La clé publique suffit (artist.search / artist.getInfo en GET).
  // LASTFM_SHARED_SECRET documente le compte développeur (métadonnées).
  lastfm: {
    apiUrl: process.env.LASTFM_API_URL || 'https://ws.audioscrobbler.com/2.0/',
    apiKey: process.env.LASTFM_API_KEY || '',
    sharedSecret: process.env.LASTFM_SHARED_SECRET || '',
    userAgent: process.env.LASTFM_USER_AGENT || 'Geek0thek/1.0.0 (contact@example.com)',
  },

  // API MusicBrainz (+ Cover Art Archive) — import par code-barres.
  // Aucune clé requise : seul un User-Agent identifiable est attendu.
  musicbrainz: {
    apiUrl: process.env.MUSICBRAINZ_API_URL || 'https://musicbrainz.org',
    coverArtUrl: process.env.COVERART_API_URL || 'https://coverartarchive.org',
    userAgent: process.env.MUSICBRAINZ_USER_AGENT || 'Geek0thek/1.0.0 (contact@example.com)',
  },

  // API Discogs — recherche par code-barres en complément de MusicBrainz.
  // Exige un jeton personnel (https://www.discogs.com/settings/developers)
  // + un User-Agent identifiable. Quota par défaut : 25 requêtes/min.
  discogs: {
    apiUrl: process.env.DISCOGS_API_URL || 'https://api.discogs.com',
    token: process.env.DISCOGS_TOKEN || '',
    userAgent: process.env.DISCOGS_USER_AGENT || 'Geek0thek/1.0.0 (contact@example.com)',
    rateLimitPerMinute: toInt(process.env.DISCOGS_RATE_LIMIT_PER_MINUTE, 25),
  },
};

module.exports = env;
