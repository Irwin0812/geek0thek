const {
  searchByIsbn,
  searchByQuery,
  DEFAULT_CONDITION,
  DEFAULT_GENRE,
} = require('../utils/isbnClient');

const CONDITIONS = ['Neuf', 'Comme neuf', 'Très bon état', 'Bon état', 'État correct'];

const isHttpUrl = (v) => /^https?:\/\//i.test(String(v || ''));

/**
 * Normalise la réponse d'import ISBN : garantit que TOUS les champs
 * pré-remplissables sont présents et propres (couverture, titre, série,
 * tome, auteurs, dessinateurs, éditeur, date, genre, ISBN, état, synopsis),
 * quel que soit le fournisseur (Google Books d'abord, Open Library en
 * secours / pour compléter les vides).
 */
function toLookupPayload(raw) {
  const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
  const releaseDate = text(raw.release_date);
  return {
    // Couverture : URL distante récupérée via Google Books / Open Library
    // (téléchargée et stockée localement à l'enregistrement de la BD).
    // IMAGE DE SUBSTITUTION : quand Google ne renvoie aucune image, le client
    // googleBooksClient attribue le chemin local générique « /img/no_title.jpg »
    // (servi statiquement par le frontend) — on le transmet TEL QUEL plutôt que
    // d'envoyer une valeur vide au formulaire.
    cover_image: (() => {
      const c = text(raw.cover_image);
      if (!c) return '';
      return c.startsWith('/') ? c : isHttpUrl(c) ? c : '';
    })(),
    title: text(raw.title),
    series: text(raw.series),
    tome_number: text(raw.tome_number),
    authors: text(raw.authors),
    illustrators: text(raw.illustrators),
    publisher: text(raw.publisher),
    // Le frontend attend un AAAA-MM-JJ strict (input type="date")
    release_date: /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate : '',
    genre: text(raw.genre) || DEFAULT_GENRE,
    isbn: String(raw.isbn ?? '').replace(/[^0-9xX]/g, ''),
    // État : valeur standard de l'application (les APIs bibliographiques ne
    // décrivent pas l'exemplaire possédé) ; on conserve un état « valide »
    // si, un jour, une source en renvoie un.
    condition: CONDITIONS.includes(text(raw.condition)) ? text(raw.condition) : DEFAULT_CONDITION,
    // Synopsis : résumé nettoyé (description / notes), pré-remplit le champ
    // optionnel du formulaire (vide si aucune description trouvée).
    synopsis: text(raw.synopsis),
    source: text(raw.source),
  };
}

/**
 * GET /api/isbn/lookup/:isbn
 * Recherche les métadonnées d'une BD à partir de son ISBN
 * (Google Books, puis Open Library en secours).
 */
async function lookupIsbn(req, res, next) {
  try {
    const { isbn } = req.params;
    if (!isbn) {
      return res.status(400).json({ error: 'Le paramètre ISBN est requis.' });
    }

    // TRACE D'ENTRÉE : ISBN tel que saisi + forme normalisée réellement envoyée
    // aux APIs (les deux fournisseurs, Google Books ET Open Library, n'acceptent
    // que la forme normalisée — un diff entre les deux expliquerait tout faux
    // positif « Aucun livre »). Les appels HTTP eux-mêmes (URL exacte, User-Agent,
    // code de réponse, totalItems/payload) sont journalisés en détail par
    // googleBooksClient.js et isbnClient.js ([googleBooks] / [ISBN]).
    console.log(`[lookupIsbn] GET /api/isbn/lookup/${isbn}`);

    const comicData = await searchByIsbn(isbn);
    if (!comicData) {
      // Les logs des deux fournisseurs ci-dessus viennent d'indiquer le verdict
      // exact (quota, HTTP X, « aucun document »…) : ici on confirme la décision.
      console.log(`[lookupIsbn] Résultat final : aucun des fournisseurs ne propose de fiche pour « ${isbn} ». (Voir les lignes [googleBooks] / [ISBN] précédentes pour le diagnostic fourni par chaque API.)`);
      return res.status(404).json({ error: 'Aucune BD trouvée pour cet ISBN.' });
    }
    if (!comicData.title) {
      console.log(`[lookupIsbn] Résultat final : fiche récupérée mais SANS titre (source=${comicData.source}) — rejet 422.`);
      return res.status(422).json({
        error: 'ISBN inconnu ou métadonnées incomplètes : veuillez saisir la fiche manuellement.',
      });
    }

    console.log(`[lookupIsbn] Résultat final : livre trouvé (source=${comicData.source}, titre=« ${comicData.title} »)`);
    return res.json({ success: true, data: toLookupPayload(comicData) });
  } catch (err) {
    if (/ISBN invalide/.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[lookupIsbn]', err);
    return res.status(502).json({ error: "Recherche ISBN indisponible (Google Books / Open Library). Vérifiez la connexion internet du serveur." });
  }
}

/**
 * GET /api/isbn/search?q=<mots-clés>&maxResults=<n>
 * Recherche TEXTUELLE par mots-clés (titre / auteur / série) via Google Books
 * (`q=...` sur https://www.googleapis.com/books/v1/volumes). Sert la modale
 * d'ajout de BD quand l'ISBN / code-barres échoue : renvoie la LISTE des fiches
 * normalisées (mêmes champs que `GET /isbn/lookup/:isbn`, via toLookupPayload)
 * 200 + `data: []` si aucun résultat, pour que le frontend propose de choisir
 * la bonne BD dans une grille/sélection puis pré-remplisse le formulaire.
 * Les erreurs Google explicites (400/403/429… quota) sont propagées à travers
 * err.status au gestionnaire centralisé de server.js -> même statut + message
 * clair que le parcours ISBN (aucune fuite de clé API ni d'URL, cf. client).
 */
async function searchBooks(req, res, next) {
  try {
    const rawQ = String(req.query.q ?? '').replace(/\s+/g, ' ').trim();
    if (!rawQ) {
      return res.status(400).json({ error: "Paramètre « q » requis : titres, auteurs ou série à retrouver." });
    }
    if (rawQ.length > 300) {
      return res.status(400).json({ error: 'Requête trop longue (300 caractères maximum).' });
    }
    const maxResults = Math.min(Math.max(parseInt(req.query.maxResults, 10) || 10, 1), 20);

    // TRACE D'ENTRÉE : requête texte telle que reçue + nombre de résultats max
    // (les détails des appels HTTP Google — URL masquée, User-Agent, codes —
    // sont journalisés par googleBooksClient.js en [googleBooks]).
    console.log(`[searchBooks] GET /api/isbn/search?q=${encodeURIComponent(rawQ)} (maxResults=${maxResults})`);

    const records = await searchByQuery(rawQ, maxResults);
    const data = records.map(toLookupPayload);
    console.log(`[searchBooks] Résultat final : ${data.length} fiche(s) pour « ${rawQ} ». (Source Google Books.)`);
    return res.json({ success: true, data });
  } catch (err) {
    if (err && err.status) {
      // Erreur explicite du client Google Books (400/403/429… quota) : on
      // conserve le code HTTP + son message user-facing déjà sécurisé.
      return res.status(err.status).json({ error: err.message });
    }
    if (/recherche vide|Requête/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    console.error('[searchBooks]', err);
    return res.status(502).json({ error: 'Recherche par mots-clés indisponible (Google Books). Vérifiez la connexion internet du serveur.' });
  }
}

module.exports = { lookupIsbn, searchBooks };
