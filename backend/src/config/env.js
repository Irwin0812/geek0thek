/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
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

  // IP / port de la VM cible (accès direct ou reverse proxy externe).
  appHostIp: process.env.APP_HOST_IP || '172.16.2.75',
  appPort: toInt(process.env.APP_PORT, 80),

  // Origine(s) autorisée(s) pour le CORS : liste explicite via CORS_ORIGIN
  // (séparée par des virgules — domaines / ports de staging ou reverse proxy)
  // + origines dérivées dynamiquement de APP_HOST_IP / APP_PORT (http/https,
  // avec et sans port) pour couvrir tous les accès légitimes à la webapp.
  corsOrigins: (() => {
    const origins = new Set();
    for (const origin of (process.env.CORS_ORIGIN || 'http://172.16.2.75').split(',')) {
      const trimmed = origin.trim();
      if (trimmed) origins.add(trimmed);
    }
    const host = process.env.APP_HOST_IP || '172.16.2.75';
    for (const protocol of ['http', 'https']) {
      origins.add(`${protocol}://${host}`);
      if (process.env.APP_PORT) origins.add(`${protocol}://${host}:${toInt(process.env.APP_PORT, 80)}`);
    }
    return [...origins];
  })(),

  // URL publique de l'application (liens cliquables des e-mails de
  // notification). Défaut : origine du CORS (reverse proxy / VM cible).
  appUrl: process.env.APP_URL || 'http://172.16.2.75',

  // ------------------------------------------------------------
  // SMTP — service d'envoi d'e-mails (Nodemailer, cf. utils/emailService.js).
  // Chaque utilisateur configure SON serveur SMTP via le .env local :
  //   SMTP_HOST  : hôte du serveur SMTP (ex. mail.igerarts.be)
  //   SMTP_PORT  : port (465 = TLS implicite, 587 = STARTTLS) — défaut 465
  //   SMTP_USER  : identifiant de connexion SMTP
  //   SMTP_PASS  : mot de passe / app password SMTP
  //   SMTP_FROM  : expéditeur « Nom <adresse> » (optionnel, repli SMTP_USER)
  // Si SMTP_HOST / SMTP_USER / SMTP_PASS sont absents, l'envoi d'e-mails est
  // DÉSACTIVÉ proprement (avertissement en console, jamais de crash).
  // ------------------------------------------------------------
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: toInt(process.env.SMTP_PORT, 465),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
    // Force explicite du mode TLS (true = 465 implicite, false = STARTTLS).
    // null = déduit automatiquement à partir du port (défaut).
    secure: process.env.SMTP_SECURE === undefined
      ? null
      : process.env.SMTP_SECURE === 'true',
  },

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

  // GitHub — indicateur de mise à jour (dépôt vs version déployée).
  // GITHUB_REPO : dépôt de référence (défaut Irwin0812/geek0thek).
  // GITHUB_TOKEN : jeton personnel OPTIONNEL — sans lui, l'API publique est
  // utilisée (60 req/h par IP, largement suffisant pour une vérification
  // ponctuelle au chargement de l'app). LOCAL_REPO_DIR : répertoire du dépôt
  // git déployé (monté en lecture seule dans le conteneur backend).
  github: {
    repo: process.env.GITHUB_REPO || 'Irwin0812/geek0thek',
    token: process.env.GITHUB_TOKEN || '',
    localRepoDir: process.env.LOCAL_REPO_DIR
      ? path.resolve(process.env.LOCAL_REPO_DIR)
      : path.join(__dirname, '..', '..', '..'),
  },
};

module.exports = env;
