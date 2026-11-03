const express = require('express');
const {
  listMyComics,
  listComicsByUser,
  listPublicComicsByUser,
  getComic,
  createComic,
  updateComic,
  deleteComic,
  importComicByIsbn,
} = require('../controllers/comicController');
const { authenticate, requirePasswordChanged } = require('../middlewares/auth');
const { upload } = require('../middlewares/upload');

const router = express.Router();

// Lecture des BD d'une collection publique (sans authentification,
// la visibilité est vérifiée dans le contrôleur via users.is_public)
router.get('/public/user/:userId', listPublicComicsByUser);

router.use(authenticate);
// Sécurité à la première connexion : onboarding obligatoire avant l'API.
router.use(requirePasswordChanged);

router.get('/', listMyComics);
router.get('/user/:userId', listComicsByUser);
// IMPORT PAR CODE-BARRES (ISBN) : Google Books d'abord (clé GOOGLE_BOOKS_API_KEY,
// sans clé -> quotas publics), Open Library en secours ; la BD créée est
// ASSOCIÉE À SA SÉRIE (image auto du nom de série OU repli propre img/no_title.jpg).
// ⚠ DÉCLARÉE AVANT « /:id » : sinon « import » serait capté par le paramètre.
router.post(
  '/import/isbn/:isbn',
  upload.fields([{ name: 'seriesImage', maxCount: 1 }]),
  importComicByIsbn
);
// Couverture d'album en multipart (champ "cover") ou URL distante ; image /
// logo de SÉRIE : upload manuel (champ "seriesImage", stocké dans
// <uploads>/series/ et associé à l'ENTITÉ SÉRIE), sinon recherche automatique
// Open Library / Google Books, repli propre img/no_title.jpg.
router.post(
  '/',
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'seriesImage', maxCount: 1 }]),
  createComic
);
router.get('/:id', getComic);
router.put(
  '/:id',
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'seriesImage', maxCount: 1 }]),
  updateComic
);
// Le contrôleur autorise aussi un admin à supprimer la BD d'un autre utilisateur
router.delete('/:id', deleteComic);

module.exports = router;
