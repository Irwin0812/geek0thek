-- ============================================================
-- Migration 015 : couleurs de galette en MULTI-SELECT
-- Le formulaire « Nouveau / Modifier le disque » permet désormais
-- de choisir PLUSIEURS couleurs pour un même disque. La colonne
-- vinyls.color passe de VARCHAR(50) à TEXT : les couleurs sont
-- stockées en liste séparée par des virgules (ex. « Noir, Orange,
-- Métallisé »). Élargissement sans perte : les valeurs
-- mono-couleur héritées (« Noir », « N/A »…) restent valides
-- telles quelles.
-- NB : la vue public_vinyls (SELECT v.*) porte une dépendance sur
-- CHAQUE colonne de vinyls : PostgreSQL refuse alors l'ALTER TYPE.
-- On la retire d'abord et on la recrée à l'identique à la fin
-- (même pattern que la migration 014).
-- NB : cette même migration est également appliquée automatiquement
-- au démarrage de l'API (backend/src/config/db.js, tableau MIGRATIONS :
-- « vinyls.color-multi »). Ce script sert à l'application manuelle
-- (psql) sur une base existante.
--
-- Usage :
--   psql "$DATABASE_URL" -f database/migrations/015_vinyls_color_multi_select.sql
-- ============================================================

BEGIN;

DROP VIEW IF EXISTS public_vinyls;

ALTER TABLE vinyls ALTER COLUMN color TYPE TEXT;

CREATE OR REPLACE VIEW public_vinyls AS
SELECT v.*, u.first_name, u.last_name
FROM vinyls v
JOIN users u ON u.id = v.user_id
WHERE u.is_public = TRUE AND u.share_vinyls = TRUE;

COMMIT;
