/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
const express = require('express');
const { lookupIsbn, searchBooks } = require('../controllers/isbnController');
const { authenticate, requirePasswordChanged } = require('../middlewares/auth');

const router = express.Router();

// Sécurité à la première connexion : onboarding obligatoire avant l'API.
router.use(authenticate, requirePasswordChanged);

router.get('/lookup/:isbn', lookupIsbn);
// Recherche TEXTUELLE par mots-clés (titre / auteur / série) via Google Books
// « q=... » — secours du flux ISBN quand l'ISBN / code-barres échoue.
// Renvoie { success: true, data: [ ...fiches normalisées ] } (200 + [] si vide).
router.get('/search', searchBooks);

module.exports = router;
