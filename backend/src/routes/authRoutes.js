const express = require('express');
const { login, me, onboarding, verifyTotpCode, forgotPassword, resetPassword } = require('../controllers/authController');
const { authenticate, requirePasswordChanged } = require('../middlewares/auth');

const router = express.Router();

router.post('/login', login);
// 2FA (Google Authenticator / TOTP) : deuxième étape de la connexion —
// body { tempToken, code } (tempToken renvoyé par /login quand le compte a
// la 2FA activée). Sans authentification préalable (c'est l'étape qui
// délivre le JWT de session).
router.post('/verify-totp', verifyTotpCode);
// Réinitialisation du mot de passe (« identifiant / mot de passe oublié ») :
// sans authentification. forgot-password renvoie TOUJOURS une réponse
// générique (aucune énumération d'utilisateurs) ; reset-password consomme
// le jeton à usage unique contenu dans le lien de l'e-mail.
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
// Sécurité à la première connexion : DOIT être déclaré AVANT le garde
// requirePasswordChanged (le seul chemin autorisé pour un compte dont le
// drapeau must_change_password est encore TRUE).
router.post('/onboarding', authenticate, onboarding);
router.get('/me', authenticate, me);

module.exports = router;
