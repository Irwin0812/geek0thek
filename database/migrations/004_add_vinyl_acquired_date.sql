-- ============================================================
-- Migration 004 : « Date d'ajout » des vinyles
-- Remplace l'ancien champ « Année d'acquisition » (année entière,
-- colonne year_acquired INTEGER) par une date exacte :
--   * acquired_date DATE NOT NULL DEFAULT CURRENT_DATE (Date d'ajout)
-- Idempotent (IF NOT EXISTS / garde information_schema) : sans effet
-- si déjà appliquée. NB : cette même migration est également
-- appliquée automatiquement au démarrage de l'API (voir
-- backend/src/config/db.js, tableau MIGRATIONS : « vinyls.added-date »).
-- Ce script sert à l'application manuelle (psql) sur une base existante.
--
-- Usage :
--   psql "$DATABASE_URL" -f database/migrations/004_add_vinyl_acquired_date.sql
-- ============================================================

-- Nouvelle colonne pour les lignes existantes / bases fraîches partielles.
ALTER TABLE vinyls ADD COLUMN IF NOT EXISTS acquired_date DATE;

-- Rétro-remplissage 1 : récupère l'ANNEE de l'ancienne « acquisition »
-- (année seule -> 1er janvier de cette année).
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

-- Rétro-remplissage 2 : les lignes sans historique reprennent la date du jour.
UPDATE vinyls SET acquired_date = CURRENT_DATE WHERE acquired_date IS NULL;

-- Contraintes définitives (alignées sur comics.added_date).
ALTER TABLE vinyls ALTER COLUMN acquired_date SET NOT NULL;
ALTER TABLE vinyls ALTER COLUMN acquired_date SET DEFAULT CURRENT_DATE;

-- L'ancienne colonne « année d'acquisition » n'est plus utilisée.
ALTER TABLE vinyls DROP COLUMN IF EXISTS year_acquired;
