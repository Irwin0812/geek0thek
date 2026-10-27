const express = require('express');
const { getDashboard } = require('../controllers/dashboardController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

// Agrégat du tableau de bord — « Dernier ajout » GLOBAL (tous médias
// confondus) + compteurs par bibliothèque. Authentification obligatoire :
// le dashboard reflète la collection PERSONNELLE de l'utilisateur courant,
// et l'agrégation SQL part de ses deux tables (vinyls / comics).
router.use(authenticate);

// GET /api/dashboard — « Dernier ajout » unique + stats par bibliothèque.
router.get('/', getDashboard);

module.exports = router;
