const express = require('express');
const { status, lookupBarcode } = require('../controllers/discogsController');
const { authenticate } = require('../middlewares/auth');

const router = express.Router();

router.use(authenticate);

router.get('/status', status);
router.get('/barcode/:code(\\d{8,14})', lookupBarcode);

module.exports = router;
