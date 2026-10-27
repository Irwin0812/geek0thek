-- ============================================================
-- Migration 003 : champs « dédicacé » + « date d'ajout » des BDs
-- Ajoute à la table comics :
--   * is_signed   BOOLEAN NOT NULL DEFAULT FALSE          (Livre dédicacé)
--   * added_date  DATE    NOT NULL DEFAULT CURRENT_DATE   (Date d'ajout)
--   + index sur lower(series) pour l'auto-copie du synopsis par série.
-- Idempotent (IF NOT EXISTS) : sans effet si déjà appliquée.
-- NB : cette même migration est également appliquée automatiquement
--      au démarrage de l'API (backend/src/config/db.js, tableau
--      MIGRATIONS : « comics.signed-and-added-date »). Ce script sert à
--      l'application manuelle (psql) sur une base existante.
--
-- Usage :
--   psql "$DATABASE_URL" -f database/migrations/003_add_comic_signed_and_added_date.sql
-- ============================================================

-- « Livre dédicacé » : case booléenne du formulaire BD (défaut NON dédicacé).
ALTER TABLE comics ADD COLUMN IF NOT EXISTS is_signed BOOLEAN NOT NULL DEFAULT FALSE;

-- Remplace l'ancien champ « État » dans le formulaire : date d'ajout de la
-- BD à la collection. Valeur par défaut = aujourd'hui pour les lignes
-- existantes ; l'API écrira la date saisie au prochain enregistrement.
ALTER TABLE comics ADD COLUMN IF NOT EXISTS added_date DATE NOT NULL DEFAULT CURRENT_DATE;

-- Index utile à l'auto-copie intelligente du synopsis par série :
-- retrouver rapidement les BD d'une même série (comparaison insensible à
-- la casse) ayant déjà un synopsis renseigné.
CREATE INDEX IF NOT EXISTS idx_comics_series ON comics(lower(series)) WHERE series IS NOT NULL;
