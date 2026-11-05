// ============================================================
// Service d'envoi d'e-mails (Nodemailer) — Geek0thek
// ------------------------------------------------------------
// La configuration SMTP est lue EXCLUSIVEMENT depuis les variables
// d'environnement du fichier .env (cf. config/env.js -> env.smtp) :
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
// Chaque utilisateur de l'application peut ainsi configurer son propre
// serveur SMTP en remplissant son .env local — aucun code à modifier.
//
// RÈGLE DE ROBUSTESSE : si les variables SMTP ne sont pas renseignées,
// l'envoi d'e-mails est DÉSACTIVÉ PROPREMENT (aucun e-mail n'est tenté,
// aucun crash) et un avertissement est journalisé en console. Les
// déclencheurs métier (création de compte, partage de bibliothèque)
// appellent ce service de façon NON BLOQUANTE : un échec d'envoi ne doit
// JAMAIS faire échouer l'action qui l'a déclenché.
// ============================================================

const nodemailer = require('nodemailer');
const env = require('../config/env');

/**
 * L'e-mail est-il configuré ? Il faut au minimum un hôte, un utilisateur
 * et un mot de passe SMTP. (SMTP_FROM est optionnel : on retombe sur
 * l'adresse SMTP_USER.)
 */
function isConfigured() {
  return Boolean(env.smtp.host && env.smtp.user && env.smtp.pass);
}

// Transporteur créé une seule fois (lazy) — seulement si configuré.
let transporter = null;
function getTransporter() {
  if (!isConfigured()) return null;
  if (!transporter) {
    // Port 465 = TLS implicite (secure: true). Tout autre port (ex. 587)
    // utilise STARTTLS (secure: false). Surcharge possible via SMTP_SECURE.
    const secure = env.smtp.secure !== null ? env.smtp.secure : env.smtp.port === 465;
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure,
      auth: { user: env.smtp.user, pass: env.smtp.pass },
      // Enveloppe d'expéditeur : « Nom <adresse> » (SMTP_FROM) ou repli SMTP_USER.
      from: env.smtp.from || env.smtp.user,
    });
  }
  return transporter;
}

// Avertissement de démarrage : affiché UNE SEULE FOIS au chargement du module
// (celui-ci est requis par les contrôleurs dès le boot de l'API).
if (!isConfigured()) {
  console.warn(
    '[email] SMTP non configuré (SMTP_HOST / SMTP_USER / SMTP_PASS absents du .env) : ' +
      "l'envoi d'e-mails est DÉSACTIVÉ. Renseignez ces variables pour activer les notifications."
  );
}

/**
 * Envoie un e-mail de façon NON BLOQUANTE.
 * @param {object} opts
 * @param {string} opts.to      adresse destinataire
 * @param {string} opts.subject objet
 * @param {string} [opts.html]  corps HTML
 * @param {string} [opts.text]  corps texte (repli)
 * @returns {Promise<{sent: boolean, reason?: string}>} — ne lève JAMAIS d'erreur.
 */
async function sendMail({ to, subject, html, text }) {
  if (!isConfigured()) {
    console.warn(`[email] SMTP non configuré — e-mail NON envoyé (destinataire : ${to}).`);
    return { sent: false, reason: 'smtp-not-configured' };
  }
  const t = getTransporter();
  try {
    await t.sendMail({ from: env.smtp.from || env.smtp.user, to, subject, html, text });
    console.log(`[email] e-mail envoyé à ${to} (« ${subject} »).`);
    return { sent: true };
  } catch (err) {
    // Échec d'envoi (réseau, authentification, adresse invalide…) : journalisé,
    // jamais propagé — l'action déclenchante doit rester réussie.
    console.error(`[email] ÉCHEC de l'envoi vers ${to} :`, err.message);
    return { sent: false, reason: err.message };
  }
}

