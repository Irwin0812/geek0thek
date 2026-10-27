-- ============================================================
-- 009 — ENTITÉ SÉRIE (image / logo de série)
--
-- « Ajouter / modifier une BD » déclenche la création de série sans
-- dupliquer :
--   1. table `series` : une ligne PAR NOM DE SÉRIE DISTINCT, dédupliquée
--      par nom normalisé (`norm_name` — même algorithme que
--      backend/src/utils/seriesService.js `normalizeSeriesName()` :
--      minuscules, apostrophes typographiques ’ / ‘ harmonisées en ',
--      espaces multiples réduits) ;
--   2. comics.series_id    : FK logique (BIGINT sans contrainte FK — la
--      table series est créée par auto-migration au boot de l'API) ;
--   3. comics.series_image : image / logo affichée pour chaque tome dans la
--      grille « Mes BD ». Portée PAR BD (même pattern que cover_url) : tous
--      les tomes d'une même série partagent la MÊME image, quelle que soit
--      l'URL distante ou le chemin local (« /uploads/series/… », repli
--      propre « /img/no_title.jpg »).
--
-- L'IMAGE n'est PAS rétro-remplie sur les BD existantes : elle est
-- récupérée automatiquement à la prochaine création / modification d'une BD
-- de cette série (recherche Google Books + Open Library, repli propre
-- img/no_title.jpg). La couverture d'album (cover_url) reste inchangée.
--
-- IDENTIQUE à l'auto-migration « series.table » de
-- backend/src/config/db.js (appliquée au boot de l'API) — ce script manuel
-- sert seulement aux déploiements qui préfèrent appliquer les migrations
-- via psql. Idempotent.
-- ============================================================

BEGIN;

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
        -- Normalisation alignée sur normalizeSeriesName() (JS) :
        -- minuscules / apostrophes typographiques -> ' / espaces réduits.
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

-- Recrée la vue publique : dépendances à jour (series_id / series_image).
-- DROP d'abord (obligatoire sur les bases « vintage ») : une vue « SELECT * »
-- porte une liste de colonnes figée depuis sa création — sans ce drop, le
-- CREATE OR REPLACE échouerait (« cannot change name of view column … »,
-- 42881) si des colonnes avaient été ajoutées à comics entre-temps.
DROP VIEW IF EXISTS public_comics;

CREATE OR REPLACE VIEW public_comics AS
SELECT c.*, u.first_name, u.last_name
FROM comics c
JOIN users u ON u.id = c.user_id
WHERE u.is_public = TRUE AND u.share_comics = TRUE;

COMMIT;
