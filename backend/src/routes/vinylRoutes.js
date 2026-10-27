const express = require('express');
const {
  listMyVinyls,
  listVinylsByUser,
  listPublicVinyls,
  getVinyl,
  createVinyl,
  updateVinyl,
  deleteVinyl,
} = require('../controllers/vinylController');
const { authenticate } = require('../middlewares/auth');
const { upload } = require('../middlewares/upload');

const router = express.Router();

// Lecture des collections publiées (lecture seule, sans authentification)
router.get('/public', listPublicVinyls);

router.use(authenticate);

router.get('/', listMyVinyls);
router.get('/user/:userId', listVinylsByUser);
// POST/PUT : DEUX champs fichiers possibles — jaquette d'album (champ
// "cover", 1 fichier, dans <upload>/vinyls) + photo/logo d'ARTISTE (champ
// "artistImage", 0 ou 1 fichier, dans <upload>/artists ; cf. middlewares/
// upload.js, destination pilotée par le nom du champ). upload.fields() les
// reçoit tous deux dans req.files, champ par champ (fieldname) : le
// contrôleur lit "cover" pour la jaquette et "artistImage" pour l'entité
// Artiste. À défaut d'image manuelle, l'API télécharge automatiquement une
// photo de l'artiste — CASCADE : 1. Last.fm (artist.search / artist.getInfo),
// repli 2. Discogs (recherche d'artiste) ou MusicBrainz + Cover Art Archive,
// enfin repli propre sur img/no_group.jpg.
router.post(
  '/',
  upload.fields([
    { name: 'cover', maxCount: 1 },
    { name: 'artistImage', maxCount: 1 },
  ]),
  createVinyl
);
router.get('/:id', getVinyl);
router.put(
  '/:id',
  upload.fields([
    { name: 'cover', maxCount: 1 },
    { name: 'artistImage', maxCount: 1 },
  ]),
  updateVinyl
);
router.delete('/:id', deleteVinyl);

module.exports = router;
