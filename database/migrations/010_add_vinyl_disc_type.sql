-- ============================================================
-- Migration 010 : « Type de Disque » du formulaire « Ajouter /
-- Modifier un disque » (1er élément de la rangée horizontale des
-- options du disque) — nouvelle colonne sur la table VINYLS :
--   * disc_type VARCHAR(20) NOT NULL DEFAULT 'Vinyle'
-- Valeurs proposées par le menu déroulant : « Vinyle » (défaut,
-- remplace l'ancienne option « Disque Vinyle ») ou « Compact ».
-- Rétro-remplissage : les lignes existantes reprennent le défaut
-- « Vinyle » (toutes étaient des vinyles avant ce champ).
-- Idempotente (IF NOT EXISTS / COALESCE cible vide) : sans effet
-- si déjà appliquée. NB : cette même migration est également
-- appliquée automatiquement au démarrage de l'API (voir
-- backend/src/config/db.js, tableau MIGRATIONS : « vinyls.disc-type »).
-- Ce script sert à l'application manuelle (psql) sur une base existante.
--
-- Usage :
--   psql "$DATABASE_URL" -f database/migrations/010_add_vinyl_disc_type.sql
-- ============================================================

ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS disc_type VARCHAR(20) NOT NULL DEFAULT 'Vinyle';

-- Valeur par défaut pour toute ligne créée ou modifiée par la suite :
ALTER TABLE vinyls ALTER COLUMN disc_type SET DEFAULT 'Vinyle';

-- Rétro-remplissage : lignes legacy dont la valeur serait vide (cas
-- hypothétique d'un ajout antérieur de la colonne sans défaut).
UPDATE vinyls SET disc_type = 'Vinyle' WHERE btrim(COALESCE(disc_type, '')) = '';
