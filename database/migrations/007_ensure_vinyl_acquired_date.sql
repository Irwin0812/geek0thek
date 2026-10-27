-- ============================================================
-- Migration 007 : Correction du schéma de base de données —
--                 colonnes d'images artiste / série + suivi
-- ------------------------------------------------------------
-- Portée (élargie par rapport à la version originale, qui ne couvrait
-- que « acquired_date » — le nom du fichier est conservé car les
-- messages d'erreur de l'API pointent vers « la migration 007 ») :
--
-- Symptôme traité : POST/PUT /api/vinyls (et /api/comics) répondent
-- « Base de données incomplète (colonne absente) ». Cause racine : un
-- volume PostgreSQL créé avant certaines auto-migrations du boot
-- n'est pas rattrapé automatiquement (Postgres renvoie le 42703
-- « column … does not exist »). Ce script répare TOUT LE schéma attendu
-- par les modèles backend, en ordre :
--   1. vinyls.acquired_date réellement absente : la vue public_vinyls
--      (init.sql, SELECT v.*) porte une dépendance PostgreSQL sur
--      CHAQUE colonne de vinyls, dont l'ancienne year_acquired ; le
--      DROP COLUMN échouait (« cannot drop column … ») et rollbackait
--      TOUTE la transaction — y compris le ADD COLUMN — à chaque boot.
--      Correction : DROP VIEW avant tout drop de colonne, restitution
--      de la vue recalée en fin de script (étape 7).
--   2. vinyls.mbid / vinyls.discogs_* (auto-migrations « vinyls.mbid »
--      et « vinyls.discogs » de backend/src/config/db.js).
--   3. Options du disque : is_special_edition, is_picture_disc,
--      discs_count (1 → 5), color (« vinyls.options » /
--      « vinyls.discs-count-1-to-5 », migrations manuelles 005/006).
--   4. COLONNES D'IMAGE ARTISTE (photos / logos d'artistes) : table
--      `artists` (entité dédupliquée par nom normalisé) +
--      vinyls.artist_id + vinyls.artist_image. L'image est portée PAR
--      DISQUE : tous les disques d'un même artiste affichent LA MÊME
--      photo / logo dans la grille « Mes Disques » (« /uploads/
--      artists/… », URL distante, repli propre « /img/no_group.jpg »).
--   5. COLONNES D'IMAGE SÉRIE (images / logos des séries BD) : table
--      `series` + comics.series_id + comics.series_image — même
--      pattern pour tous les tomes d'une même série (« /uploads/
--      series/… », repli propre « /img/no_title.jpg »).
--   6. comics.is_signed / comics.added_date (auto-migration
--      « comics.signed-and-added-date », migration manuelle 003).
--   7. TABLE DE SUIVI DES MIGRATIONS (schema_migrations) : chaque
--      auto-migration équivalente aux instructions ci-dessus est
--      marquée APPLIQUÉE en fin de script, DANS LA MÊME TRANSACTION —
--      si une étape échoue, aucune trace n'est inscrite. Le boot
--      suivant détecte donc la migration 007 comme VALIDE (schéma
--      complet + traces présentes) et l'erreur « Base de données
--      incomplète (colonne absente) » ne doit plus jamais s'élever.
--
-- Sections 4 et 5 : contenu IDENTIQUE aux scripts
-- database/migrations/008_add_artists_table.sql et
-- database/migrations/009_add_series_table.sql — ce script manuel est
-- le point unique de réparation documenté par l'API. L'image n'est PAS
-- rétro-remplie sur les lignes existantes (règle métier) : elle est
-- récupérée automatiquement au prochain enregistrement d'un disque /
-- d'une BD du même nom (cascade Last.fm -> Discogs / MusicBrainz +
-- Cover Art Archive, repli img/no_group.jpg ; Google Books / Open
-- Library, repli img/no_title.jpg). La jaquette d'album (cover_url)
-- reste inchangée.
--
-- Idempotent : sans effet si le schéma courant est déjà complet (IF NOT
-- EXISTS / ON CONFLICT DO NOTHING ; les vues recrées à l'identique
-- maintiennent leurs dépendances alignées sur le schéma courant).
-- Compatible PostgreSQL 14+ (pgcrypto déjà requis par init.sql).
--
-- Usage :
--   docker compose exec -T db psql -U vinyl -d geek0thek \
--     -f /dev/stdin < database/migrations/007_ensure_vinyl_acquired_date.sql
--   ou :
--   psql "$DATABASE_URL" -f database/migrations/007_ensure_vinyl_acquired_date.sql
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. DATE D'AJOUT DES DISQUES (vinyls.acquired_date)
-- ------------------------------------------------------------
-- 1.1 La vue public_vinyls dépend de TOUTES les colonnes de vinyls
--     (SELECT v.*) : sans ce drop, le drop de year_acquired (étape 1.6)
--     échouerait et rollbackerait la transaction entière — c'est
--     précisément ce qui empêchait acquired_date d'apparaître. La vue
--     est recréée à l'identique en étape 7, APRÈS tous les ajouts de
--     colonnes : ses dépendances se re-établissent alors sur le schéma
--     courant définitif (plus aucun drop de colonne vinyls ne pourra
--     être bloqué par elle).
DROP VIEW IF EXISTS public_vinyls;

