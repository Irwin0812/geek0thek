/*
 * Copyright (C) 2026 Irwin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
// ============================================================
// RAPPEL DE SÉCURITÉ SEMESTRIEL (comptes SANS 2FA) — Geek0thek
// ------------------------------------------------------------
// Mécanisme de suivi + tâche planifiée : toutes les 6 MOIS, un e-mail
// d'INFORMATION est envoyé à chaque utilisateur ACTIF qui n'a PAS activé
// l'authentification à deux facteurs (2FA), pour l'inviter / inciter à
// changer son mot de passe.
//
// RÈGLE NON BLOQUANTE : il s'agit d'une simple demande informative par
// e-mail. Elle ne bloque JAMAIS l'accès à l'application, ne modifie jamais
// le mot de passe ni le drapeau must_change_password — seul le champ
// users.last_password_reminder_at est mis à jour (pour éviter les doublons).
//
// ANCRAGE DES DATES (cf. migration « users.password-reminder-dates ») :
//   - users.password_changed_at      : date de DERNIÈRE MODIFICATION du mot
//     de passe (ou de la 1re connexion / onboarding). Un compte dont le mot
//     de passe a plus de 6 mois est éligible au rappel.
//   - users.last_password_reminder_at : date du DERNIER e-mail de rappel
//     envoyé. Garantit qu'aucun utilisateur ne reçoit plus d'un rappel par
//     période de 6 mois, même si la vérification tourne quotidiennement.
//
// PLANIFICATEUR : aucune dépendance externe (pas de node-cron). Un
// setInterval natif lance la vérification une fois après un court délai au
// démarrage, puis toutes les 24 h. Le conteneur étant redémarré
// régulièrement, l'ancre last_password_reminder_at rend le mécanisme
// idempotent : un redémarrage ne provoque jamais de rappel en double.
// ============================================================

const { query } = require('../config/db');
const emailService = require('./emailService');

// Fréquence de la VÉRIFICATION (quotidienne) : le rappel n'est réellement
// envoyé que si l'utilisateur est « échu » (voir requête ci-dessous).
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 h
// Délai avant le PREMIER passage après le démarrage : laisse le boot se
// stabiliser (migrations, pool) avant de lancer la première vérification.
const INITIAL_DELAY_MS = 30 * 1000; // 30 s

let timer = null;
let running = false;

/**
 * Exécute le rappel semestriel.
 * Sélectionne les comptes ACTIFS, SANS 2FA, dont le mot de passe a plus de
 * 6 mois (password_changed_at / created_at) ET qui n'ont pas reçu de rappel
 * depuis plus de 6 mois (last_password_reminder_at). Envoie un e-mail
 * d'information à chacun et met à jour last_password_reminder_at UNIQUEMENT
 * si l'e-mail a bien été envoyé (SMTP opérationnel).
 * @returns {Promise<object>} résumé de l'exécution.
 */
async function runPasswordReminderJob() {
  if (running) return { skipped: 'already-running' };
  running = true;
  try {
    // SMTP non configuré : on n'envoie RIEN et on ne marque RIEN — les
    // rappels seront envoyés dès que le SMTP sera opérationnel (le champ
    // last_password_reminder_at reste NULL, donc l'utilisateur restera échu).
    if (!emailService.isConfigured()) {
      console.log('[rappel-mdp] SMTP non configuré : rappel semestriel ignoré.');
      return { sent: 0, skipped: 'smtp-not-configured' };
    }

    const { rows } = await query(
      `SELECT id, email, first_name, login
       FROM users
       WHERE is_active = TRUE
         AND totp_enabled = FALSE
         AND COALESCE(password_changed_at, created_at) <= now() - INTERVAL '6 months'
         AND (last_password_reminder_at IS NULL
              OR last_password_reminder_at <= now() - INTERVAL '6 months')`
    );

    if (rows.length === 0) {
      console.log('[rappel-mdp] aucun compte à rappeler.');
      return { sent: 0, total: 0 };
    }

    let sent = 0;
    for (const user of rows) {
      const result = await emailService.notifyPasswordReminder({
        to: user.email,
        firstName: user.first_name,
        login: user.login,
      });
      // On ne marque le rappel que si l'e-mail a réellement été envoyé :
      // sinon l'utilisateur resterait « échu » et recevrait le rappel dès
      // que le SMTP redeviendrait opérationnel.
      if (result && result.sent) {
        await query('UPDATE users SET last_password_reminder_at = now() WHERE id = $1', [user.id]);
        sent++;
      }
    }
    console.log(`[rappel-mdp] ${sent}/${rows.length} rappel(s) semestriel(s) envoyé(s).`);
    return { sent, total: rows.length };
  } catch (err) {
    // Jamais propagé : un échec du rappel ne doit jamais impacter le serveur.
    console.error('[rappel-mdp] échec du rappel semestriel :', err.message);
    return { error: err.message };
  } finally {
    running = false;
  }
}

/**
 * Démarre le planificateur (idempotent — une seule instance). Premier passage
 * après INITIAL_DELAY_MS, puis toutes les CHECK_INTERVAL_MS.
 */
function startPasswordReminderScheduler() {
  if (timer) return; // déjà démarré : on ne double pas le timer
  console.log('[rappel-mdp] planificateur semestriel démarré (vérification quotidienne).');
  const tick = () => {
    runPasswordReminderJob();
  };
  setTimeout(tick, INITIAL_DELAY_MS);
  timer = setInterval(tick, CHECK_INTERVAL_MS);
}

module.exports = { runPasswordReminderJob, startPasswordReminderScheduler };
