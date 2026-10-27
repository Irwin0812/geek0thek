const { searchByBarcode, DiscogsError, isConfigured } = require('../utils/discogsClient');

/**
 * GET /api/discogs/status
 * Discogs exige un jeton personnel : le service n'est « configuré »
 * que si DISCOGS_TOKEN est renseigné (et validé une fois en 401).
 */
function status(req, res) {
  return res.json({
    configured: isConfigured(),
    provider: 'discogs',
  });
}

/**
 * GET /api/discogs/barcode/:code
 * Recherche par code-barres (EAN/UPC, 8 à 14 chiffres) sur Discogs
 * (GET /database/search) puis lecture de la fiche complète
 * (GET /releases/<id>) pour la tracklist, les labels détaillés et les
 * styles. Retourne un objet de pré-remplissage pour le formulaire de
 * création de disque : jaquette, artiste, titre, nombre de chansons +
 * tracklist COMPLÈTE (une piste par ligne, position réelle + titre + durée
 * si disponible, ex. « A1 : Blackened (6:42) », quel que soit le format de
 * notation du support), style/genre, label, date de sortie, code-barres +
 * identifiants Discogs (discogs_release_id + discogs_url).
 */
async function lookupBarcode(req, res, next) {
  try {
    const { code } = req.params;
    if (!code) {
      return res.status(400).json({ error: 'Le paramètre code-barres est requis.' });
    }

    const data = await searchByBarcode(code);
    return res.json({ success: true, data });
  } catch (err) {
    if (err instanceof DiscogsError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error('[discogs lookupBarcode]', err);
    return res.status(err.status || 502).json({ error: err.message });
  }
}

module.exports = { status, lookupBarcode };
