const express = require('express');
const { login, me, onboarding } = require('../controllers/authController');
const { authenticate, requirePasswordChanged } = require('../middlewares/auth');

const router = express.Router();

router.post('/login', login);
// Sécurité à la première connexion : DOIT être déclaré AVANT le garde
// requirePasswordChanged (le seul chemin autorisé pour un compte dont le
// drapeau must_change_password est encore TRUE).
router.post('/onboarding', authenticate, onboarding);
router.get('/me', authenticate, me);

module.exports = router;
