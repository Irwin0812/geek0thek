/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
  host: env.db.host,
  port: env.db.port,
  user: env.db.user,
  password: env.db.password,
  database: env.db.database,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[db] Erreur inattendue du pool PostgreSQL :', err.message);
});

/**
 * Exécute une requête paramétrée.
 * @param {string} text SQL avec placeholders $1, $2...
 * @param {Array}  params valeurs bindées
 */
async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  if (env.nodeEnv === 'development') {
    console.log('[db] requête exécutée :', text.replace(/\s+/g, ' ').trim(), `${Date.now() - start}ms`);
  }
  return result;
}

// ------------------------------------------------------------
// Migrations idempotentes
//   init.sql ne s'exécute QUE la 1re création du volume de
//   données PostgreSQL. Les schémas créés avant un ajout de
//   colonne doivent donc rattraper le retard ici, au démarrage
//   de l'API. Chaque instruction est idempotente (IF NOT
//   EXISTS / OR REPLACE) : elle peut s'exécuter à chaque boot.
// ------------------------------------------------------------
const MIGRATIONS_APPLIED = 'schema_migrations';

const MIGRATIONS = [
  // Suivi des migrations appliquées : évite de ré-exécuter les instructions
  // idempotentes à CHAQUE démarrage (notamment l'UPDATE full-table de
  // backfill « vinyls.added-date », coûteux sur une collection volumineuse).
  {
    name: 'meta.schema-migrations',
    statements: [
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());',
      // Idempotent à chaque boot.
      `INSERT INTO ${MIGRATIONS_APPLIED} (name) VALUES ('${MIGRATIONS_APPLIED}') ON CONFLICT (name) DO NOTHING;`,
    ],
  },
  // Tâche 2/3 — MBID MusicBrainz des disques (identifiant UUID de la release)
  {
    name: 'vinyls.mbid',
    statements: [
      'ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS mbid VARCHAR(40);',
      'CREATE INDEX IF NOT EXISTS idx_vinyls_mbid ON vinyls(mbid) WHERE mbid IS NOT NULL;',
    ],
  },
  // Profil enrichi : activation du compte + champs optionnels
  // (avatar, sexe, date de naissance, adresse, pays)
  {
    name: 'users.profile-enriched',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS gender VARCHAR(1);`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS address VARCHAR(255);`,
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(120);`,
      // (Re)définit la contrainte de sexe avec OR REPLACE : indolore si absente
      `ALTER TABLE users DROP CONSTRAINT IF EXISTS users_gender_check;`,
      `ALTER TABLE users ADD CONSTRAINT users_gender_check CHECK (gender IN ('H', 'F', 'O'));`,
    ],
  },
  // Recherche Discogs par code-barres : identifiants Discogs de la release
  // (id numérique + URL de la fiche), en complément de l'MBID MusicBrainz.
  {
    name: 'vinyls.discogs',
    statements: [
      'ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS discogs_release_id BIGINT;',
      'ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS discogs_url TEXT;',
      'CREATE INDEX IF NOT EXISTS idx_vinyls_discogs_release ON vinyls(discogs_release_id) WHERE discogs_release_id IS NOT NULL;',
    ],
  },
  // Fiche LAST.FM d'un disque : URL de la fiche album (provenance de la
  // jaquette et des métadonnées, car Last.fm est PRIORITÉ 1 de la cascade) +
  // lien « Fiche Last.fm ↗ » du formulaire. Mêmes colonnes TEXT que
  // discogs_url : identifiants de PROVENANCE persistés avec le disque.
  {
    name: 'vinyls.lastfm',
    statements: [
      'ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS lastfm_url TEXT;',
    ],
  },
  // Sélecteur granulaire de visibilité : partage des disques et des BD
  // indépendamment du drapeau global is_public. Défaut NOT NULL TRUE : les
  // collections déjà publiques restent intégralement visibles.
  {
    name: 'users.share-visibility',
    statements: [
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS share_vinyls BOOLEAN NOT NULL DEFAULT TRUE;',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS share_comics BOOLEAN NOT NULL DEFAULT TRUE;',
    ],
  },
  // Langue préférée de l'utilisateur (code ISO 639-1, ex. « fr », « en ») :
  // NOT NULL DEFAULT 'fr', comme les autres préférences du profil.
  {
    name: 'users.language',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(5) NOT NULL DEFAULT 'fr';`,
    ],
  },
  // Thème visuel préféré (dark / library / vinyl / comic / comic-books / neon ;
  // « cartoon » mappé vers « comic-books », « pastel » vers « neon »,
  // cf. migrations dédiées) : NOT NULL DEFAULT 'dark' (défaut de l'appli).
  {
    name: 'users.theme',
    statements: [
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(50) NOT NULL DEFAULT 'dark';`,
    ],
  },
  // Réparation des chemins de jaquettes stockés SANS le préfixe "/uploads/"
  // par d'anciennes versions de resolveCover/resolveComicCover (ex.
  // "/vinyls/cover-x.jpg" au lieu de "/uploads/vinyls/cover-x.jpg") : ces
  // chemins ne correspondaient à aucune route statique, d'où la jaquette
  // "disparue" après enregistrement. Idempotent : une fois réparé, la ligne
  // ne correspond plus aux conditions.
  {
    name: 'covers.uploads-prefix',
    statements: [
      `UPDATE vinyls SET cover_url = '/uploads' || cover_url WHERE cover_url LIKE '/vinyls/%';`,
      `UPDATE comics SET cover_url = '/uploads' || cover_url WHERE cover_url LIKE '/comics/%';`,
      // Variantes préfixées par une origine complète (http://…/uploads/…) :
      // on ne conserve que le chemin local servi par express.static.
      `UPDATE vinyls SET cover_url = substring(cover_url FROM '/uploads/.+')` +
      ` WHERE cover_url ~* '^https?://.+/uploads/';`,
      `UPDATE comics SET cover_url = substring(cover_url FROM '/uploads/.+')` +
      ` WHERE cover_url ~* '^https?://.+/uploads/';`,
    ],
  },
  // BDs : « Livre dédicacé » (booléen) + « Date d'ajout » (remplace le champ
  // « État » du formulaire) + index lower(series) pour l'auto-copie
  // intelligente du synopsis par série (voir migration SQL 003).
  {
    name: 'comics.signed-and-added-date',
    statements: [
      'ALTER TABLE comics ADD COLUMN IF NOT EXISTS is_signed BOOLEAN NOT NULL DEFAULT FALSE;',
      'ALTER TABLE comics ADD COLUMN IF NOT EXISTS added_date DATE NOT NULL DEFAULT CURRENT_DATE;',
      'CREATE INDEX IF NOT EXISTS idx_comics_series ON comics(lower(series)) WHERE series IS NOT NULL;',
    ],
  },
  // Disques : « Date d'ajout » (DATE métier, alignée sur comics.added_date)
  // remplace l'ancien « Année d'acquisition » (année entière). Idempotent :
  // au 1er boot la colonne est créée puis rétro-remplie (d'abord depuis
  // year_acquired — année seule, jour 1/1 — sinon CURRENT_DATE), ensuite
  // rendue NOT NULL avec défaut CURRENT_DATE ; l'ancienne colonne
  // year_acquired est retirée à la fin. N'est pas re-exécutée aux boots
  // suivants (table de suivi schema_migrations).
  // ATTENTION — vue public_vinyls : init.sql la crée en « SELECT v.* » et une
  // telle vue porte une dépendance PostgreSQL sur CHAQUE colonne de vinyls,
  // dont year_acquired. Le DROP COLUMN échouerait alors (« cannot drop
  // column … because other objects depend on it »), annulant TOUTE la
  // transaction y compris le ADD COLUMN ci-dessus — c'est exactement ce qui
  // laissait apparaître « column "acquired_date" does not exist ». On retire
  // donc d'abord la vue et on la recrée à l'identique après le drop.
  {
    name: 'vinyls.added-date',
    statements: [
      // 1. La vue dépend de year_acquired (SELECT v.*) : sans ce drop, l'étape
      // 5 échouerait et rollbackerait la migration entière.
      'DROP VIEW IF EXISTS public_vinyls;',
      'ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS acquired_date DATE;',
      `DO $$ BEGIN
         IF EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_name = 'vinyls' AND column_name = 'year_acquired'
         ) THEN
           UPDATE vinyls SET acquired_date = make_date(year_acquired, 1, 1)
           WHERE year_acquired IS NOT NULL
             AND year_acquired BETWEEN 1000 AND 9999
             AND acquired_date IS NULL;
         END IF;
       END $$;`,
      'UPDATE vinyls SET acquired_date = CURRENT_DATE WHERE acquired_date IS NULL;',
      'ALTER TABLE vinyls ALTER COLUMN acquired_date SET NOT NULL;',
      'ALTER TABLE vinyls ALTER COLUMN acquired_date SET DEFAULT CURRENT_DATE;',
      // 5. L'ancienne colonne « année d'acquisition » n'est plus utilisée.
      'ALTER TABLE vinyls DROP COLUMN IF EXISTS year_acquired;',
      // 6. Restaure la vue (même corps qu'init.sql) : ses dépendances sont
      // cette fois établies sur le schéma courant (acquired_date incluse,
      // year_acquired absente) — plus aucun drop de colonne vinyls ne peut
      // être bloqué par elle par la suite.
      `CREATE OR REPLACE VIEW public_vinyls AS
       SELECT v.*, u.first_name, u.last_name
       FROM vinyls v
       JOIN users u ON u.id = v.user_id
       WHERE u.is_public = TRUE AND u.share_vinyls = TRUE;`,
    ],
  },
  // Disques : « Options » (rangée horizontale du formulaire) — édition
  // spéciale, picture disc, nombre de galettes et couleur de la galette.
  // Idempotent ; les colonnes existent depuis la migration 005. La borne du
  // CHECK est resserrée à la plage du formulaire (1 → 5) par la suite de
  // migrations « vinyls.discs-count-1-to-5 » ci-dessous (migration 006).
  {
    name: 'vinyls.options',
    statements: [
      'ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS is_special_edition BOOLEAN NOT NULL DEFAULT FALSE;',
      'ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS is_picture_disc BOOLEAN NOT NULL DEFAULT FALSE;',
      'ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS discs_count INTEGER NOT NULL DEFAULT 1;',
      `ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS color VARCHAR(50) NOT NULL DEFAULT 'Noir';`,
      `DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'vinyls_discs_count_check' AND conrelid = 'public.vinyls'::regclass
        ) THEN
          ALTER TABLE vinyls ADD CONSTRAINT vinyls_discs_count_check
            CHECK (discs_count BETWEEN 1 AND 5);
        END IF;
      END $$;`,
    ],
  },

  // « Nombre de Disques » resserré à la plage du formulaire (select 1 → 5) :
  // les valeurs existantes hors plage sont d'abord resserrées aux bornes,
  // PUIS la contrainte est remplacée — l'ordre des deux instructions est
  // crucial (la remplacer AVANT le resserrage échouerait sur les lignes
  // 6 → 20). Idempotent ; même contenu que
  // database/migrations/006_vinyls_discs_count_1_to_5.sql.
  {
    name: 'vinyls.discs-count-1-to-5',
    statements: [
      'UPDATE vinyls SET discs_count = LEAST(GREATEST(discs_count, 1), 5);',
      'ALTER TABLE vinyls DROP CONSTRAINT IF EXISTS vinyls_discs_count_check;',
      'ALTER TABLE vinyls ADD CONSTRAINT vinyls_discs_count_check CHECK (discs_count BETWEEN 1 AND 5);',
    ],
  },
  // ENTITÉ ARTISTE (photo / logo) — « Ajouter un disque » déclenche la
  // création d'artiste : réutilisation de l'image déjà stockée pour le même
  // nom, sinon récupération automatique (cascade : 1. Last.fm — priorité,
   // repli 2. Discogs / MusicBrainz + Cover Art Archive) et,
  // à défaut, repli propre sur l'image locale img/no_group.jpg. Deux niveaux :
  //  1. table `artists` : une ligne par nom d'artiste distinct (clé
  //     normalisée `norm_name`, même algorithme que normalizeArtistName() de
  //     backend/src/utils/musicBrainzClient.js — minuscules, apostrophes
  //     typographiques harmonisées, espaces réduits) ;
  //  2. colonnes vinyls.artist_id / vinyls.artist_image (même pattern que
  //     cover_url) : l'image est portée PAR DISQUE, de sorte que TOUS les
  //     disques d'un même artiste affichent LA MÊME photo / logo dans la grille
  //     « Mes Disques » (tuile du groupe). La colonne TEXT tolère aussi une
  //     URL distante ou img/no_group.jpg.
  {
    name: 'artists.table',
    statements: [
      `CREATE TABLE IF NOT EXISTS artists (
         id BIGSERIAL PRIMARY KEY,
         name VARCHAR(255) NOT NULL,
         norm_name VARCHAR(255) NOT NULL,
         image_url TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         CONSTRAINT artists_norm_name_unique UNIQUE (norm_name)
       );`,
      'CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);',
      'ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS artist_id BIGINT;',
      'ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS artist_image TEXT;',
      'CREATE INDEX IF NOT EXISTS idx_vinyls_artist_id ON vinyls(artist_id) WHERE artist_id IS NOT NULL;',
      // Backfill idempotent : rattache chaque disque existant à sa ligne
      // d'artiste (créée si nécessaire, dédupliquée par nom normalisé).
      // L'image d'artiste n'est PAS rétro-remplie ici : elle est récupérée
      // automatiquement à la prochaine création / modification d'un disque de
      // cet artiste (cascade Last.fm -> Discogs / MusicBrainz + Cover Art
       // Archive), repli propre
      // img/no_group.jpg.
      `DO $$
       DECLARE
         v_artist VARCHAR(255);
         v_norm   VARCHAR(255);
       BEGIN
         FOR v_artist IN
           SELECT DISTINCT artist FROM vinyls WHERE btrim(artist) <> ''
         LOOP
           v_norm := lower(regexp_replace(
             btrim(replace(replace(v_artist, chr(8217), chr(39)), chr(8216), chr(39))),
             '\\s+', ' ', 'g'));
           INSERT INTO artists (name, norm_name) VALUES (v_artist, v_norm)
           ON CONFLICT (norm_name) DO NOTHING;

           UPDATE vinyls AS v SET artist_id = a.id
           FROM (SELECT id FROM artists WHERE norm_name = v_norm) a
           WHERE v.artist = v_artist AND v.artist_id IS NULL;
         END LOOP;
       END $$;`,
      // Recrée la vue publique : ses dépendances couvrent désormais aussi
      // artist_id / artist_image (mêmes colonnes que init.sql, SELECT v.*).
      // DROP d'abord (bases « vintage ») : la vue ancienne a une liste de
      // colonnes figée depuis sa création — sans ce drop, CREATE OR REPLACE
      // échouerait avec 42881 (« cannot change name of view column … »),
      // annulant TOUTE la transaction (tables artists jamais appliquées).
      'DROP VIEW IF EXISTS public_vinyls;',
      `CREATE OR REPLACE VIEW public_vinyls AS
       SELECT v.*, u.first_name, u.last_name
       FROM vinyls v
       JOIN users u ON u.id = v.user_id
       WHERE u.is_public = TRUE AND u.share_vinyls = TRUE;`,
    ],
  },

  // ENTITÉ SÉRIE (image / logo) — « Ajouter / modifier une BD » déclenche la
  // création de série : réutilisation de l'image déjà stockée pour le même
  // nom, sinon récupération automatique (Google Books -> Open Library) et, à
  // défaut, repli propre sur l'image locale img/no_title.jpg. Deux niveaux :
  //   1. table `series` : une ligne par nom de série distinct (clé normalisée
  //      `norm_name`, même algorithme que normalizeSeriesName() de
  //      backend/src/utils/seriesService.js — minuscules, apostrophes
  //      typographiques harmonisées, espaces réduits) ;
  //   2. colonnes comics.series_id / comics.series_image (même pattern que
  //      vinyls.artist_id / artist_image) : l'image est portée PAR BD, de
  //      sorte que TOUS les tomes d'une même série affichent LA MÊME image /
  //      logo. La colonne TEXT tolère aussi une URL distante ou
  //      img/no_title.jpg.
  {
    name: 'series.table',
    statements: [
      `CREATE TABLE IF NOT EXISTS series (
         id BIGSERIAL PRIMARY KEY,
         name VARCHAR(255) NOT NULL,
         norm_name VARCHAR(255) NOT NULL,
         image_url TEXT,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         CONSTRAINT series_norm_name_unique UNIQUE (norm_name)
       );`,
      'CREATE INDEX IF NOT EXISTS idx_series_name ON series(name);',
      'ALTER TABLE comics ADD COLUMN IF NOT EXISTS series_id BIGINT;',
      'ALTER TABLE comics ADD COLUMN IF NOT EXISTS series_image TEXT;',
      'CREATE INDEX IF NOT EXISTS idx_comics_series_id ON comics(series_id) WHERE series_id IS NOT NULL;',
      // Backfill idempotent : rattache chaque BD existante à sa ligne de
      // série (créée si nécessaire, dédupliquée par nom normalisé).
      // L'image de série n'est PAS rétro-remplie ici : elle est récupérée
      // automatiquement à la prochaine création / modification d'une BD de
      // cette série (recherche Google Books + Open Library), repli propre
      // img/no_title.jpg.
      `DO $$
       DECLARE
         v_series VARCHAR(255);
         v_norm   VARCHAR(255);
       BEGIN
         FOR v_series IN
           SELECT DISTINCT series FROM comics WHERE btrim(series) <> '' AND series IS NOT NULL
         LOOP
           v_norm := lower(regexp_replace(
             btrim(replace(replace(v_series, chr(8217), chr(39)), chr(8216), chr(39))),
             '\\s+', ' ', 'g'));
           INSERT INTO series (name, norm_name) VALUES (v_series, v_norm)
           ON CONFLICT (norm_name) DO NOTHING;

           UPDATE comics AS c SET series_id = s.id
           FROM (SELECT id FROM series WHERE norm_name = v_norm) s
           WHERE c.series = v_series AND c.series_id IS NULL;
         END LOOP;
       END $$;`,
      // Recrée la vue publique : ses dépendances couvrent désormais aussi
      // series_id / series_image (mêmes colonnes que init.sql, SELECT c.*).
      // DROP d'abord (bases « vintage ») : la vue ancienne a une liste de
      // colonnes figée depuis sa création — sans ce drop, CREATE OR REPLACE
      // échouerait avec 42881 (« cannot change name of view column … »),
      // annulant TOUTE la transaction (table series jamais appliquée).
      'DROP VIEW IF EXISTS public_comics;',
      `CREATE OR REPLACE VIEW public_comics AS
       SELECT c.*, u.first_name, u.last_name
       FROM comics c
       JOIN users u ON u.id = c.user_id
       WHERE u.is_public = TRUE AND u.share_comics = TRUE;`,
    ],
  },
   // TYPE DE DISQUE du formulaire « Ajouter / Modifier un disque » (1er
   // élément de la rangée des options) : « Vinyle » / « Compact », défaut
   // « Vinyle » — remplace l'ancienne option « Disque Vinyle ». Colonne
   // VARCHAR(20) NOT NULL avec rétro-remplissage « Vinyle » (cf. migration
   // 010, identique pour init.sql sur une base neuve).
   {
     name: 'vinyls.disc-type',
     statements: [
       `ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS disc_type VARCHAR(20) NOT NULL DEFAULT 'Vinyle';`,
       `ALTER TABLE vinyls ALTER COLUMN disc_type SET DEFAULT 'Vinyle';`,
       `UPDATE vinyls SET disc_type = 'Vinyle' WHERE btrim(COALESCE(disc_type, '')) = '';`,
     ],
   },
  // Thèmes visuels : le thème « cartoon » a été RETIRÉ (plus de fichier
  // frontend/src/themes/cartoon.css ni d'entrée dans l'enum THEMES) au profit
  // du nouveau thème « comic-books ». Rétro-remplissage idempotent des
  // préférences déjà stockées : sans lui, un profil users.theme = 'cartoon'
  // resterait invalide côté API (clé inconnue refusée par cleanTheme) et
  // reprendrait le défaut 'dark' au prochain choix.
  {
    name: 'users.theme-cartoon-to-comic-books',
    statements: [
      `UPDATE users SET theme = 'comic-books' WHERE lower(theme) = 'cartoon';`,
    ],
  },
  // Thèmes visuels : le 6e thème « pastel » (ex-« Pastel », fichier
  // frontend/src/themes/pastel.css) a été REMPLACÉ par « neon » (Néon).
  // Les préférences déjà stockées sont résolues côté API via l'alias
  // LEGACY_THEME_ALIASES ; ce rétro-remplissage idempotent évite que la clé
  // « pastel » reste définitivement dans users.theme.
  {
    name: 'users.theme-pastel-to-neon',
    statements: [
      `UPDATE users SET theme = 'neon' WHERE lower(theme) = 'pastel';`,
    ],
  },
  // GENRE DE RÉFÉRENCE de l'ENTITÉ ARTISTE — au CAS A (premier disque de
  // l'artiste), le genre du tout premier disque est conservé sur l'entité
  // Artiste comme référence IMMUEBLE des FUTURS albums de cet artiste : les
  // disques suivants reçoivent automatiquement ce genre (le genre renvoyé par
  // l'API / le formulaire est ignoré) — SANS jamais retoucher les disques déjà
  // enregistrés (chacun garde son propre genre). Colonne VARCHAR(120) (même
  // largeur que vinyls.genre), NULL si jamais défini.
  // Idempotent : ADD COLUMN IF NOT EXISTS.
  {
    name: 'artists.genre',
    statements: [
      'ALTER TABLE artists ADD COLUMN IF NOT EXISTS genre VARCHAR(120);',
    ],
  },
  // SÉCURITÉ À LA PREMIÈRE CONNEXION (onboarding) — drapeau
  // users.must_change_password : TRUE tant que le compte n'a pas encore
  // changé ses identifiants de première installation. La création de comptes
  // via l'API (POST /api/users) le pose à TRUE ; le seed de l'admin de test
  // (init.sql, login « admin » / mot de passe « admin ») le pose à FALSE. Le
  // backend force alors l'onboarding (POST /api/auth/onboarding : nouveau
  // mot de passe OBLIGATOIRE + pseudo de login personnalisable) et le remet
  // à FALSE une fois validé. Défaut NOT NULL FALSE : les comptes existants
  // ne sont JAMAIS bloqués par cette migration (seuls les comptes créés via
  // l'API après son application sont concernés ; l'admin de test seedé est à
  // FALSE).
  {
    name: 'users.must-change-password',
    statements: [
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;',
    ],
  },
  // RÉINITIALISATION DU COMPTE ADMIN DE TEST — le compte de test principal est
  // remis aux accès de test :
  //   Login  : admin
  //   Mot de passe : admin  (bcrypt coût 12)
  //   must_change_password = FALSE (connexion directe, sans onboarding forcé).
  // Identification par `role = 'admin'` : c'est le SEUL identifiant stable du
  // compte principal — son login (seed « Admin », puis « admin » / « Admirwin »)
  // ET son e-mail (seed « admin@geek0thek.local », puis modifié, ex.
  // « webmaster@igerarts.be ») peuvent avoir changé, mais le rôle admin reste.
  // RÈGLE STRICTE RESPECTÉE : seul le triplet (login, password_hash,
  // must_change_password) de la LIGNE users est modifié — l'e-mail, les données,
  // collections, historiques et réglages rattachés au compte ne sont JAMAIS
  // supprimés ni réinitialisés (tables vinyls / comics / artists / series /
  // avatars et préférences du profil intactes). Exécutée une seule fois (trace
  // schema_migrations) ; idempotente.
  {
    name: 'users.reset-test-admin-v2',
    statements: [
      `UPDATE users
       SET login = 'admin',
           password_hash = '$2a$12$h547RjPf2TsG0je18jW.gOyhZFKEuxvCqe32Z9EgRPFEqARyz.2wC',
           must_change_password = FALSE
       WHERE role = 'admin';`,
    ],
  },
  // PARTAGE DE BIBLIOTHÈQUE (accès en consultation) — table `library_shares` :
  // un utilisateur (owner_id) ouvre l'accès EN CONSULTATION à sa collection à
  // un autre utilisateur (granted_to_id). C'est le déclencheur de la
  // notification e-mail « partage de bibliothèque » (cf. utils/emailService.js
  // -> notifyLibraryShared). Colonnes :
  //   owner_id      — propriétaire de la collection qui ouvre l'accès
  //   granted_to_id — utilisateur destinataire qui reçoit l'accès en consultation
  //   scope         — « vinyls » | « comics » | « all » (toutes les collections)
  //   created_by    — id de l'utilisateur ayant créé le partage (owner ou admin)
  //   created_at    — horodatage
  // Contraintes : pas d'auto-partage (owner <> granted_to), unicité du couple
  // (owner, granted_to, scope) pour éviter les doublons.
  {
    name: 'library-shares.table',
    statements: [
      `CREATE TABLE IF NOT EXISTS library_shares (
         id BIGSERIAL PRIMARY KEY,
         owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         granted_to_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         scope VARCHAR(20) NOT NULL DEFAULT 'all',
         created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
         CONSTRAINT library_shares_no_self CHECK (owner_id <> granted_to_id),
         CONSTRAINT library_shares_scope_check CHECK (scope IN ('vinyls', 'comics', 'all')),
         CONSTRAINT library_shares_unique UNIQUE (owner_id, granted_to_id, scope)
       );`,
      'CREATE INDEX IF NOT EXISTS idx_library_shares_owner ON library_shares(owner_id);',
      'CREATE INDEX IF NOT EXISTS idx_library_shares_granted_to ON library_shares(granted_to_id);',
    ],
  },
  // AUTHENTIFICATION À DEUX FACTEURS (Google Authenticator / TOTP) — colonnes
  // users.totp_secret et users.totp_enabled. La clé secrète (Base32) n'est
  // stockée QUE lorsque l'utilisateur démarre la configuration de la 2FA ; le
  // drapeau totp_enabled n'est passé à TRUE qu'après confirmation d'un code
  // valide (POST /api/users/totp/enable). NOT NULL DEFAULT FALSE : les comptes
  // existants ne sont JAMAIS affectés. Idempotent : ADD COLUMN IF NOT EXISTS.
  {
    name: 'users.two-factor',
    statements: [
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT FALSE;',
    ],
  },
  // RÉINITIALISATION DU MOT DE PASSE — table `password_resets` : jetons à
  // usage unique générés par POST /api/auth/forgot-password. Seul le HACHAGE
  // SHA-256 du jeton est stocké (le jeton brut n'est jamais persisté, il est
  // transmis une seule fois, dans l'e-mail). expires_at : expiration (1 h) ;
  // used_at : horodatage de la consommation du lien (jeton à usage unique).
  {
    name: 'password-resets.table',
    statements: [
      `CREATE TABLE IF NOT EXISTS password_resets (
         id BIGSERIAL PRIMARY KEY,
         user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
         token_hash VARCHAR(64) NOT NULL UNIQUE,
         expires_at TIMESTAMPTZ NOT NULL,
         used_at TIMESTAMPTZ,
         created_at TIMESTAMPTZ NOT NULL DEFAULT now()
       );`,
      'CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);',
    ],
  },
  // RAPPEL DE SÉCURITÉ SEMESTRIEL (comptes SANS 2FA) — deux colonnes de suivi
  // sur users, utilisées par utils/passwordReminderService.js :
  //   password_changed_at       — date de DERNIÈRE MODIFICATION du mot de passe
  //                               (ou de la 1re connexion / onboarding). Un
  //                               compte dont le mot de passe a plus de 6 mois
  //                               est éligible au rappel. NULL = jamais
  //                               renseignée (comptes créés avant cette
  //                               migration) : le service retombe alors sur
  //                               created_at (date de création / 1re connexion).
  //   last_password_reminder_at — date du DERNIER e-mail de rappel envoyé.
  //                               Garantit qu'aucun utilisateur ne reçoit plus
  //                               d'un rappel par période de 6 mois, même si la
  //                               vérification tourne quotidiennement.
  // Les deux colonnes sont NULLABLES (pas de NOT NULL) : aucune donnée
  // existante n'est affectée et le service gère proprement les NULL.
  // Idempotent : ADD COLUMN IF NOT EXISTS.
  {
    name: 'users.password-reminder-dates',
    statements: [
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;',
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS last_password_reminder_at TIMESTAMPTZ;',
    ],
  },
  // STATUT DE DONATEUR (soutien au projet) — colonne users.is_donor : TRUE dès
  // qu'un don PayPal (paypal.me/geek0thek) est enregistré / validé pour le
  // compte (POST /api/users/donation). Déclenche l'e-mail de MERCI personnalisé
  // (cf. utils/emailService.js -> notifyDonationThankYou). NOT NULL DEFAULT
  // FALSE : les comptes existants ne sont JAMAIS affectés. Idempotent :
  // ADD COLUMN IF NOT EXISTS.
  {
    name: 'users.is-donor',
    statements: [
      'ALTER TABLE users ADD COLUMN IF NOT EXISTS is_donor BOOLEAN NOT NULL DEFAULT FALSE;',
    ],
  },
];

/**
 * Applique les migrations idempotentes au démarrage. Chaque migration est
 * exécutée dans UNE SEULE TRANSACTION : soit toutes ses instructions passent,
 * soit aucune n'a d'effet (pas de schéma intermédiaire observable par l'API —
 * critique pour « vinyls.added-date » : ajouter la colonne, la rétro-remplir
 * et la rendre NOT NULL doivent rester atomiques).
 * Une migration déjà appliquée (trace dans `schema_migrations`) est ignorée :
 * les instructions idempotentes ne sont donc plus revues à chaque boot —
 * notamment l'UPDATE de backfill « vinyls.added-date » qui balayait toute la
 * table des disques au démarrage de chaque conteneur.
 * Si UNE migration échoue, elle est journalisée (nom + instruction en échec)
 * et le boot continue : plus aucun échec antérieur ne peut bloquer les
 * migrations suivantes — c'était un mécanisme par lequel la création de
 * « vinyls.acquired_date » pouvait être empêchée, reproduisant « column
 * "acquired_date" does not exist ». Les boots suivants retentent d'ailleurs
 * la migration échouée (sa trace n'est inscrite qu'en cas de succès).
 * @returns {Promise<void>}
 */
async function migrate() {
  // Bootstrap du contrôle, hors transaction : indispensable au 1er boot
  // (avant qu'aucune migration ne soit tracée).
  try {
    await query(
      `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_APPLIED} (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());`
    );
  } catch (err) {
    console.error('[db] impossible de créer la table de suivi des migrations :', err.message);
  }

  // Noms des migrations déjà tracées : lecture de la table (absente avant le
  // 1er complet boot ; un échec ici ne doit pas casser les migrations).
  const alreadyApplied = new Set();
  try {
    const { rows } = await query(`SELECT name FROM ${MIGRATIONS_APPLIED}`);
    for (const r of rows) alreadyApplied.add(r.name);
  } catch { /* table absente/illisible : tout sera exécuté */ }

  for (const migration of MIGRATIONS) {
    if (migration.name !== 'meta.schema-migrations' && alreadyApplied.has(migration.name)) {
      continue; // déjà appliquée → instructions idempotentes inutiles
    }
    // « Tentée » dans ce boot (marqué même si L'essai en dessous échoue, pour
    // ne pas retenter infiniment une instruction instable au fil des relances).
    alreadyApplied.add(migration.name);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const statement of migration.statements) {
        await client.query(statement).catch((err) => {
          // Contexte explicite : sans lui, on ne voit que l'erreur Postgres
          // (« column … does not exist ») sans savoir LAQUELLE instruction a
          // échoué parmi les douze de la migration.
          err.message = `migration « ${migration.name} » — instruction en échec :\n${statement}\n→ ${err.message}`;
          throw err;
        });
      }
      await client.query(
        `INSERT INTO ${MIGRATIONS_APPLIED} (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
        [migration.name]
      );
      await client.query('COMMIT');
      console.log(`[db] migration appliquée : ${migration.name}`);
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* déjà annulé */ }
      // On NE casse plus le reste des migrations sur un échec : le démarrage
      // continue pour que les migrations utiles (ex. « vinyls.added-date »)
      // passent malgré un échec précédent. Le message reste bien visible.
      console.error(`[db] ÉCHEC de la migration « ${migration.name} » :`, err.message);
    } finally {
      client.release();
    }
  }
}

module.exports = { query, pool, migrate };
