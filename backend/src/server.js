/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const { pool, migrate } = require('./config/db');
const { getUpdateStatus } = require('./utils/githubClient');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const vinylRoutes = require('./routes/vinylRoutes');
const musicBrainzRoutes = require('./routes/musicBrainzRoutes');
const discogsRoutes = require('./routes/discogsRoutes');
const comicRoutes = require('./routes/comicRoutes');
const isbnRoutes = require('./routes/isbnRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

// Reverse proxy externe : prendre en charge X-Forwarded-For / X-Forwarded-Proto
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin(origin, callback) {
      // Autorise les requêtes internes (reverse proxy nginx -> backend, pas d'Origin)
      if (!origin || env.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origine non autorisée par CORS.'));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

if (env.nodeEnv !== 'production') {
  app.use(morgan('dev'));
}

// ------------------------------------------------------------
// Serveur statique des jaquettes (volume ./uploads -> /app/uploads)
// Sécurité : aucun index de répertoire, cache immuable en production
// ------------------------------------------------------------
fs.mkdirSync(env.uploadDir, { recursive: true });
app.use(
  '/uploads',
  express.static(env.uploadDir, {
    index: false,
    maxAge: env.nodeEnv === 'production' ? '7d' : 0,
    immutable: env.nodeEnv === 'production',
  })
);

// Sonde de santé (utilisée par le healthcheck Docker)
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    // Diagnostic du schéma : l'afficher ICI (et non seulement au moment de
    // l'échec) localise la cause en une ligne. Schéma complet attendu par
    // les modèles backend (migration 007) :
    // « date d'ajout » des disques, ENTITÉS artistes + images d'artistes,
    // ENTITÉS séries + images de séries. Toute colonnes/table absente =
    // la POST/PUT du module correspondant échoue en 42703 (« Base de données
    // incomplète (colonne absente) »). Chaque absence est comptée pour que
    // le diagnostic précise LA colonne manquante.
    let schemaOk = true;
    const missingColumns = [];
    try {
      const EXPECTED_COLUMNS = [
        ['vinyls', 'acquired_date'],
        ['vinyls', 'artist_id'],
        ['vinyls', 'artist_image'],
        ['comics', 'series_id'],
        ['comics', 'series_image'],
      ];
      for (const [table, column] of EXPECTED_COLUMNS) {
        const { rows } = await pool.query(
          `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
          [table, column]
        );
        if (rows.length === 0) {
          schemaOk = false;
          missingColumns.push(`${table}.${column}`);
        }
      }
      // Entités artiste / série (tables créées par la migration 007 / 008 / 009).
      for (const table of ['artists', 'series']) {
        const { rows } = await pool.query(
          `SELECT 1 FROM information_schema.tables WHERE table_name = $1`,
          [table]
        );
        if (rows.length === 0) {
          schemaOk = false;
          missingColumns.push(`${table} (table)`);
        }
      }
    } catch { /* non bloquant : status base reste « ok » si SELECT 1 passe */ }
    return res.json({
      status: 'ok',
      database: 'ok',
      schema_ok: schemaOk,
      // Colonnes / entités du schéma 007 encore absentes (vide si complet) :
      // appliquer database/migrations/007_ensure_vinyl_acquired_date.sql.
      missing_schema: missingColumns,
      uptime: Math.round(process.uptime()),
    });
  } catch (err) {
    console.error('[health] base indisponible :', err.message);
    return res.status(503).json({ status: 'degraded', database: 'error' });
  }
});

// ------------------------------------------------------------
// Indicateur de mise à jour : compare le commit du code DÉPLOYÉ (dépôt git
// monté en lecture seule dans le conteneur, cf. docker-compose.yml) au dernier
// commit de la branche par défaut du dépôt GitHub (Irwin0812/geek0thek).
// Le frontend n'affiche son bouton « Mise à jour disponible » QUE si
// updateAvailable est TRUE — il disparaît donc automatiquement après un
// `git pull && docker compose up -d --build` (les deux SHA redeviennent
// identiques). Jamais d'erreur renvoyée : en cas de doute (API GitHub
// injoignable, quota atteint, dépôt local absent), updateAvailable = false.
// ------------------------------------------------------------
app.get('/api/version', async (req, res) => {
  try {
    const status = await getUpdateStatus();
    return res.json(status);
  } catch (err) {
    console.error('[version] vérification GitHub impossible :', err.message);
    return res.json({ status: 'unknown', updateAvailable: false, deployed: null, github: null });
  }
});

// ------------------------------------------------------------
// Routes API
// ------------------------------------------------------------
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/vinyls', vinylRoutes);
app.use('/api/musicbrainz', musicBrainzRoutes);
app.use('/api/discogs', discogsRoutes);
app.use('/api/comics', comicRoutes);
app.use('/api/isbn', isbnRoutes);
// Agrégat du tableau de bord : « Dernier ajout » GLOBAL (tous médias
// confondus) + compteurs par bibliothèque (route bornée à la collection de
// l'utilisateur connecté — cf. routes/dashboardRoutes.js).
app.use('/api/dashboard', dashboardRoutes);

// 404 — API inconnue
app.use((req, res) => {
  res.status(404).json({ error: `Route introuvable : ${req.method} ${req.path}` });
});

// Gestion centralisée des erreurs
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `Fichier trop volumineux (max ${env.maxUploadMb} Mo).` });
  }
  // Type de fichier non autorisé (fileFilter multer) : message d'utilisateur clair
  if (err.code === 'UPLOAD_TYPE_ERROR') {
    return res.status(400).json({ error: err.message });
  }
  console.error('[erreur]', err);
  return res.status(err.status || 500).json({ error: err.message || 'Erreur serveur interne.' });
});

/**
 * Applique les migrations idempotentes une fois la base disponible, avec
 * relances continues (toutes les 5 s) tant que la connexion échoue.
 * N'abandonne JAMAIS : un redémarrage de conteneur PostgreSQL coïncidant
 * avec le boot de l'API ne doit plus faire passer la fenêtre de ~2,5 min
 * pendant laquelle les migrations idempotentes (dont « vinyls.added-date »)
 * restaient non appliquées — c'est ce qui laissait apparaître
 * « column "acquired_date" does not exist » alors que health renvoyait
 * database: "ok". Les relances suivantes de migrate() sont sans danger :
 * chaque migration réussie est tracée dans schema_migrations et ignorée
 * aux boots suivants (cf. config/db.js).
 */
async function ensureDbReady() {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      await pool.query('SELECT 1');
      await migrate();
      console.log(`[geek0thek] Connexion PostgreSQL établie, migrations idempotentes appliquées (tentative n°${attempt}).`);
      return;
    } catch (err) {
      console.warn(`[geek0thek] Base non encore disponible, on relance dans 5 s (tentative n°${attempt}) :`, err.message);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

app.listen(env.port, '0.0.0.0', () => {
  console.log(`[geek0thek] API démarrée sur le port ${env.port} (${env.nodeEnv})`);
  ensureDbReady().catch((err) => console.error('[geek0thek] Échec de l’initialisation de la base :', err.message));
});

module.exports = { app, ensureDbReady };
