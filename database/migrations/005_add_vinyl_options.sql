-- ============================================================
-- Migration 005 : « Options du vinyle » (rangée horizontale du formulaire)
-- Quatre nouvelles colonnes sur la table VINYLS :
--   * is_special_edition BOOLEAN NOT NULL DEFAULT FALSE  — « Édition spéciale » (case à cocher, comme les BDs)
--   * is_picture_disc    BOOLEAN NOT NULL DEFAULT FALSE  — « Picture Disc » (select Oui/Non, défaut Non)
--   * discs_count        INTEGER NOT NULL DEFAULT 1      — « Nombre de vinyls » (défaut 1 —
--     borne du CHECK : 1 → 5, resserrée par la migration 006 suite au changement
--     de plage du formulaire)
--   * color              VARCHAR(50) NOT NULL DEFAULT 'Noir' — « Couleur » de la galette (défaut Noir)
-- Idempotent (IF NOT EXISTS / garde information_schema) : sans effet
-- si déjà appliquée. NB : cette même migration est également
-- appliquée automatiquement au démarrage de l'API (voir
-- backend/src/config/db.js, tableau MIGRATIONS : « vinyls.options »).
-- Ce script sert à l'application manuelle (psql) sur une base existante.
--
-- Usage :
--   psql "$DATABASE_URL" -f database/migrations/005_add_vinyl_options.sql
-- ============================================================

ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS is_special_edition BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS is_picture_disc    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS discs_count        INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS color              VARCHAR(50) NOT NULL DEFAULT 'Noir';

-- « Nombre de vinyls » borné par le formulaire (select 1 → 5, défaut 1).
-- NB : si cette migration a déjà été appliquée avec l'ancienne borne
-- (1 → 20), c'est la migration 006 qui resserre la contrainte — elle ne
-- remplace QUE si la contrainte n'existe pas.
DO $$
BEGIN
   IF NOT EXISTS (
     SELECT 1 FROM pg_constraint
     WHERE conname = 'vinyls_discs_count_check' AND conrelid = 'public.vinyls'::regclass
   ) THEN
     ALTER TABLE vinyls
       ADD CONSTRAINT vinyls_discs_count_check CHECK (discs_count BETWEEN 1 AND 5);
   END IF;
END $$;

-- Couleur de la galette : jamais vide (défaut « Noir » côté formulaire et colonne).
ALTER TABLE vinyls ALTER COLUMN color SET NOT NULL;
