const express = require('express');
const {
  listUsers,
  listPublicUsers,
  getMe,
  createUser,
  updateUser,
  updateMe,
  updateProfileLanguage,
  updateProfileTheme,
  deleteUser,
} = require('../controllers/userController');
const { authenticate, requireAdmin } = require('../middlewares/auth');
const { uploadAvatar } = require('../middlewares/upload');

const router = express.Router();

// Lecture sans authentification : utilisateurs à collection publique
router.get('/public', listPublicUsers);

router.use(authenticate);

router.get('/me', getMe);
// Langue préférée : endpoint dédié (body JSON : { "language": "fr" | "en" }).
// Doit être déclaré AVANT toute route paramétrée du style /:id.
router.patch('/profile/language', updateProfileLanguage);
// Thème visuel préféré : endpoint dédié (body JSON : { "theme": "dark" | "library" | "vinyl" | ... }).
// Doit être déclaré AVANT toute route paramétrée du style /:id.
router.patch('/profile/theme', updateProfileTheme);
// Multipart : champ "avatar" facultatif (image de profil) — le corps
// JSON reste accepté tel quel (multer passe les requêtes sans fichier).
router.put('/me', uploadAvatar.single('avatar'), updateMe);

router.get('/', requireAdmin, listUsers);
router.post('/', requireAdmin, uploadAvatar.single('avatar'), createUser);
router.put('/:id', requireAdmin, uploadAvatar.single('avatar'), updateUser);
router.delete('/:id', requireAdmin, deleteUser);

module.exports = router;
