-- ============================================================
-- Geek0thek - Initialisation PostgreSQL
-- Exécuté automatiquement par l'image postgres à la 1re
-- création du volume de données (./data).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- Table USERS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id             BIGSERIAL PRIMARY KEY,
    last_name      VARCHAR(120) NOT NULL,
    first_name     VARCHAR(120) NOT NULL,
    email          VARCHAR(255) NOT NULL UNIQUE,
    login          VARCHAR(80)  NOT NULL UNIQUE,
    password_hash  VARCHAR(255) NOT NULL,
    role           VARCHAR(20)  NOT NULL DEFAULT 'user'
                   CHECK (role IN ('admin', 'user')),
    phone          VARCHAR(50),
    bio            VARCHAR(500),
    -- Visibilité de la collection : publique ou privée (choix utilisateur)
    is_public      BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Activation / désactivation du compte (gérée par les administrateurs)
    is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Partage granulaire de la visibilité publique : quels éléments sont
    -- exposés quand is_public = TRUE (défaut TRUE : aucun changement
    -- d'ergonomie pour les comptes existants)
    share_vinyls   BOOLEAN      NOT NULL DEFAULT TRUE,
    share_comics   BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Champs enrichis du profil (tous optionnels)
    avatar_url     TEXT,                       -- '/uploads/avatars/xxx.jpg' ou NULL
    -- Langue préférée de l'utilisateur (code ISO 639-1, défaut : français)
    language       VARCHAR(5)   NOT NULL DEFAULT 'fr',
    -- Thème visuel préféré (dark / light / vinyl / comic / cartoon / pastel)
    theme          VARCHAR(50)  NOT NULL DEFAULT 'dark',
    gender         VARCHAR(1)   CHECK (gender IN ('H', 'F', 'O')),  -- H / F / O (Autre)
    birth_date     DATE,
    address        VARCHAR(255),
    country        VARCHAR(120),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ------------------------------------------------------------
-- Table VINYLS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vinyls (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Chaîne d'accès locale (/uploads/xxx.ext) ou URL distante (http...)
    cover_url     TEXT        NOT NULL,
    artist        VARCHAR(255) NOT NULL,
    title         VARCHAR(255) NOT NULL,
    track_count   INTEGER     NOT NULL DEFAULT 0 CHECK (track_count >= 0),
    tracklist     TEXT,                 -- liste des titres (1 titre par ligne)
    genre         VARCHAR(120),
    label         VARCHAR(255),
    release_date  DATE,
    barcode       VARCHAR(64) UNIQUE,
    -- Identifiant MusicBrainz (release MBID, UUID) de la parution
    mbid          VARCHAR(40),
    -- Identifiants Discogs de la parution (complément de MusicBrainz, via la
    -- recherche par code-barres EAN) : id de la release + URL de la fiche
    discogs_release_id BIGINT,
    discogs_url   TEXT,
    -- ENTITÉ ARTISTE (photo / logo) : id de l'entité artists (dédupliquée
    -- par nom normalisé, table créée plus bas — migration 007/008) +
    -- image portée PAR DISQUE : tous les disques d'un même artiste
    -- affichent LA MÊME photo / logo dans la grille « Mes Disques »
    -- (« /uploads/artists/… », URL distante, repli propre /img/no_group.jpg).
    artist_id     BIGINT,
    artist_image  TEXT,
    -- Remplace l'ancien « Année d'acquisition » (année entière) : date
    -- exacte d'ajout du vinyle à la collection (défaut = jour de la
    -- création). Alignée sur comics.added_date.
    acquired_date DATE        NOT NULL DEFAULT CURRENT_DATE,
    notes         TEXT,
    -- Options du vinyle (rangée horizontale du formulaire) : type de disque
    -- (« Vinyle » / « Compact », défaut « Vinyle »), « Édition spéciale
    -- (case à cocher), « Picture Disc » (Oui/Non), nombre de galettes (1 → 5)
    -- et couleur de la galette (défaut « Noir »).
    disc_type          VARCHAR(20) NOT NULL DEFAULT 'Vinyle',
    is_special_edition BOOLEAN     NOT NULL DEFAULT FALSE,
    is_picture_disc    BOOLEAN     NOT NULL DEFAULT FALSE,
    discs_count        INTEGER     NOT NULL DEFAULT 1
                       CHECK (discs_count BETWEEN 1 AND 5),
    color              VARCHAR(50) NOT NULL DEFAULT 'Noir',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vinyls_user_id   ON vinyls(user_id);