// ------------------------------------------------------------
// Gabarit HTML minimal (en-tête + corps + pied) — cohérent avec le ton
// de l'application (français). Aucune dépendance externe.
// ------------------------------------------------------------
function layout(title, bodyHtml) {
  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#0f172a;font-family:Arial,Helvetica,sans-serif;color:#e2e8f0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0"
               style="max-width:560px;width:100%;background:#1e293b;border-radius:12px;overflow:hidden;">
          <tr><td style="background:#334155;padding:18px 24px;">
            <span style="font-size:18px;font-weight:bold;color:#f8fafc;">Geek0thek</span>
          </td></tr>
          <tr><td style="padding:24px;">
            <h1 style="margin:0 0 16px;font-size:20px;color:#f8fafc;">${title}</h1>
            ${bodyHtml}
          </td></tr>
          <tr><td style="background:#0b1220;padding:14px 24px;font-size:12px;color:#94a3b8;">
            Ce message a été envoyé automatiquement par Geek0thek.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Lien cliquable vers l'application (origine du frontend, cf. env.appUrl). */
function appLink(label, url) {
  return `<a href="${escapeHtml(url || env.appUrl)}" style="color:#38bdf8;text-decoration:none;font-weight:bold;">${escapeHtml(label)}</a>`;
}

/** Origine du frontend sans barre oblique finale (pour composer des chemins). */
function appBaseUrl() {
  return String(env.appUrl || '').replace(/\/+$/, '');
}

// ------------------------------------------------------------
// Déclencheur n°1 — Création de compte par un administrateur.
// Envoie au NOUVEL UTILISATEUR la confirmation de la création de son
// compte avec ses accès (identifiant + mot de passe provisoire).
// ------------------------------------------------------------
/**
 * @param {object} p
 * @param {string} p.to         adresse e-mail du nouvel utilisateur
 * @param {string} [p.firstName]
 * @param {string} [p.lastName]
 * @param {string} p.login      identifiant de connexion
 * @param {string} p.password   mot de passe provisoire (de première installation)
 */
function notifyAccountCreated({ to, firstName, lastName, login, password }) {
  const prenom = escapeHtml(firstName || '');
  const nom = escapeHtml(lastName || '');
  const salutation = prenom ? `Bonjour ${prenom} ${nom}`.trim() : 'Bonjour';
  const body = `
    <p>${salutation},</p>
    <p>Votre compte sur <strong>Geek0thek</strong> a été créé avec succès. Voici vos accès :</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px 0;">
      <tr>
        <td style="padding:8px 12px;background:#0f172a;border-radius:6px;font-weight:bold;color:#94a3b8;">Identifiant</td>
        <td style="padding:8px 12px;background:#0f172a;border-radius:6px;font-size:16px;color:#f8fafc;">${escapeHtml(login)}</td>
      </tr>
      <tr><td height="8"></td></tr>
      <tr>
        <td style="padding:8px 12px;background:#0f172a;border-radius:6px;font-weight:bold;color:#94a3b8;">Mot de passe</td>
        <td style="padding:8px 12px;background:#0f172a;border-radius:6px;font-size:16px;color:#f8fafc;">${escapeHtml(password)}</td>
      </tr>
    </table>
    <p>Connectez-vous sur ${appLink('Geek0thek')} avec ces identifiants.</p>
    <p style="color:#94a3b8;font-size:13px;">Pour des raisons de sécurité, vous serez invité à changer ce mot de passe dès votre première connexion.</p>`;
  return sendMail({
    to,
    subject: 'Votre compte Geek0thek a été créé',
    html: layout('Bienvenue sur Geek0thek', body),
    text:
      `${salutation},\n\n` +
      `Votre compte Geek0thek a été créé. Vos accès :\n` +
      `  Identifiant : ${login}\n` +
      `  Mot de passe : ${password}\n\n` +
      `Connectez-vous sur ${env.appUrl}. Vous serez invité à changer ce mot de passe dès votre première connexion.\n`,
  });
}

// ------------------------------------------------------------
// Déclencheur n°2 — Partage de bibliothèque (accès en consultation).
// Envoie au DESTINATAIRE la notification qu'un autre utilisateur lui a
// ouvert l'accès en consultation à sa collection.
// ------------------------------------------------------------
/**
 * @param {object} p
 * @param {string} p.to              adresse e-mail du destinataire
 * @param {string} [p.recipientName] nom du destinataire (pour la salutation)
 * @param {string} p.ownerName       nom du propriétaire qui ouvre l'accès
 * @param {number} p.ownerId         id du propriétaire de la collection partagée
 * @param {string} p.scope           « disques » | « BD » | « disques et BD »
 */
function notifyLibraryShared({ to, recipientName, ownerName, ownerId, scope }) {
  const prenom = escapeHtml(recipientName || '');
  const salutation = prenom ? `Bonjour ${prenom}` : 'Bonjour';
  // SÉCURITÉ — ISOLATION DES SESSIONS : le lien envoyé au DESTINATAIRE est une
  // URL GÉNÉRIQUE de la collection partagée (chemin /shared/:ownerUserId). Il
  // ne contient AUCUN jeton de session, mot de passe ou identifiant de
  // connexion de l'émetteur : le destinataire doit s'identifier avec SES
  // PROPRES identifiants (page /login) pour accéder à la vue partagée, où il
  // reste sous SA PROPRE identité (lecture seule).
  const sharedUrl = `${appBaseUrl()}/shared/${Number(ownerId) || ''}`;
  const body = `
    <p>${salutation},</p>
    <p><strong>${escapeHtml(ownerName)}</strong> vous a ouvert l'accès en consultation à sa collection de <strong>${escapeHtml(scope)}</strong>.</p>
    <p>Vous pouvez désormais consulter cette bibliothèque sur ${appLink('Geek0thek', sharedUrl)}.</p>`;
  return sendMail({
    to,
    subject: `Accès en consultation à la bibliothèque de ${ownerName}`,
    html: layout('Nouvel accès en consultation', body),
    text:
      `${salutation},\n\n` +
      `${ownerName} vous a ouvert l'accès en consultation à sa collection de ${scope}.\n` +
      `Vous pouvez désormais consulter cette bibliothèque sur ${sharedUrl}.\n`,
  });
}

// ------------------------------------------------------------
// Déclencheur n°3 — Réinitialisation du mot de passe (« identifiant /
// mot de passe oublié »). Envoie au PROPRIÉTAIRE DU COMPTE :
//   - son IDENTIFIANT (login) — utile s'il a oublié lequel des deux il
//     avait saisi dans le formulaire ;
//   - un LIEN DE RÉINITIALISATION TEMPORAIRE (jeton à usage unique,
//     validité 1 h) : ${APP_URL}/reset-password/<jeton>.
// SÉCURITÉ : le lien contient UNIQUEMENT le jeton aléatoire (48 octets) —
// jamais d'identifiant de connexion ni de mot de passe. Seul le HACHAGE
// SHA-256 du jeton est stocké en base (table password_resets).
// ------------------------------------------------------------
/**
 * @param {object} p
 * @param {string} p.to         adresse e-mail du propriétaire du compte
 * @param {string} [p.firstName]
 * @param {string} p.login      identifiant de connexion du compte
 * @param {string} p.resetUrl   lien complet de réinitialisation (jeton inclus)
 */
function notifyPasswordReset({ to, firstName, login, resetUrl }) {
  const prenom = escapeHtml(firstName || '');
  const salutation = prenom ? `Bonjour ${prenom}` : 'Bonjour';
  const body = `
    <p>${salutation},</p>
    <p>Nous avons bien reçu votre demande de réinitialisation du mot de passe sur <strong>Geek0thek</strong>.</p>
    <p>Votre identifiant de connexion est : <strong>${escapeHtml(login)}</strong></p>
    <p>Pour définir un nouveau mot de passe, cliquez sur le lien ci-dessous (valable <strong>1 heure</strong>, à usage unique) :</p>
    <p style="margin:20px 0;">
      <a href="${escapeHtml(resetUrl)}"
         style="display:inline-block;background:#38bdf8;color:#0f172a;font-weight:bold;text-decoration:none;padding:10px 18px;border-radius:8px;">
        Réinitialiser mon mot de passe
      </a>
    </p>
    <p style="color:#94a3b8;font-size:13px;">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste inchangé.</p>`;
  return sendMail({
    to,
    subject: 'Réinitialisation de votre mot de passe Geek0thek',
    html: layout('Réinitialisation du mot de passe', body),
    text:
      `${salutation},\n\n` +
      `Nous avons bien reçu votre demande de réinitialisation du mot de passe sur Geek0thek.\n` +
      `Votre identifiant de connexion est : ${login}\n\n` +
      `Pour définir un nouveau mot de passe, cliquez sur le lien ci-dessous (valable 1 heure, à usage unique) :\n` +
      `${resetUrl}\n\n` +
      `Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe actuel reste inchangé.\n`,
  });
}

module.exports = {
  isConfigured,
  sendMail,
  notifyAccountCreated,
  notifyLibraryShared,
  notifyPasswordReset,
};