-- 1.2 Crée la colonne si absente (DATE, pas encore contrainte).
ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS acquired_date DATE;

-- 1.3 Rétro-remplissage : ANNEE de l'ancienne « acquisition » (si la
--     vieille colonne year_acquired existe encore) -> 1er janvier de
--     cette année. Garde information_schema : sans effet sinon.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'vinyls' AND column_name = 'year_acquired'
  ) THEN
    UPDATE vinyls SET acquired_date = make_date(year_acquired, 1, 1)
    WHERE year_acquired IS NOT NULL
      AND year_acquired BETWEEN 1000 AND 9999
      AND acquired_date IS NULL;
  END IF;
END $$;

-- 1.4 Les lignes sans historique reprennent la date du jour.
UPDATE vinyls SET acquired_date = CURRENT_DATE WHERE acquired_date IS NULL;

-- 1.5 Contraintes définitives (alignées sur comics.added_date).
ALTER TABLE vinyls ALTER COLUMN acquired_date SET NOT NULL;
ALTER TABLE vinyls ALTER COLUMN acquired_date SET DEFAULT CURRENT_DATE;

-- 1.6 L'ancienne colonne « année d'acquisition » n'est plus utilisée —
--     faisable maintenant que la vue (étape 1.1) ne dépend plus d'elle.
ALTER TABLE vinyls DROP COLUMN IF EXISTS year_acquired;

-- ------------------------------------------------------------
-- 2. IDENTIFIANTS DE PARUTION (auto-migrations « vinyls.mbid » /
--    « vinyls.discogs » de config/db.js — garanties sur un volume créé
--    avant elles) : MBID MusicBrainz + identifiants Discogs.
-- ------------------------------------------------------------
ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS mbid VARCHAR(40);
CREATE INDEX IF NOT EXISTS idx_vinyls_mbid ON vinyls(mbid) WHERE mbid IS NOT NULL;

ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS discogs_release_id BIGINT;
ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS discogs_url TEXT;
CREATE INDEX IF NOT EXISTS idx_vinyls_discogs_release
  ON vinyls(discogs_release_id) WHERE discogs_release_id IS NOT NULL;

-- ------------------------------------------------------------
-- 3. OPTIONS DU DISQUE (auto-migrations « vinyls.options » /
--    « vinyls.discs-count-1-to-5 » ; migrations manuelles 005/006) :
--    édition spéciale, picture disc, nombre de galettes (plage formu-
--    laire 1 → 5, resserrée AVANT la contrainte — l'ordre est crucial,
--    les lignes legacy 6 → 20 échoueraient sinon), couleur.
-- ------------------------------------------------------------
ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS is_special_edition BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS is_picture_disc    BOOLEAN     NOT NULL DEFAULT FALSE;
ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS discs_count        INTEGER     NOT NULL DEFAULT 1;
ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS color              VARCHAR(50) NOT NULL DEFAULT 'Noir';

