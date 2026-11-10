-- ============================================================
-- Migration 014 : élargissement des colonnes texte libre en TEXT
-- Les valeurs renvoyées par les API externes (MusicBrainz / Discogs /
-- Last.fm / Google Books / Open Library) et saisies librement dépassent
-- régulièrement VARCHAR(120/255) : « value too long for type character
-- varying(120) » sur vinyls.genre, vinyls.label, comics.publisher, etc.
-- Toutes les colonnes de TEXTE LIBRE (noms, titres, genres, labels,
-- éditeurs, auteurs, adresses…) sont converties en TEXT — élargissement
-- sans perte : les index btree et les contraintes UNIQUE (artists/series
-- norm_name) restent valides, aucune donnée n'est modifiée. Les colonnes
-- à VOCABULAIRE FERMÉ (role, language, theme, gender, disc_type, color,
-- condition, scope, barcode, mbid, isbn, tome_number, phone, email, login)
-- conservent leur type borné.
-- Idempotente : ALTER COLUMN TYPE TEXT sur une colonne déjà TEXT est un
-- no-op sans effet.
-- NB : les vues public_vinyls / public_comics (SELECT v.* / c.*) portent
-- une dépendance sur CHAQUE colonne de vinyls/comics (et sur
-- users.first_name/last_name) : PostgreSQL refuse alors l'ALTER TYPE. On
-- les retire d'abord et on les recrée à l'identique à la fin (même pattern
-- que la migration « vinyls.added-date »).
-- NB : cette même migration est également appliquée automatiquement au
-- démarrage de l'API (backend/src/config/db.js, tableau MIGRATIONS :
-- « schema.widen-text-columns »). Ce script sert à l'application manuelle
-- (psql) sur une base existante.
--
-- Usage :
--   psql "$DATABASE_URL" -f database/migrations/014_widen_text_columns.sql
-- ============================================================

BEGIN;

-- Retrait des vues publiques (dépendance sur chaque colonne de vinyls/comics)
DROP VIEW IF EXISTS public_vinyls;
DROP VIEW IF EXISTS public_comics;

-- users — profil
ALTER TABLE users ALTER COLUMN last_name TYPE TEXT;
ALTER TABLE users ALTER COLUMN first_name TYPE TEXT;
ALTER TABLE users ALTER COLUMN bio TYPE TEXT;
ALTER TABLE users ALTER COLUMN address TYPE TEXT;
ALTER TABLE users ALTER COLUMN country TYPE TEXT;

-- vinyls — disques
ALTER TABLE vinyls ALTER COLUMN artist TYPE TEXT;
ALTER TABLE vinyls ALTER COLUMN title TYPE TEXT;
ALTER TABLE vinyls ALTER COLUMN genre TYPE TEXT;
ALTER TABLE vinyls ALTER COLUMN label TYPE TEXT;

-- comics — BD
ALTER TABLE comics ALTER COLUMN title TYPE TEXT;
ALTER TABLE comics ALTER COLUMN series TYPE TEXT;
ALTER TABLE comics ALTER COLUMN authors TYPE TEXT;
ALTER TABLE comics ALTER COLUMN illustrators TYPE TEXT;
ALTER TABLE comics ALTER COLUMN publisher TYPE TEXT;
ALTER TABLE comics ALTER COLUMN genre TYPE TEXT;

-- artists — entité artiste
ALTER TABLE artists ALTER COLUMN name TYPE TEXT;
ALTER TABLE artists ALTER COLUMN norm_name TYPE TEXT;
ALTER TABLE artists ALTER COLUMN genre TYPE TEXT;

-- series — entité série
ALTER TABLE series ALTER COLUMN name TYPE TEXT;
ALTER TABLE series ALTER COLUMN norm_name TYPE TEXT;

-- Recrée les vues publiques (mêmes corps qu'init.sql) : leurs dépendances
-- sont cette fois établies sur le schéma élargi.
CREATE OR REPLACE VIEW public_vinyls AS
SELECT v.*, u.first_name, u.last_name
FROM vinyls v
JOIN users u ON u.id = v.user_id
WHERE u.is_public = TRUE AND u.share_vinyls = TRUE;

CREATE OR REPLACE VIEW public_comics AS
SELECT c.*, u.first_name, u.last_name
FROM comics c
JOIN users u ON u.id = c.user_id
WHERE u.is_public = TRUE AND u.share_comics = TRUE;

COMMIT;
