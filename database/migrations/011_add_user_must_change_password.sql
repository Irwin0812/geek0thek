-- ============================================================
-- Migration 011 : sécurité à la première connexion (onboarding)
-- Ajoute la colonne `users.must_change_password` (BOOLEAN, défaut
-- FALSE) : TRUE tant que le compte n'a pas encore changé ses
-- identifiants de première installation. Le backend force alors
-- l'onboarding (POST /api/auth/onboarding) : nouveau mot de passe
-- OBLIGATOIRE + pseudo de login personnalisable ; le drapeau est
-- remis à FALSE une fois validé.
-- Idempotente (IF NOT EXISTS) : sans effet si déjà appliquée.
-- NB : cette même migration est également appliquée
-- automatiquement au démarrage de l'API (backend/src/config/db.js,
-- tableau MIGRATIONS : « users.must-change-password »). Ce script
-- sert à l'application manuelle (psql) sur une base existante.
--
-- Usage :
--   psql "$DATABASE_URL" -f database/migrations/011_add_user_must_change_password.sql
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