UPDATE vinyls SET discs_count = LEAST(GREATEST(discs_count, 1), 5);
ALTER TABLE vinyls DROP CONSTRAINT IF EXISTS vinyls_discs_count_check;
ALTER TABLE vinyls ADD CONSTRAINT vinyls_discs_count_check CHECK (discs_count BETWEEN 1 AND 5);

-- ------------------------------------------------------------
-- 4. COLONNES D'IMAGE ARTISTE (photo / logo d'ARTISTE) — entité Artiste :
--    « Ajouter un disque » déclenche la création / le rattachement de
--    l'entité sans dupliquer :
--      1. table `artists` : une ligne PAR NOM D'ARTISTE DISTINCT, clé
--         normalisée `norm_name` (même algorithme que
--         normalizeArtistName() de backend/src/utils/musicBrainzClient.js :
--         minuscules, apostrophes typographiques ’ / ‘ harmonisées en ',
--         espaces multiples réduits) ;
--      2. vinyls.artist_id + vinyls.artist_image : l'image est portée PAR
--         DISQUE — TOUS les disques d'un même artiste affichent LA MÊME
--         photo / logo dans la grille « Mes Disques » (tuile du groupe).
--         Chemin local « /uploads/artists/… », URL distante ou repli
--         propre « /img/no_group.jpg ».
--    SECTION IDENTIQUE à database/migrations/008_add_artists_table.sql.
--    L'IMAGE n'est PAS rétro-remplie sur les disques existants : elle est
--    récupérée automatiquement au prochain enregistrement d'un disque de
--    cet artiste (cascade Last.fm -> Discogs / MusicBrainz + Cover Art
--    Archive, repli propre img/no_group.jpg).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS artists (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    norm_name   VARCHAR(255) NOT NULL,
    image_url   TEXT,                      -- « /uploads/artists/… » ou « /img/no_group.jpg »
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT artists_norm_name_unique UNIQUE (norm_name)
);

CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);

ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS artist_id BIGINT;
ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS artist_image TEXT;

CREATE INDEX IF NOT EXISTS idx_vinyls_artist_id ON vinyls(artist_id) WHERE artist_id IS NOT NULL;

-- Backfill : une ligne d'artiste par nom distinct + rattachement des disques.
DO $$
DECLARE
    v_artist VARCHAR(255);
    v_norm   VARCHAR(255);
BEGIN
    FOR v_artist IN
        SELECT DISTINCT artist FROM vinyls WHERE btrim(artist) <> ''
    LOOP
        -- Normalisation alignée sur normalizeArtistName() (JS) :
        -- minuscules / apostrophes typographiques -> ' / espaces réduits.
        v_norm := lower(regexp_replace(
            btrim(replace(replace(v_artist, chr(8217), chr(39)), chr(8216), chr(39))),
            '\\s+', ' ', 'g'));
        INSERT INTO artists (name, norm_name) VALUES (v_artist, v_norm)
        ON CONFLICT (norm_name) DO NOTHING;

        UPDATE vinyls AS v SET artist_id = a.id
        FROM (SELECT id FROM artists WHERE norm_name = v_norm) a
        WHERE v.artist = v_artist AND v.artist_id IS NULL;
    END LOOP;
END $$;

