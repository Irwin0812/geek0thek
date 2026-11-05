const express = require('express');
const {
  listUsers,
  listAllUsers,
  listPublicUsers,
  getMe,
  createUser,
  updateUser,
  updateMe,
  updateProfileLanguage,
  updateProfileTheme,
  deleteUser,
  listLibraryShares,
  createLibraryShare,
  deleteLibraryShare,
  setupTotp,
  enableTotp,
  disableTotp,
} = require('../controllers/userController');
const { authenticate, requireAdmin, requirePasswordChanged } = require('../middlewares/auth');
const { uploadAvatar } = require('../middlewares/upload');

const router = express.Router();

// Lecture sans authentification : utilisateurs à collection publique
router.get('/public', listPublicUsers);

router.use(authenticate);
// Sécurité à la première connexion : tout compte dont le drapeau
// must_change_password est encore TRUE doit passer par
// POST /api/auth/onboarding avant d'accéder au reste de l'API.
router.use(requirePasswordChanged);

router.get('/me', getMe);
// Membres de l'application (tout utilisateur authentifié, pas besoin d'être
// admin) : liste les comptes actifs avec leurs compteurs de collection.
// Déclaré AVANT toute route paramétrée /:id — alimente la page
// « Bibliothèques partagées » (choix des destinataires des partages).
router.get('/all', listAllUsers);
// Langue préférée : endpoint dédié (body JSON : { "language": "fr" | "en" }).
// Doit être déclaré AVANT toute route paramétrée du style /:id.
router.patch('/profile/language', updateProfileLanguage);
// Thème visuel préféré : endpoint dédié (body JSON : { "theme": "dark" | "library" | "vinyl" | ... }).
// Doit être déclaré AVANT toute route paramétrée du style /:id.
router.patch('/profile/theme', updateProfileTheme);
// Multipart : champ "avatar" facultatif (image de profil) — le corps
// JSON reste accepté tel quel (multer passe les requêtes sans fichier).
router.put('/me', uploadAvatar.single('avatar'), updateMe);

// ------------------------------------------------------------
// PARTAGE DE BIBLIOTHÈQUE (accès en consultation) — déclaré AVANT toute
// route paramétrée /:id. POST déclenche la notification e-mail au
// destinataire (cf. controllers/userController.js -> createLibraryShare).
// ------------------------------------------------------------
router.get('/library-shares', listLibraryShares);
router.post('/library-shares', createLibraryShare);
router.delete('/library-shares/:id', deleteLibraryShare);

// ------------------------------------------------------------
// 2FA (Google Authenticator / TOTP) — optionnelle, gérée depuis la page
// profil. Déclaré AVANT toute route paramétrée /:id.
//   setup   : génère la clé secrète + URI otpauth:// (QR code)
//   enable  : active la 2FA après confirmation d'un code valide
//   disable : désactive la 2FA et efface la clé
// ------------------------------------------------------------
router.post('/totp/setup', setupTotp);
router.post('/totp/enable', enableTotp);
router.post('/totp/disable', disableTotp);

router.get('/', requireAdmin, listUsers);
router.post('/', requireAdmin, uploadAvatar.single('avatar'), createUser);
router.put('/:id', requireAdmin, uploadAvatar.single('avatar'), updateUser);
router.delete('/:id', requireAdmin, deleteUser);

module.exports = router;
