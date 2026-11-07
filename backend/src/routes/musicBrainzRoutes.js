/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
const express = require('express');
const { status, lookupBarcode, searchRelease, searchKeyword } = require('../controllers/musicBrainzController');
const { authenticate, requirePasswordChanged } = require('../middlewares/auth');

const router = express.Router();

router.use(authenticate);
// Sécurité à la première connexion : onboarding obligatoire avant l'API.
router.use(requirePasswordChanged);

router.get('/status', status);
// Import par code-barres (EAN/UPC) — MusicBrainz + Last.fm + Discogs combinés.
router.get('/barcode/:code(\\d{8,14})', lookupBarcode);
// Import par SAISIE artiste + titre (complément du scan EAN) : mêmes trois
// sources en cascade / repli mutuel ?artist=<nom>&title=<album>.
router.get('/search', searchRelease);
// Import par MOTS-CLÉS (EAN/UPC ou « artiste titre ») : CASCADE STRICTE dans
// l'ordre 1. Last.fm (prioritaire, jaquettes/visuels) -> 2. Discogs ->
// 3. MusicBrainz — chacun n'est interrogé que si le précédent n'a rien trouvé.
// Mêmes conventions que /api/isbn/search (BD) : ?q=<chaîne libre> (encodée en
// UTF-8 par le client) ; le contrôleur nettoie + borne la saisie (≤ 300 car.).
router.get('/keyword', searchKeyword);

module.exports = router;