CREATE INDEX IF NOT EXISTS idx_vinyls_artist    ON vinyls(artist);
CREATE INDEX IF NOT EXISTS idx_vinyls_title     ON vinyls(title);
CREATE INDEX IF NOT EXISTS idx_vinyls_genre     ON vinyls(genre);
CREATE INDEX IF NOT EXISTS idx_vinyls_release   ON vinyls(release_date);
CREATE INDEX IF NOT EXISTS idx_vinyls_barcode   ON vinyls(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vinyls_mbid      ON vinyls(mbid) WHERE mbid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vinyls_discogs_release ON vinyls(discogs_release_id) WHERE discogs_release_id IS NOT NULL;
-- FK logique de l'entité Artiste (la table `artists` est créée plus bas).
CREATE INDEX IF NOT EXISTS idx_vinyls_artist_id ON vinyls(artist_id) WHERE artist_id IS NOT NULL;

-- ------------------------------------------------------------
-- Trigger : mise à jour automatique de updated_at
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_vinyls_updated_at ON vinyls;
CREATE TRIGGER trg_vinyls_updated_at
    BEFORE UPDATE ON vinyls
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- VUE : vinyles d'une collection publique (lecture seule)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public_vinyls AS
SELECT v.*, u.first_name, u.last_name
FROM vinyls v
JOIN users u ON u.id = v.user_id
WHERE u.is_public = TRUE AND u.share_vinyls = TRUE;

-- ------------------------------------------------------------
-- Table COMICS (BD)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS comics (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Chaîne d'accès locale (/uploads/comics/xxx.ext) ou URL distante (http...)
    cover_url     TEXT,
    title         VARCHAR(255) NOT NULL,
    series        VARCHAR(255),
    tome_number   VARCHAR(50),
    authors       VARCHAR(255) NOT NULL,
    illustrators  VARCHAR(255),
    publisher     VARCHAR(255) NOT NULL,
    release_date  VARCHAR(50),
    genre         VARCHAR(255),
    isbn          VARCHAR(20) UNIQUE,
    synopsis      TEXT,
    -- ENTITÉ SÉRIE (image / logo) : id de l'entité series (dédupliquée par
    -- nom normalisé, table créée plus bas — migration 007/009) + image
    -- portée PAR BD : TOUS les tomes d'une même série affichent LA MÊME
    -- image / logo dans la grille « Mes BD » (« /uploads/series/… », repli
    -- propre /img/no_title.jpg).
    series_id     BIGINT,
    series_image  TEXT,
    -- « État » : conservé pour les lignes existantes (le formulaire ne le
    -- gère plus ; il a été remplacé par la date d'ajout ci-dessous).
    condition     VARCHAR(50)   NOT NULL DEFAULT 'Bon état',
    is_special_edition BOOLEAN NOT NULL DEFAULT FALSE,
    -- « Livre dédicacé » (case à cocher du formulaire BD)
    is_signed     BOOLEAN      NOT NULL DEFAULT FALSE,
    -- Remplace l'ancien champ « État » dans le formulaire : date d'ajout
    -- de la BD à la collection (défaut = jour de la création). Différente
    -- de created_at (horodatage horaire de la création technique) : c'est
    -- une DATE métier choisie par l'utilisateur.
    added_date    DATE         NOT NULL DEFAULT CURRENT_DATE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comics_user_id   ON comics(user_id);
CREATE INDEX IF NOT EXISTS idx_comics_isbn      ON comics(isbn) WHERE isbn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comics_title     ON comics(title);
CREATE INDEX IF NOT EXISTS idx_comics_authors   ON comics(authors);
CREATE INDEX IF NOT EXISTS idx_comics_publisher ON comics(publisher);
-- Recherche « auto-copie du synopsis par série » : retrouver les BD d'une
-- même série (comparaison insensible à la casse) avec un synopsis renseigné.
CREATE INDEX IF NOT EXISTS idx_comics_series    ON comics(lower(series))
     WHERE series IS NOT NULL;
-- FK logique de l'entité Série (la table `series` est créée plus bas).
CREATE INDEX IF NOT EXISTS idx_comics_series_id ON comics(series_id) WHERE series_id IS NOT NULL;

-- Trigger : updated_at de la table comics
DROP TRIGGER IF EXISTS trg_comics_updated_at ON comics;
CREATE TRIGGER trg_comics_updated_at
    BEFORE UPDATE ON comics
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- VUE : BD des collections publiques (lecture seule)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW public_comics AS
SELECT c.*, u.first_name, u.last_name
FROM comics c
JOIN users u ON u.id = c.user_id
WHERE u.is_public = TRUE AND u.share_comics = TRUE;

-- ------------------------------------------------------------
-- ENTITÉ ARTISTE (photo / logo d'artiste) — une ligne PAR NOM D'ARTISTE
-- DISTINCT, dédupliquée par nom normalisé (norm_name). L'image de chaque
-- disque est portée par la colonne vinyls.artist_image (copie par disque,
-- même pattern que cover_url) ; l'entité la conserve pour référence et
-- réutilisation. La table `series` des BD suit le même pattern (ci-dessous).
-- Voir database/migrations/007_ensure_vinyl_acquired_date.sql (sections 4/5)
-- et backend/src/utils/artistService.js — le contenu est IDENTIQUE pour que
-- les volumes neufs ET les volumes rattrapés par la migration 007 soient au
-- même schéma : l'image n'est PAS rétro-remplie ici, elle est récupérée
-- automatiquement à la prochaine création / modification d'un disque du
-- même artiste (cascade Last.fm -> Discogs / MusicBrainz + Cover Art
-- Archive, repli propre img/no_group.jpg).
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

-- Trigger : updated_at de la table artists
DROP TRIGGER IF EXISTS trg_artists_updated_at ON artists;
CREATE TRIGGER trg_artists_updated_at
    BEFORE UPDATE ON artists
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- ENTITÉ SÉRIE (image / logo de série BD) — une ligne PAR NOM DE SÉRIE
-- DISTINCT, même pattern que `artists` : l'image de chaque tome est portée
-- par la colonne comics.series_image ci-dessus. Replui propre
-- img/no_title.jpg. Voir migrations 007 (section 5) / 009 et
-- backend/src/utils/seriesService.js.
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

-- Trigger : updated_at de la table series
DROP TRIGGER IF EXISTS trg_series_updated_at ON series;
CREATE TRIGGER trg_series_updated_at
    BEFORE UPDATE ON series
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------
-- Admin par défaut (unique)
--   Login  : Admirwin
--   Mot de passe : IR@08515#Ger!  (hashé bcrypt, coût 12)
-- ------------------------------------------------------------
INSERT INTO users (last_name, first_name, email, login, password_hash, role, is_public)
VALUES (
    'Admirwin',
    'Admir',
    'admin@geek0thek.local',
    'Admirwin',
    '$2a$12$d.WfqbMEK/FH88i4BWTxR.sA1CLsIfhY/8fK8.3F0WjAe8PcKkkEa',
    'admin',
    TRUE
)
ON CONFLICT (login) DO NOTHING;