-- ------------------------------------------------------------
-- 5. COLONNES D'IMAGE SÉRIE (image / logo de SÉRIE BD) — entité Série :
--    « Ajouter / modifier une BD » déclenche la création / le
--    rattachement de l'entité sans dupliquer :
--      1. table `series` : une ligne PAR NOM DE SÉRIE DISTINCT, clé
--         normalisée `norm_name` (même algorithme que
--         normalizeSeriesName() de backend/src/utils/seriesService.js) ;
--      2. comics.series_id + comics.series_image : image / logo affichée
--         pour CHAQUE tome dans la grille « Mes BD ». Portée PAR BD —
--         TOUS les tomes d'une même série affichent LA MÊME image
--         (« /uploads/series/… », repli propre « /img/no_title.jpg »).
--    SECTION IDENTIQUE à database/migrations/009_add_series_table.sql.
--    L'IMAGE n'est PAS rétro-remplie sur les BD existantes : récupérée
--    automatiquement au prochain enregistrement d'une BD de cette série
--    (recherche Google Books + Open Library, repli propre img/no_title.jpg).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS series (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL,
    norm_name   VARCHAR(255) NOT NULL,
    image_url   TEXT,                      -- « /uploads/series/… » ou « /img/no_title.jpg »
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT series_norm_name_unique UNIQUE (norm_name)
);

CREATE INDEX IF NOT EXISTS idx_series_name ON series(name);

ALTER TABLE comics ADD COLUMN IF NOT EXISTS series_id BIGINT;
ALTER TABLE comics ADD COLUMN IF NOT EXISTS series_image TEXT;

CREATE INDEX IF NOT EXISTS idx_comics_series_id ON comics(series_id) WHERE series_id IS NOT NULL;

-- Backfill : une ligne de série par nom distinct + rattachement des BD.
DO $$
DECLARE
    v_series VARCHAR(255);
    v_norm   VARCHAR(255);
BEGIN
    FOR v_series IN
        SELECT DISTINCT series FROM comics WHERE btrim(series) <> '' AND series IS NOT NULL
    LOOP
        -- Normalisation alignée sur normalizeSeriesName() (JS).
        v_norm := lower(regexp_replace(
            btrim(replace(replace(v_series, chr(8217), chr(39)), chr(8216), chr(39))),
            '\\s+', ' ', 'g'));
        INSERT INTO series (name, norm_name) VALUES (v_series, v_norm)
        ON CONFLICT (norm_name) DO NOTHING;

        UPDATE comics AS c SET series_id = s.id
        FROM (SELECT id FROM series WHERE norm_name = v_norm) s
        WHERE c.series = v_series AND c.series_id IS NULL;
    END LOOP;
END $$;

-- ------------------------------------------------------------
-- 6. BD : « Livre dédicacé » + DATE D'AJOUT (auto-migration
--    « comics.signed-and-added-date » ; migration manuelle 003) — garanties
--    pour les volumes créés avant elles (l'INSERT du POST /api/comics les
--    cible systématiquement).
-- ------------------------------------------------------------
ALTER TABLE comics ADD COLUMN IF NOT EXISTS is_signed  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE comics ADD COLUMN IF NOT EXISTS added_date DATE    NOT NULL DEFAULT CURRENT_DATE;
CREATE INDEX IF NOT EXISTS idx_comics_series ON comics(lower(series)) WHERE series IS NOT NULL;

-- ------------------------------------------------------------
-- 7. RESTAURATION DES VUES PUBLIQUES : MÊME CORPS qu'init.sql, mais
--    recréées APRÈS TOUTS les ajouts de colonnes — leurs dépendances se
--    re-établissent sur le schéma courant définitif : SELECT * est une
--    fois pour toutes résolu contre l'intégralité du schéma (artist_*,
--    series_*, acquired_date, mbid…). Plus aucun drop / add de colonne
--    vinyls/comics ne peut être bloqué par elles.
--    ATTENTION — DROP d'ABORD (obligatoire sur les bases « vintage ») : une
--    vue « SELECT * » de PostgreSQL fige la LISTE DES COLONNES au moment
--    où elle a été créée (dépendance figée). Depuis sa création, si des
--    colonnes ont été ajoutées à vinyls / comics (artist_id, is_signed…),
--    le « CREATE OR REPLACE VIEW » échouerait avec
--    « cannot change name of view column X to Y » (code 42881), annulant
--    toute la transaction : on DROP D'ABORD les vues obsolescentes
--    pour que l'écart de colonne se résolve sans erreur. (Idempotent —
--    DROP VIEW IF EXISTS sur une vue absente est inoffensif.)
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public_vinyls;

