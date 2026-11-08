-- ============================================================
-- Migration 013 : statut de donateur (soutien au projet)
-- Ajoute la colonne `users.is_donor` : TRUE dès qu'un don PayPal
-- (paypal.me/geek0thek) est enregistré / validé pour le compte
-- (POST /api/users/donation). Déclenche l'e-mail de MERCI
-- personnalisé (cf. backend/src/utils/emailService.js ->
-- notifyDonationThankYou). NOT NULL DEFAULT FALSE : les comptes
-- existants ne sont JAMAIS affectés.
-- Idempotente (IF NOT EXISTS) : sans effet si déjà appliquée.
-- NB : cette même migration est également appliquée automatiquement au
-- démarrage de l'API (backend/src/config/db.js, tableau MIGRATIONS :
-- « users.is-donor »). Ce script sert à l'application manuelle (psql)
-- sur une base existante.
--
-- Usage :
--   psql "$DATABASE_URL" -f database/migrations/013_add_user_is_donor.sql
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_donor BOOLEAN NOT NULL DEFAULT FALSE;
