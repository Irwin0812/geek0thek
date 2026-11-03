const express = require('express');
const { status, lookupBarcode } = require('../controllers/discogsController');
const { authenticate, requirePasswordChanged } = require('../middlewares/auth');

const router = express.Router();

router.use(authenticate);
// Sécurité à la première connexion : onboarding obligatoire avant l'API.
router.use(requirePasswordChanged);

router.get('/status', status);
router.get('/barcode/:code(\\d{8,14})', lookupBarcode);

module.exports = router;
