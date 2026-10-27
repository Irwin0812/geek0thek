-- ============================================================
-- 008 — ENTITÉ ARTISTE (photo / logo d'artiste)
--
-- « Ajouter un disque » déclenche la création d'artiste sans dupliquer :
--   1. table `artists` : une ligne PAR NOM D'ARTISTE DISTINCT, dédupliquée
--      par nom normalisé (`norm_name` — même algorithme que
--      backend/src/utils/musicBrainzClient.js `normalizeArtistName()` :
--      minuscules, apostrophes typographiques ’ / ‘ harmonisées en ',
--      espaces multiples réduits) ;
--   2. vinyls.artist_id    : FK logique (BIGINT sans contrainte FK — la
--      table artists est créée par auto-migration au boot de l'API) ;
--   3. vinyls.artist_image : photo / logo affichée dans la grille « Mes
--      Disques » (tuile du groupe artiste). Portée PAR DISQUE (même pattern
--      que cover_url) : tous les disques d'un même artiste partagent la
--      MÊME image, quelle que soit l'URL distante ou le chemin local
--      (« /uploads/artists/… », repli propre « /img/no_group.jpg »).
--
-- L'IMAGE n'est PAS rétro-remplie sur les disques existants : elle est
-- récupérée automatiquement à la prochaine création / modification d'un
-- disque de cet artiste (MusicBrainz -> Cover Art Archive, repli
-- img/no_group.jpg). La jaquette d'album (cover_url) reste inchangée.
--
-- IDENTIQUE à l'auto-migration « artists.table » de
-- backend/src/config/db.js (appliquée au boot de l'API) — ce script manuel
-- sert seulement aux déploiements qui préfèrent appliquer les migrations
-- via psql. Idempotent.
-- ============================================================

BEGIN;

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

-- Recrée la vue publique : dépendances à jour (artist_id / artist_image).
-- DROP d'abord (obligatoire sur les bases « vintage ») : une vue « SELECT * »
-- porte une liste de colonnes figée depuis sa création — sans ce drop, le
-- CREATE OR REPLACE échouerait (« cannot change name of view column … »,
-- 42881) si des colonnes avaient été ajoutées à vinyls entre-temps.
DROP VIEW IF EXISTS public_vinyls;

CREATE OR REPLACE VIEW public_vinyls AS
SELECT v.*, u.first_name, u.last_name
FROM vinyls v
JOIN users u ON u.id = v.user_id
WHERE u.is_public = TRUE AND u.share_vinyls = TRUE;

COMMIT;