CREATE OR REPLACE VIEW public_vinyls AS
SELECT v.*, u.first_name, u.last_name
FROM vinyls v
JOIN users u ON u.id = v.user_id
WHERE u.is_public = TRUE AND u.share_vinyls = TRUE;

DROP VIEW IF EXISTS public_comics;

CREATE OR REPLACE VIEW public_comics AS
SELECT c.*, u.first_name, u.last_name
FROM comics c
JOIN users u ON u.id = c.user_id
WHERE u.is_public = TRUE AND u.share_comics = TRUE;

-- ------------------------------------------------------------
-- 8. TABLE DE SUIVI DES MIGRATIONS (name TEXT PRIMARY KEY) — créée par
--    l'auto-migration « meta.schema-migrations » de config/
--    db.js : on la garantit ici pour que les déploiements sans boot API
--    aient aussi le suivi en place, puis on INSCRIT DANS LA MÊME
--    TRANSACTION les auto-migrations dont les instructions sont présent-
--    ment couvertes par ce script (ON CONFLICT DO NOTHING : sans effet si
--    l'API les a déjà tracées). Rôle du suivi : au boot suivant, migrate()
--    de config/db.js lit cette table et IGNORE chaque auto-migration déjà
--    tracée — la migration 007 est donc détectée comme VALIDE (applied)
--    et l'erreur « Base de données incomplète (colonne absente) » ne peut
--    plus s'élever : si UNE étape du script avait échoué, le ROLLBACK
--    n'aurait inclus AUCUNE trace, et la reconstruction du boot aurait
--    retenté les instructions idempotentes sans casser rien.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (name) VALUES
    ('meta.schema-migrations'),   -- la table de suivi elle-même
    ('vinyls.mbid'),              -- étape 2
    ('vinyls.discogs'),           -- étape 2
    ('vinyls.options'),           -- étape 3
    ('vinyls.discs-count-1-to-5'),-- étape 3
    ('comics.signed-and-added-date'), -- étape 6
    ('vinyls.added-date'),        -- étape 1 (acquired_date + vue)
    ('artists.table'),            -- étape 4 (table artists + vinyls.artist_*)
    ('series.table')              -- étape 5 (table series + comics.series_*)
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- ------------------------------------------------------------
-- 9. VÉRIFICATION (post-commit, non bloquant) : doit afficher les
--    colonnes des disques / BD avec leurs contraintes, les entités par
--    nom + leur image, et le suivi des migrations appliqué.
-- ------------------------------------------------------------
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE (table_name = 'vinyls'  AND column_name IN
       ('acquired_date', 'mbid', 'discogs_release_id', 'discogs_url',
        'is_special_edition', 'is_picture_disc', 'discs_count', 'color',
        'artist_id', 'artist_image'))
   OR (table_name = 'comics' AND column_name IN
       ('is_signed', 'added_date', 'series_id', 'series_image'))
ORDER BY table_name, ordinal_position;

-- Entités + suivi présents (3 lignes attendues) avec leur nombre de lignes :
SELECT t.table_name,
       (SELECT COUNT(*) FROM artists)          AS artists_rows,
       (SELECT COUNT(*) FROM series)           AS series_rows,
       (SELECT COUNT(*) FROM schema_migrations) AS migrations_applied
FROM (VALUES ('artists'), ('series'), ('schema_migrations')) AS t(table_name);

-- Suivi des migrations : les 9 noms de l'INSERT de l'étape 8 doivent y être
-- tracés (le boot de l'API peut en ajouter d'autres — users.*/covers.*).
SELECT name, applied_at FROM schema_migrations ORDER BY name;
