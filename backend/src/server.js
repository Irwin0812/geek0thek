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
// Rappel de sécurité semestriel (comptes SANS 2FA) : tâche planifiée qui envoie
// un e-mail d'information tous les 6 mois aux utilisateurs n'ayant pas activé
// la 2FA. Démarrée une fois la base disponible (cf. ensureDbReady).
const { startPasswordReminderScheduler } = require('./utils/passwordReminderService');

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
    // Méthodes + en-têtes explicitement autorisés (préflight OPTIONS inclus)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Forwarded-For',
      'X-Forwarded-Proto',
      'X-Forwarded-Host',
      'X-Forwarded-Port',
    ],
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

// ------------------------------------------------------------
// PROXY D'IMAGE (MÊME ORIGINE) — GET /api/image-proxy?url=<URL distante>
//
// Récupère côté SERVEUR une image distante (jaquette Discogs / Open Library /
// Last.fm / Google Books…) et la renvoie depuis CETTE origine. Le front-end
// pointe ses <img src> vers ce proxy au lieu de l'URL tierce directe, ce qui
// supprime à la fois :
//   • le MIXED CONTENT : une image http:// affichée sur un site https:// est
//     bloquée par le navigateur ; servie via le proxy (même origine, https),
//     elle passe ;
//   • les blocages CORS / HOTLINKING des CDN tiers qui refusent d'être chargés
//     directement dans un <img> depuis une autre origine.
//
// Sécurité :
//   • seuls http/https sont acceptés (pas de file://, gopher://…) ;
//   • GUARD SSRF : les hôtes privés / boucle locale / link-local sont refusés
//     (y compris après chaque saut de redirection — on suit manuellement les
//     redirects en re-validant chaque cible) ;
//   • la réponse doit être un Content-Type image/* ;
//   • taille plafonnée (15 Mo) + timeout (20 s).
// ------------------------------------------------------------
const IMAGE_PROXY_MAX_BYTES = 15 * 1024 * 1024; // 15 Mo
const IMAGE_PROXY_TIMEOUT_MS = 20000;
const IMAGE_PROXY_MAX_REDIRECTS = 5;

/** Hôte à refuser (boucle locale, RFC1918, link-local, .local/.internal). */
function isBlockedImageHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return true;
  if (host === 'localhost' || host === '0.0.0.0' || host === '[::1]') return true;
  if (host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true; // 172.16.0.0/12
  if (/^169\.254\./.test(host)) return true;
  if (/^::1$/.test(host) || /^fe80:/i.test(host)) return true;
  return false;
}

app.get('/api/image-proxy', async (req, res) => {
  const target = String(req.query.url || '').trim();
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return res.status(400).json({ error: "URL d'image invalide." });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Protocole non supporté (http/https uniquement).' });
  }
  if (isBlockedImageHost(parsed.hostname)) {
    return res.status(400).json({ error: "Hôte d'image non autorisé." });
  }

  // Suivi MANUEL des redirections : chaque cible est re-validée (anti-SSRF —
  // un CDN ne doit pas pouvoir rediriger vers un hôte interne).
  let current = parsed;
  for (let hop = 0; hop < IMAGE_PROXY_MAX_REDIRECTS; hop++) {
    let upstream;
    try {
      upstream = await fetch(current.toString(), {
        headers: { 'User-Agent': 'Geek0thek/1.0.0 (image proxy)', Accept: 'image/*' },
        signal: AbortSignal.timeout(IMAGE_PROXY_TIMEOUT_MS),
        redirect: 'manual',
      });
    } catch (err) {
      return res.status(502).json({ error: `Image distante injoignable (${err.message}).` });
    }

    // Redirection ? On valide la cible puis on reboucle.
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get('location');
      try { await upstream.body?.cancel(); } catch {}
      if (!location) {
        return res.status(502).json({ error: 'Redirection distante sans cible.' });
      }
      let next;
      try {
        next = new URL(location, current);
      } catch {
        return res.status(502).json({ error: 'Redirection distante invalide.' });
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return res.status(400).json({ error: 'Protocole de redirection non supporté.' });
      }
      if (isBlockedImageHost(next.hostname)) {
        return res.status(400).json({ error: "Hôte de redirection non autorisé." });
      }
      current = next;
      continue;
    }

    // Réponse finale.
    if (!upstream.ok) {
      try { await upstream.body?.cancel(); } catch {}
      const status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502;
      return res.status(status).json({ error: `Image distante indisponible (HTTP ${upstream.status}).` });
    }

    const contentType = (upstream.headers.get('content-type') || 'image/jpeg')
      .split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      try { await upstream.body?.cancel(); } catch {}
      return res.status(502).json({ error: "La réponse distante n'est pas une image." });
    }

    const contentLength = Number(upstream.headers.get('content-length') || 0);
    if (contentLength > IMAGE_PROXY_MAX_BYTES) {
      try { await upstream.body?.cancel(); } catch {}
      return res.status(413).json({ error: 'Image distante trop volumineuse.' });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');

    let received = 0;
    try {
      const reader = upstream.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > IMAGE_PROXY_MAX_BYTES) {
          res.destroy();
          return;
        }
        if (!res.write(Buffer.from(value))) {
          // Backpressure : on attend le drain avant d'écrire la suite.
          await new Promise((r) => res.once('drain', r));
        }
      }
    } catch (err) {
      try { await upstream.body?.cancel(); } catch {}
      if (!res.headersSent) return res.status(502).json({ error: 'Échec du transfert de l’image.' });
      return;
    }
    return res.end();
  }

  // Trop de redirections.
  return res.status(502).json({ error: 'Trop de redirections sur l\'image distante.' });
});

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
      // Démarrage du rappel de sécurité semestriel (comptes SANS 2FA) : une
      // fois la base disponible et migrée. Idempotent — un seul timer.
      startPasswordReminderScheduler();
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
