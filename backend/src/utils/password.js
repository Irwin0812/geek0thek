// ------------------------------------------------------------
// Validation du mot de passe (partagée par tous les points d'entrée :
// onboarding, changement de mot de passe « /me », création et
// réinitialisation de compte par un admin).
//
// RÈGLE ASSOUPLIE : le mot de passe n'est soumis qu'à une longueur
// minimale. TOUS les caractères sont autorisés — lettres (y compris
// accentuées : é, è, à…), chiffres, tirets, underscores et l'ensemble
// des caractères spéciaux (# @ & ! $ * ? % ^ + = / \ | < > ; : " ' , .
// etc.). Il n'y a AUCUNE whitelist de caractères ni règle de complexité.
// ------------------------------------------------------------

const PASSWORD_MIN = 8;

/**
 * Valide un mot de passe selon la règle assouplie (longueur minimale,
 * tous les caractères autorisés).
 * @param {string} password le mot de passe à valider.
 * @returns {string|null} null si valide, sinon un message d'erreur clair
 *   portant EXPLICITEMENT sur le mot de passe (jamais « identifiant »).
 */
function validatePassword(password) {
  if (password === undefined || password === null || String(password).length < PASSWORD_MIN) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN} caractères. Tous les caractères sont autorisés (lettres, chiffres, accents et symboles).`;
  }
  return null;
}

module.exports = { PASSWORD_MIN, validatePassword };
