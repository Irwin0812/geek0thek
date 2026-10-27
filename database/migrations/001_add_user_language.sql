-- ============================================================
-- Migration 001 : langue préférée des utilisateurs
-- Ajoute la colonne `users.language` (VARCHAR(5), défaut 'fr').
-- Idempotent (IF NOT EXISTS) : sans effet si déjà appliquée.
-- NB : cette même migration est également appliquée
-- automatiquement au démarrage de l'API (backend/src/config/db.js,
-- tableau MIGRATIONS : « users.language »). Ce script sert à
-- l'application manuelle (psql) sur une base existante.
--
-- Usage :
--   psql "$DATABASE_URL" -f database/migrations/001_add_user_language.sql
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS language VARCHAR(5) NOT NULL DEFAULT 'fr';
