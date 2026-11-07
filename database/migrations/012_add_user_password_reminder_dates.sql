-- ============================================================
-- Migration 012 : rappel de sécurité semestriel (comptes SANS 2FA)
-- Ajoute deux colonnes de suivi sur `users`, utilisées par le service
-- backend/src/utils/passwordReminderService.js :
--   password_changed_at       — date de DERNIÈRE MODIFICATION du mot de
--                               passe (ou de la 1re connexion / onboarding).
--                               Un compte dont le mot de passe a plus de
--                               6 mois est éligible au rappel. NULL = jamais
--                               renseignée : le service retombe sur created_at.
--   last_password_reminder_at — date du DERNIER e-mail de rappel envoyé.
--                               Garantit qu'aucun utilisateur ne reçoit plus
--                               d'un rappel par période de 6 mois.
-- Idempotente (IF NOT EXISTS) : sans effet si déjà appliquée.
-- NB : cette même migration est également appliquée automatiquement au
-- démarrage de l'API (backend/src/config/db.js, tableau MIGRATIONS :
-- « users.password-reminder-dates »). Ce script sert à l'application
-- manuelle (psql) sur une base existante.
--
-- Usage :
--   psql "$DATABASE_URL" -f database/migrations/012_add_user_password_reminder_dates.sql
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_password_reminder_at TIMESTAMPTZ;
