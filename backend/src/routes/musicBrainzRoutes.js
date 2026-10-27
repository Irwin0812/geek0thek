const express = require('express');
const { status, lookupBarcode, searchRelease } = require('../controllers/musicBrainzController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.use(authenticate);

router.get('/status', status);
// Import par code-barres (EAN/UPC) — MusicBrainz + Last.fm + Discogs combinés.
router.get('/barcode/:code(\\d{8,14})', lookupBarcode);
// Import par SAISIE artiste + titre (complément du scan EAN) : mêmes trois
// sources en cascade / repli mutuel ?artist=<nom>&title=<album>.
router.get('/search', searchRelease);

module.exports = router;
