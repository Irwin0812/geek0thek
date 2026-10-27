-- ============================================================
-- Migration 006 : « Nombre de vinyls » resserré à la plage du formulaire
-- Le select du formulaire est passé de 1 → 20 à 1 → 5 (défaut 1) : la
-- colonne discs_count doit porter la même contrainte.
--   1. Les valeurs EXISTANTES hors plage (6 → 20, stockées par les vieilles
--      versions du formulaire) sont d'abord resserrées aux bornes.
--   2. La contrainte CHECK est ALORS remplacée : l'ordre des deux
--      instructions est crucial (la remplacer avant le resserrage échouerait
--      sur les lignes 6 → 20).
-- NB : les colonnes is_special_edition / is_picture_disc / color n'ont PAS
-- bougé — seule la borne de discs_count change ici.
-- Idempotent (UPDATE + DROP IF EXISTS + ADD) : sans effet si déjà appliquée.
-- NB : cette même migration est appliquée automatiquement au démarrage de
-- l'API (voir backend/src/config/db.js, tableau MIGRATIONS :
-- « vinyls.discs-count-1-to-5 »). Ce script sert à l'application manuelle
-- (psql) sur une base existante.
--
-- Usage :
--   psql "$DATABASE_URL" -f database/migrations/006_vinyls_discs_count_1_to_5.sql
-- ============================================================

-- 1. Resserrage des valeurs existantes aux bornes du nouveau select (1 → 5).
UPDATE vinyls SET discs_count = LEAST(GREATEST(discs_count, 1), 5);

-- 2. Remplacement de la contrainte CHECK (interdit de l'inverser :
--    « ADD … IF NOT EXISTS » ne remplace jamais une contrainte existante).
ALTER TABLE vinyls DROP CONSTRAINT IF EXISTS vinyls_discs_count_check;
ALTER TABLE vinyls ADD CONSTRAINT vinyls_discs_count_check CHECK (discs_count BETWEEN 1 AND 5);
