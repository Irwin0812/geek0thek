-- ============================================================
-- Migration 002 : thème visuel préféré des utilisateurs
-- Ajoute la colonne `users.theme` (VARCHAR(50), défaut 'dark').
-- Idempotent (IF NOT EXISTS) : sans effet si déjà appliquée.
-- NB : cette même migration est également appliquée
-- automatiquement au démarrage de l'API (backend/src/config/db.js,
-- tableau MIGRATIONS : « users.theme »). Ce script sert à
-- l'application manuelle (psql) sur une base existante.
--
-- Usage :
--   psql "$DATABASE_URL" -f database/migrations/002_add_user_theme.sql
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS theme VARCHAR(50) NOT NULL DEFAULT 'dark';
