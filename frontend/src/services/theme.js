/**
 * Service du thème visuel.
 *
 * Les 6 thèmes (fichiers « src/themes/*.css ») partagent le même index
 * de variables CSS : chaque palette redéfinit --bg-app, --text-primary,
 * --accent-strong… ; c'est donc le SEUL point de bascule lisible par le
 * DOM (attribut [data-theme] sur <html>) :
 *
 *   <html data-theme="dark">    →  src/themes/dark.css    (défaut de l'appli)
 *   <html data-theme="library"> →  src/themes/library.css (Médiathèque :
 *                                   photo bg-library.jpg sous voile clair)
 *   <html data-theme="vinyl">  →  src/themes/vinyl.css  (disquaire rétro)
 *   <html data-theme="comic">  →  src/themes/comic.css  (bande dessinée)
 *   <html data-theme="cartoon"> →  src/themes/cartoon.css (ludique et doux)
 *   <html data-theme="pastel"> →  src/themes/pastel.css  (couleurs pastel)
 *
 * Valeurs de clés possibles : identiques à l'enum du backend
 * (backend/src/controllers/userController.js, tableau THEMES) et à la
 * colonne `users.theme` (VARCHAR(50), défaut 'dark').
 */

export const DEFAULT_THEME = 'dark'
export const THEME_STORAGE_KEY = 'geek0thek_theme'

/**
 * Migration d'une clé de thème obsolète vers sa remplaçante :
 * le thème « Moderne » (« light », ex-« src/themes/light.css ») a été
 * renommé « Médiathèque » et sert maintenant « public/img/bg-library.jpg »
 * en fond semi-transparent. Les préférences stockées (localStorage,
 * BDD `users.theme`) continuent donc de s'appliquer sans réinitialisation.
 */
export const LEGACY_THEME_ALIASES = {
  light: 'library',
}

/** Liste ordonnée des thèmes : id + libellé (FR, neutre) + échantillons. */
export const THEMES = [
  { id: 'dark', label: 'Geek0thek', swatches: ['#080b13', '#121826', '#d4a24e'] },
  {
    id: 'library',
    label: 'Médiathèque',
    // Fond : photo bg-library.jpg en voile clair — échantillon = couleur
    // du voile (première teinte du fond perçue par l'œil).
    swatches: ['#ccd5e0', '#ffffff', '#92400e'],
  },
  { id: 'vinyl', label: 'Disquaire', swatches: ['#1a1108', '#2c1f13', '#d18a3e'] },
  { id: 'comic', label: 'Bande dessinée', swatches: ['#f2d94e', '#fffdf5', '#1d4ed8'] },
  { id: 'cartoon', label: 'Cartoon', swatches: ['#e7e2f8', '#ffffff', '#0f766e'] },
  { id: 'pastel', label: 'Pastel', swatches: ['#f7efe3', '#fffbf4', '#a4552e'] },
]

/**
 * Réécrit une clé de thème obsolète en sa remplaçante courante
 * (ex. « light » → « library », ex-Moderne → Médiathèque).
 */
export function normalizeThemeKey(theme) {
  const key = String(theme || '').toLowerCase()
  return LEGACY_THEME_ALIASES[key] || key
}

/**
 * Renvoie true si la clé vaut l'un des 6 thèmes connus (insensible à la
 * casse, l'ancien alias « light » restant accepté), sinon false (utilisé
 * pour valider `user.theme` lu du profil).
 */
export function isKnownTheme(theme) {
  return THEMES.some((th) => th.id === normalizeThemeKey(theme))
}

/**
 * Thème actuellement appliqué : lit l'attribut data-theme réellement posé
 * sur <html> (source de vérité UI) ; en l'absence d'attribut (premier
 * rendu), lit la préférence locale, sinon le thème sombre par défaut.
 */
export function getAppliedTheme() {
  if (typeof document !== 'undefined') {
    const attr = normalizeThemeKey(document.documentElement.getAttribute('data-theme'))
    if (attr && isKnownTheme(attr)) return attr
  }
  if (typeof localStorage !== 'undefined') {
    const saved = normalizeThemeKey(localStorage.getItem(THEME_STORAGE_KEY))
    if (saved && isKnownTheme(saved)) return saved
  }
  return DEFAULT_THEME
}

/**
 * Applique le thème : pose l'attribut data-theme sur <html> (les sélecteurs
 * [data-theme='…'] des 6 fichiers re-cassent alors la palette) et retient
 * la préférence dans localStorage — conservée lors de la déconnexion
 * (l'écran de connexion reste donc dans le look choisi) et au rechargement.
 * Un thème obsolète (« light », ex-« Moderne ») est résolu vers sa
 * remplaçante (ici « library ») qui est alors persistée.
 * Retourne le thème appliqué (minuscules).
 */
export function switchTheme(theme) {
  const key = normalizeThemeKey(theme || DEFAULT_THEME)
  const valid = isKnownTheme(key) ? key : DEFAULT_THEME
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', valid)
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(THEME_STORAGE_KEY, valid)
  }
  return valid
}

/**
 * Échantillons de palette (fond / carte / accent) pour l'aperçu du
 * sélecteur : valeurs fixes extraites de chaque fichier src/themes/*.css
 * (tableau THEMES ci-dessus, champ swatches) — impossibles à pré-voir via
 * variables CSS, car celles-ci reflètent toujours le thème appliqué.
 */
export function themeSwatches(theme) {
  const entry = THEMES.find((th) => th.id === theme) || THEMES[0]
  return entry.swatches
}
