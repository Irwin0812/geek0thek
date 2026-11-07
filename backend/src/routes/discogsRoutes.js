/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
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
