const express = require('express');
const { lookupIsbn, searchBooks } = require('../controllers/isbnController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.get('/lookup/:isbn', authenticate, lookupIsbn);
// Recherche TEXTUELLE par mots-clés (titre / auteur / série) via Google Books
// « q=... » — secours du flux ISBN quand l'ISBN / code-barres échoue.
// Renvoie { success: true, data: [ ...fiches normalisées ] } (200 + [] si vide).
router.get('/search', authenticate, searchBooks);

module.exports = router;
