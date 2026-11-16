/*
 * Copyright (C) 2026 Irwin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
const express = require('express');
const { authenticate, requirePasswordChanged } = require('../middlewares/auth');
const { exportJson, importJson, exportCsv, importCsv } = require('../controllers/exportImportController');

// ------------------------------------------------------------
// EXPORT / IMPORT de la collection de l'utilisateur connecté :
//   GET  /export/json            — sauvegarde complète (disques + BD + entités)
//   POST /import/json            — restauration fidèle (mode merge | replace)
//   GET  /export/csv?collection= — fichier CSV par bibliothèque (vinyls|comics)
//   POST /import/csv             — import de lignes CSV DÉJÀ MAPPÉES (frontend)
// Toutes les routes exigent un compte authentifié ET un mot de passe déjà
// changé (onboarding validé) — même garde que le reste de l'API applicative.
// ------------------------------------------------------------
const router = express.Router();

router.use(authenticate, requirePasswordChanged);

router.get('/export/json', exportJson);
router.post('/import/json', importJson);
router.get('/export/csv', exportCsv);
router.post('/import/csv', importCsv);

module.exports = router;
