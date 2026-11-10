/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
const env = require('../config/env');
// Client dédié Google Books (clé GOOGLE_BOOKS_API_KEY, gestion des erreurs,
// extraction de série, images de substitution) — requis AVANT tout appel
// pour que la clé soit chargée via config/env.js (dotenv).
const googleBooks = require('./googleBooksClient');

const USER_AGENT = env.books.userAgent;

// ------------------------------------------------------------
// Valeurs par défaut de l'import ISBN
// ------------------------------------------------------------
// Les bibliographies (Google Books / Open Library) ne décrivent pas
// l'exemplaire possédé : l'« État » est donc proposé avec la valeur
// standard de l'application ("Bon état"), et le « Genre » tombe sur
// "Bande dessinée" quand l'API ne fournit aucune catégorie/subject.
const DEFAULT_CONDITION = 'Bon état';
const DEFAULT_GENRE = 'Bande dessinée';

// ------------------------------------------------------------
// Utilitaires
// ------------------------------------------------------------

/**
 * Normalise un ISBN / code-barres : supprime espaces et tirets,
 * ne retient que les chiffres (et le X de contrôle d'un ISBN-10).
 */
function cleanIsbn(isbn) {
  return isbn ? String(isbn).replace(/[^0-9xX]/g, '') : '';
}

/**
 * Valide un ISBN-10 ou ISBN-13 normalisé (avec clé de contrôle).
 */
function isValidIsbn(value) {
  const isbn = cleanIsbn(value);
  if (isbn.length === 10) {
    if (!/^\d{9}[\dXx]$/.test(isbn)) return false;
    let sum = 0;
    for (let i = 0; i < 9; i += 1) sum += (10 - i) * Number(isbn[i]);
    const last = isbn[9].toUpperCase() === 'X' ? 10 : Number(isbn[9]);
    return (sum + last) % 11 === 0;
  }
  if (isbn.length === 13) {
    if (!/^\d{13}$/.test(isbn)) return false;
    let sum = 0;
    for (let i = 0; i < 13; i += 1) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
    return sum % 10 === 0;
  }
  return false;
}

/**
 * Convertit un ISBN-10 en ISBN-13 (préfixe 978 + recalcul de la clé).
 */
function isbn10ToIsbn13(isbn10) {
  const isbn = cleanIsbn(isbn10);
  if (isbn.length !== 10 || !isValidIsbn(isbn)) return null;
  const digits = isbn.slice(0, 9).split('').map(Number);
  digits.unshift(9, 7, 8);
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += digits[i] * (i % 2 === 0 ? 1 : 3);
  return `${digits.join('')}${(10 - (sum % 10)) % 10}`;
}

function isLocalCoverPath(value) {
  return typeof value === 'string' && value.startsWith('/uploads/comics/');
}

/**
 * Petit utilitaire : attend un nombre de millisecondes.
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch avec un nouvel essai sur 429 / 5xx (les deux API publiquement
 * utilisées sont généreuses mais occasionnellement saturées).
 * @param {string} url
 * @param {object} options
 * @param {{attempts?: number, delayMs?: number}} [retry]
 */
async function fetchWithRetry(url, options = {}, { attempts = 2, delayMs = 1500 } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      // Quota journalier (Google Books « Queries per day ») : réessayer
      // n'y change rien (règle à J+1), on échoue vite pour passer au
      // fournisseur de secours sans latence inutile.
      if (response.status === 429) {
        const body = await response.text().catch(() => '');
        if (/per[_\s]?day/i.test(body)) {
          const err = new Error('HTTP 429 (quota journalier dépassé)');
          err.status = 429;
          throw err;
        }
      }
      // Réessaye uniquement sur les codes transitoires (429, 5xx)
      if (response.status === 429 || response.status >= 500) {
        lastError = new Error(`HTTP ${response.status}`);
        if (i < attempts - 1) {
          console.warn(`[isbn] ${response.status} : nouvel essai dans ${delayMs / 1000}s…`);
          await sleep(delayMs);
          continue;
        }
      }
      const err = new Error(`HTTP ${response.status}`);
      err.status = response.status;
      throw err;
    } catch (err) {
      // Timeout volontaire du signal ou timeout de CONNEXION d'undici
      // (UND_ERR_CONNECT_TIMEOUT — Open Library saturé : le DNS passe mais le
      // TCP ne s'établit pas) : les deux sont transitoires -> nouvel essai.
      const isTransient =
        err &&
        (err.name === 'AbortError' ||
          err.name === 'TimeoutError' ||
          /^UND_ERR_/.test(err.code || '') || // connect_timeout, socket hang-up…
          !Number.isInteger(err.status)); // toute autre erreur hors réponse HTTP
      if (isTransient) {
        lastError = err;
        if (i < attempts - 1) {
          console.warn(`[isbn] Échec réseau d'essai ${i + 1}/${attempts} (${err.message}) : nouvel essai dans ${delayMs / 1000}s…`);
          await sleep(delayMs);
          continue;
        }
      }
      throw err;
    }
  }
  throw lastError || new Error('Tentatives épuisées');
}

// ------------------------------------------------------------
// Téléchargement de couverture distante -> stockage local
// ------------------------------------------------------------

/**
 * Télécharge une image distante et la stocke dans /uploads/comics/.
 * @returns {Promise<string|null>} chemin local "/uploads/comics/<fichier>" ou null
 */
async function downloadCoverImage(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) return null;
  const { downloadCoverImageToDir } = require('./musicBrainzClient');
  try {
    return await downloadCoverImageToDir(url, 'comics');
  } catch (err) {
    console.error('[isbn] Téléchargement de la couverture impossible :', err.message);
    return null;
  }
}

// ------------------------------------------------------------
// Google Books API
// ------------------------------------------------------------

/**
 * @typedef {object} ComicPrefill
 * @property {string} isbn        ISBN normalisé utilisé comme clé de recherche
 * @property {string} title       titre de l'album
 * @property {string} series      série (sujet « series: » Open Library,
 *                                sinon déduite du titre, '' sinon)
 * @property {string} tome_number n° de tome/volume déduit du titre, de la
 *                                série ou du sujet « series: » ('' sinon)
 * @property {string} authors     scénariste(s) / premier(s) auteur(s)
 * @property {string} illustrators dessinateur(s) (auteurs après le 1er)
 * @property {string} publisher   éditeur
 * @property {string} release_date date au format ISO strict AAAA-MM-JJ
 *                                (complétée à -01-01 sinon), '' si inconnue
 * @property {string} genre       genres/catégories nettoyés (préfixes
 *                                « series: », bruit filtré), réduits à
 *                                ≤ 150 caractères, « Bande dessinée » si
 *                                l'API n'en fournit aucuns exploitables
 * @property {string} synopsis    résumé (description Google Books / notes
 *                                Open Library), « nettoyé » (HTML retiré) ;
 *                                pré-remplit le champ optionnel du formulaire
 * @property {string} cover_image URL de couverture (HTTP), null si absente
 * @property {string} source      'google_books', 'open_library' ou
 *                                'google_books+open_library' (fusion des
 *                                deux quand Google Books est incomplet)
 */

/**
 * Recherche les métadonnées d'une BD via Google Books API.
 * Déléguée au module dédié `googleBooksClient.js` (clé GOOGLE_BOOKS_API_KEY,
 * gestion sécurisée des erreurs HTTP, extraction de série, image de
 * SUBSTITUTION générique quand l'API ne renvoie aucune couverture) ; ici on
 * ne fait que mapper la réponse standardisée sur le pré-remplissage `ComicPrefill`.
 * @returns {Promise<ComicPrefill|null>}
 */
async function fetchFromGoogleBooks(cleanedIsbn) {
  // fetchBookByIsbn(isbn brut) renvoie l'objet standardisé ou null (ISBN
  // inconnu -> pas d'erreur, la couche Open Library prend le relais) ; un
  // throw (HTTP 400/403/429/5xx explicite, clé refusée, quota…) laisse
  // searchByIsbn() consigner l'avertissement et basculer sur le secours.
  const parsed = await googleBooks.fetchBookByIsbn(cleanedIsbn);
  if (!parsed) {
    return null;
  }

  // Mapping commun au lookup ISBN et à la recherche textes libres :
  // même chaîne (série extraite par le client, 1er auteur = scénariste /
  // suivants = dessinateurs, n° de tome re-évalué localement).
  const prefill = toComicPrefillFromGoogle(parsed, '');
  // L'ISBN normalisé est la CLÉ de cette recherche : c'est LA valeur à
  // retourner (volumeInfo.isbn peut manquer sur certains documents Google).
  prefill.isbn = cleanedIsbn;
  return prefill;
}

// ------------------------------------------------------------
// Open Library API (recherche de secours)
// ------------------------------------------------------------

/**
 * Recherche des métadonnées via Open Library API.
 * @returns {Promise<ComicPrefill|null>}
 */
async function fetchFromOpenLibrary(cleanedIsbn) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${cleanedIsbn}&format=json&jscmd=data`;
  console.log(`[ISBN] Open Library (/api/books) : GET ${url} (User-Agent: "${USER_AGENT}")`);
  let response;
  try {
    response = await fetchWithRetry(
      url,
      {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15000),
      },
      { attempts: 2, delayMs: 1500 }
    );
  } catch (err) {
    // Échec réseau / HTTP persistant : on trace PRÉCISÉMENT le défaut du
    // fournisseur pour diagnostic rapide. Les erreurs « fetch failed » de
    // Node (undici) cachent la vraie cause (DNS ENOTFOUND, ECONNREFUSED,
    // TLS reset, timeout…) dans err.cause — elle est ici indispensable pour
    // distinguer une panne egress du conteneur d'un blocage IP du côté OL.
    const cause =
      (err && err.cause && (err.cause.code || err.cause.message)) || 'cause inconnue';
    console.warn(
      `[ISBN] Open Library (/api/books) — échec HTTP/réseau : ${err.message} (${cause})`
    );
    throw err;
  }

  // Parsing robuste : l'endpoint est régulièrement saturé et renvoie parfois
  // un corps non-JSON (HTML d'erreur, page vide…). `response.json()` leverait
  // alors une SyntaxError non-explicite — on logge au lieu de planter.
  const data = await response.json().catch((parseErr) => {
    console.warn(
      `[ISBN] Open Library (/api/books) — corps de réponse illisible (HTTP ${response.status}, ${parseErr.message})`
    );
    return null;
  });
  if (!data || typeof data !== 'object') {
    console.warn('[ISBN] Open Library (/api/books) — réponse non conforme, abandon propre.');
    return null;
  }

  const bookKey = `ISBN:${cleanedIsbn}`;
  if (!data[bookKey]) {
    // Réponse `{}` : l'ISBN n'est simplement PAS catalogué sur Open Library
    // (cas fréquent pour les titres récents et certaines éditions BE) — ce
    // n'est pas une erreur ; on trace le payload exact avant de renvoyer null.
    console.log(
      `[ISBN] Open Library (/api/books) — aucun document pour ${bookKey} (payload reçu : ${JSON.stringify(data).slice(0, 300)})`
    );
    return null;
  }

  const book = data[bookKey] || {};
  const authorList = Array.isArray(book.authors)
    ? book.authors.map((a) => (a && a.name) || '').filter(Boolean)
    : [];
  let authors = authorList.join(', ');
  let illustrators = authorList.length > 1 ? authorList.slice(1).join(', ') : '';

  // by_statement / par_statement : « par A ; dessin B », « Dessin de X »…
  // quand l'équipe est détaillée sur OL. Si le rôle « dessin » est explicite
  // et que le nom n'est pas déjà dans la liste des auteurs, il devient
  // dessinateur (ex. « Dessin de X » alors que seuls les scénaristes sont
  // dans `authors`). Les rôles « texte/scénario/par » ne sont pas exploités
  // : la liste `authors` d'OL fait déjà foi pour le champ Auteur(s).
  const byStatement = String(book.by_statement || book.par_statement || '').trim();
  if (byStatement) {
    for (const m of byStatement.matchAll(/\b(?:dessin|illustration|couleurs|dé?cors?)\s*(?:de|par)\s*([^;,\n]+)/gi)) {
      const name = m[1].trim();
      if (name && !authorList.includes(name) && !illustrators.includes(name)) {
        illustrators = illustrators ? `${illustrators}, ${name}` : name;
      }
    }
  }
  const publishers = Array.isArray(book.publishers)
    ? book.publishers.map((p) => (p && p.name) || '').filter(Boolean).join(', ')
    : '';

  // Titre : « Titre principal, tome N — Sous-titre » ; le sous-titre
  // (titre de l'album) est joint quand il existe.
  let title = String(book.title || '').trim();
  if (book.subtitle && String(book.subtitle).trim() && !title.toLowerCase().includes(String(book.subtitle).trim().toLowerCase())) {
    title = title ? `${title} — ${String(book.subtitle).trim()}` : String(book.subtitle).trim();
  }

  // Objets subjects d'Open Library : [{"name": "series:Nom de la série"},
  // {"name": "Comic books, strips"}, …] (ou chaînes simples).
  const subjectNames = (Array.isArray(book.subjects)
    ? book.subjects.map((s) => (s && s.name) || s)
    : [book.subjects]
  ).map((s) => String(s || '').trim()).filter(Boolean);

  // Série : Open Library rattache la série à un subject « series:Nom »
  // (fiabilisé, contrairement à une déduction du titre) :
  // « Lanfeust de Troy, tome 1: L'Ivoire du Magohamoth » -> série
  // « Lanfeust de Troy » (extraite du subject).
  let series = '';
  for (const s of subjectNames) {
    const m = s.match(/^series:\s*([A-Za-zÀ-ÿ].{1,80})$/);
    if (m) {
      series = m[1].trim();
      break;
    }
  }

  // En l'absence de sujet « series: », on essaie de déduire la série du
  // titre (« Série — Album », « Série : Album », « Série, Album »…).
  // (Le n° de volume « consommé » par le découpage, case « Série, tome 1 »,
  // est conservé via consumedTome et rapporté plus bas.)
  let consumedTome = '';
  if (!series) {
    const split = splitTitleSeries(title);
    if (split) {
      series = split.series;
      consumedTome = split.tome || '';
      const startsWithTome = /^(?:t\.?|tome|vol\.?|volume|n[°º]|é?pisode)[\s.]*\d/i.test(split.cleanTitle);
      if (split.cleanTitle && !startsWithTome) title = split.cleanTitle;
    }
  }

  // Tome / numéro : déduit du titre ET du nom de série (« Lanfeust de Troy,
  // tome 1 ») — le n° est souvent porté uniquement par la mention de série.
  const tomeFromTitles = extractTomeNumber(title, series) || consumedTome;
  const tomeFromSubjects = series
    ? extractTomeNumber(
        subjectNames
          .filter((n) => /^series:/i.test(n))
          .map((n) => n.replace(/^series:/i, ''))
      )
    : '';
  const tomeNumber = tomeFromTitles || tomeFromSubjects;

  // Couverture : Open Library renvoie parfois des URL relatives ou sans protocole
  let coverUrl = null;
  if (book.cover) {
    coverUrl =
      book.cover.large ||
      book.cover.medium ||
      book.cover.small ||
      book.cover.tiny ||
      null;
    if (coverUrl) {
      if (coverUrl.startsWith('//')) coverUrl = `https:${coverUrl}`;
      else if (coverUrl.startsWith('/')) coverUrl = `https://covers.openlibrary.org${coverUrl}`;
      else if (!/^https?:\/\//i.test(coverUrl)) coverUrl = `https://${coverUrl}`;
    }
  }

  return {
    isbn: cleanedIsbn,
    title: clip(title, 512),
    series: clip(series, 512),
    tome_number: clip(tomeNumber, 50),
    authors: clip(authors, 512),
    illustrators: clip(illustrators, 512),
    publisher: clip(publishers, 512),
    release_date: normalizeReleaseDate(book.publish_date),
    genre: normalizeGenre(subjectNames) || DEFAULT_GENRE,
    synopsis: typeof book.notes === 'string' ? book.notes.replace(/\s+/g, ' ').trim() : '',
    cover_image: coverUrl,
    source: 'open_library',
  };
}

/**
 * Complément de recherche Open Library via l'index /search.json :
 * l'API /api/books (bibkeys) RACOURCIT le titre en retirant le préfixe
 * « Série, tome N » (« Le Chat du Rabbin, tome 1 — La Bar-Mitsva » devient
 * « La Bar-Mitsva ») — le n° de tome n'y apparaît alors que dans l'index.
 * On n'en extrait QUE ces 3 champs :
 *   - tome : « Le Chat du Rabbin, tome 1 » -> « 1 » ;
 *   - synopsis : description de l'index quand /api/books n'en fournit
 *     aucune (notes rarement renseignées sur OL) ;
 *   - série : subject « series:Nom » quand l'indice de séries est présent
 *     (absent de l'index pour beaucoup de notices BD — auquel cas le
 *     découpage du titre de /api/books l'a déjà fournie).
 * @returns {Promise<{tome: string, synopsis: string, series: string}|null>}
 */
async function fetchFromOpenLibrarySearch(cleanedIsbn) {
  const url = `https://openlibrary.org/search.json?isbn=${cleanedIsbn}&limit=1`;
  console.log(`[ISBN] Open Library (/search.json) : GET ${url} (User-Agent: "${USER_AGENT}")`);
  let response;
  try {
    response = await fetchWithRetry(
      url,
      {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(15000),
      },
      { attempts: 2, delayMs: 1500 }
    );
  } catch (err) {
    // Idem /api/books : err.cause porte la vraie cause réseau (DNS, refus, TLS…).
    const cause =
      (err && err.cause && (err.cause.code || err.cause.message)) || 'cause inconnue';
    console.warn(
      `[ISBN] Open Library (/search.json) — échec HTTP/réseau : ${err.message} (${cause})`
    );
    throw err;
  }

  const data = await response.json().catch((parseErr) => {
    console.warn(
      `[ISBN] Open Library (/search.json) — corps de réponse illisible (HTTP ${response.status}, ${parseErr.message})`
    );
    return null;
  });
  if (!data || typeof data !== 'object') {
    console.warn('[ISBN] Open Library (/search.json) — réponse non conforme, abandon propre.');
    return null;
  }

  const doc = data.docs && data.docs[0];
  if (!doc) {
    console.log(
      `[ISBN] Open Library (/search.json) — numFound=${data.numFound ?? '?'} pour isbn=${cleanedIsbn} (aucun document)`
    );
    return null;
  }

  const seriesFromSubjects = (doc.subjects || [])
    .map((s) => String(s || ''))
    .map((s) => s.match(/^series:\s*([A-Za-zÀ-ÿ].{1,80})$/))
    .find(Boolean)?.[1];

  return {
    tome: extractTomeNumber(doc.title, doc.subtitle) || '',
    synopsis: typeof doc.description === 'string' ? doc.description.replace(/\s+/g, ' ').trim() : '',
    series: seriesFromSubjects || '',
  };
}

// ------------------------------------------------------------
// Open Library API (recherche TEXTUELLE par mots-clés — /search.json?fields=…)
// ------------------------------------------------------------

/**
 * Champs demandés à /search.json pour la recherche TEXTUELLE : chaque doc est
 * un « work » (œuvre regroupant ses éditions) — le résultat est déjà propre
 * côté Open Library, contrairement à l'index complet paginé par ÉDITION. La
 * liste `fields` borne la taille du payload sans sacrifier aucune donnée utile
 * au pré-remplissage (cf. toComicPrefillFromOpenLibraryDoc). Tolérante : un
 * champ absent de `fields` est simplement manquant dans le doc renvoyé — le
 * mapping traite chacun en optionnel (`subjects` absent sur beaucoup de
 * notices BD -> heuristique du titre, cf. fetchFromOpenLibrary).
 */
const OL_SEARCH_FIELDS = [
  'key',                // /works/OL…W — identifiant stable (diagnostic/dédupe)
  'title',              // titre principal (« Série, tome N — Album »)
  'subtitle',           // sous-titre (titre d'album) quand distinct du titre
  'author_name',        // auteur(s) — array de libellés lisibles
  'publisher',          // éditeur(s) — array de libellés (works)
  'first_publish_year', // année minimale connue — proxy de « publishedDate »
  'description',        // résumé -> synopsis
  'cover_i',            // id jaquette -> covers.openlibrary.org/b/id/<id>-L.jpg
  'isbn',               // ISBN du work (array) -> ISBN le plus plausible
  'subjects',           // sujets -> série « series:Nom » + genres
].join(',');

/**
 * Recherche TEXTUELLE Open Library via l'index /search.json — le miroir du
 * parcours ISBN (fetchFromOpenLibrarySearch) appliqué à une requête LIBRE, et
 * le COMPLÉMENT de Google Books dans l'onglet « Recherche par mots-clés » de
 * la modale : cascade quand Google Books ne renvoie aucun résultat, fusion
 * (dédoublonnement + complétion des vides) sinon — voir searchByQuery.
 * Renvoie déjà les fiches normalisées (ComicPrefill), prêtes pour le
 * contrôleur : même shape que toComicPrefillFromGoogle (sauf `source`).
 *
 * Cas particulier ISBN tapé en texte (« 978… ») : on envoie la requête brute
 * telle quelle dans `q` — l'index Open Library matche aussi les ISBN des
 * documents (« q=9782302015906 » -> le bon work, vérifié), à l'image de Google
 * Books qui interprète lui-même la syntaxe « isbn:… » dans `q`. Aucun besoin
 * du paramètre dédié `isbn=` : ce serait redondant et moins tolérant (il
 * restreindrait par ÉDITION du work).
 *
 * NON BLOQUANT (important) : toute erreur HTTP/réseau est ABSORBÉE et tracée,
 * la fonction renvoie null (pas d'exception) — Open Library est un COMPLEMENT,
 * un échec ne doit jamais nuire à une requête Google Books déjà exploitable.
 *
 * @param {string} query requête libre (« Les Démons d'Alexia… »)
 * @param {number} [limit] nombre MAX de docs demandés (défaut 10, borne 20 —
 *   même plafond que Google Books côté contrôleur).
 * @returns {Promise<object[]|null>} liste de fiches normalisées (éventuellement
 *   VIDE si aucun document), ou null en cas d'échec Open Library (absorbé).
 */
async function searchOpenLibraryText(query, limit = 10) {
  const q = String(query || '').trim();
  if (!q) return [];
  const n = Math.max(1, Math.min(Number(limit) || 10, 20));

  const params = new URLSearchParams();
  params.set('q', q);
  params.set('limit', String(n));
  params.set('fields', OL_SEARCH_FIELDS);
  const url = `https://openlibrary.org/search.json?${params.toString()}`;

  console.log(`[ISBN] Open Library (/search.json, textuel) : GET ${url} (User-Agent: "${USER_AGENT}")`);
  let response;
  try {
    response = await fetchWithRetry(
      url,
      { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000) },
      { attempts: 2, delayMs: 1500 }
    );
  } catch (err) {
    // Idem /api/books : err.cause porte la vraie cause réseau (DNS, refus, TLS…).
    const cause = (err && err.cause && (err.cause.code || err.cause.message)) || 'cause inconnue';
    console.warn(`[ISBN] Open Library (/search.json, textuel) — échec HTTP/réseau : ${err.message} (${cause})`);
    return null; // absorbé : le COMPLEMENT ne bloque jamais la recherche
  }

  const data = await response.json().catch((parseErr) => {
    console.warn(`[ISBN] Open Library (/search.json, textuel) — corps illisible (HTTP ${response.status}, ${parseErr.message})`);
    return null;
  });
  if (!data || typeof data !== 'object') {
    console.warn('[ISBN] Open Library (/search.json, textuel) — réponse non conforme, abandon propre.');
    return [];
  }

  const docs = Array.isArray(data.docs) ? data.docs : [];
  console.log(`[ISBN] Open Library (/search.json, textuel) — numFound=${data.numFound ?? '?'} → ${docs.length} doc(s) pour « ${q} »`);

  // Chaque doc -> fiche ComicPrefill (null ignoré, ex. doc sans titre).
  return docs.map((d) => toComicPrefillFromOpenLibraryDoc(d)).filter(Boolean);
}

/**
 * Mapping d'UN DOCUMENT `/search.json` (work) vers une fiche `ComicPrefill`.
 * MÊME shape que toComicPrefillFromGoogle / fetchFromOpenLibrary — le
 * dédoublonnage de searchByQuery croise donc les fiches des deux fournisseurs
 * sur leurs champs sans aucune transformation supplémentaire.
 *
 * Règles d'extraction (fidèles aux conventions du module, reprises du parcours
 * ISBN + Google Books) :
 *   - title = « Titre principal » ; le « Série — Album » est découpé via
 *     splitTitleSeries (idempotent avec la logique Google cf. analyzeVolume).
 *   - series = subject « series:Nom » OU découpage du titre (fallback titre).
 *   - tome = extrayé du titre sous-titre/série (heuristique extractTomeNumber,
 *     identique à fetchFromOpenLibrarySearch pour cohérence du flux ISBN).
 *   - authors = 1er auteur ; illustrators = auteurs suivants (convention BD).
 *   - publisher : OL retourne une liste string[] -> concaténation « , ».
 *   - release_date = normalisation AAAA-MM-JJ stricte de first_publish_year.
 *   - cover_image = jaquette via cover_i (`covers.openlibrary.org/b/id/<id>-L.jpg`,
 *     idem fetchSeriesCoverFromOpenLibrary de seriesService.js). Sans cover_i ->
 *     null (le contrôleur / la modale font eux-mêmes le repli local no_title).
 *   - genre = normalizeGenre(subjects) puis repli DEFAULT_GENRE (comportement
 *     aligné sur fetchFromGoogleBooks : genreIsDefault pilote la fusion).
 *   - isbn : le plus plausible parmi ceux du work (œuvre multi-éditions)
 *     — voir pickOlibraryIsbn ci-dessous.
 */
function toComicPrefillFromOpenLibraryDoc(doc) {
  if (!doc || typeof doc !== 'object') return null;

  const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

  // ---- titre (+ sous-titre éventuel joint, cf. fetchFromOpenLibrary) ----
  let title = text(doc.title);
  if (doc.subtitle && text(doc.subtitle) && !title.toLowerCase().includes(text(doc.subtitle).toLowerCase())) {
    title = title ? `${title} — ${text(doc.subtitle)}` : text(doc.subtitle);
  }

  // ---- série + tome (+ éventuel « consumed Tome » du découpage) ----------
  let series = '';
  let consumedTome = '';
  const subjectNames = (Array.isArray(doc.subjects) ? doc.subjects : [doc.subjects])
    .map((s) => String(s || '').trim())
    .filter(Boolean);
  for (const s of subjectNames) {
    const m = s.match(/^series:\s*([A-Za-zÀ-ÿ].{1,80})$/);
    if (m) { series = m[1].trim(); break; }
  }
  if (!series) {
    // Fallback titre : « Série — Album » / « Série, Album » / « Série : Album »
    // (splitTitleSeries renvoie null sans série plausible -> aucun changement).
    const split = splitTitleSeries(title);
    if (split) {
      series = split.series;
      consumedTome = split.tome || '';
      const startsWithTome = /^(?:t\.?|tome|vol\.?|volume|n[°º]|é?pisode)[\s.]*\d/i.test(split.cleanTitle);
      if (split.cleanTitle && !startsWithTome) title = split.cleanTitle;
    }
  }

  // ---- n° tome : titre, sous-titre, série, puis subject « series: » --------
  const seriesSubjectsTome = extractTomeNumber(
    subjectNames.filter((n) => /^series:/i.test(n)).map((n) => n.replace(/^series:/i, ''))
  );
  const tome = extractTomeNumber(title, doc.subtitle, series) || consumedTome || seriesSubjectsTome;

  // ---- auteurs / dessinateurs (1er = scénario, suivants = dessin) ---------
  const authorList = (Array.isArray(doc.author_name) ? doc.author_name : [])
    .map((a) => text(a)).filter(Boolean);
  const authors = authorList.join(', ');
  const illustrators = authorList.length > 1 ? authorList.slice(1).join(', ') : '';

  // ---- éditeur(s) : array de labels -> chaîne « , » --------------------------
  const publishers = (Array.isArray(doc.publisher) ? doc.publisher : [doc.publisher])
    .map((p) => text(p)).filter(Boolean).join(', ');

  // ---- couverture via cover_i (idem sérieService.fetchSeriesCoverFromOpenLibrary)
  let coverImage = null;
  if (Number(doc.cover_i)) {
    coverImage = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
  }

  // ---- ISBN le plus plausible parmi ceux du work --------------------------
  const pickedIsbn = pickOlibraryIsbn(doc.isbn);

  return {
    isbn: pickedIsbn,
    title: clip(title, 512),
    series: clip(series, 512),
    tome_number: clip(tome, 50),
    authors: clip(authors, 512),
    illustrators: clip(illustrators, 512),
    publisher: clip(publishers, 512),
    release_date: normalizeReleaseDate(doc.first_publish_year),
    genre: normalizeGenre(subjectNames) || DEFAULT_GENRE,
    synopsis: typeof doc.description === 'string' ? doc.description.replace(/\s+/g, ' ').trim() : '',
    cover_image: coverImage,
    source: 'open_library',
  };
}

/**
 * Sélectionne l'ISBN « le plus plausible » parmi la liste d'un work (work =
 * œuvre multi-éditions). Hiérarchie :
 *   1. ISBN-13 commençant par « 978 » (préfixe principal des éditions FR/BE
 *      — pertinence maximale pour une médiathèque BD francophone) ;
 *   2. sinon le premier ISBN-13 quel qu'il soit ;
 *   3. sinon le premier ISBN-10 (un seul, au contrôle) ;
 *   4. sinon la première valeur saine de la liste.
 * Ne renvoie QUE des valeurs déjà validées (10/13 chiffres + X final possible)
 * via isValidIsbn — un work dont aucun ISBN n'est exploitable renvoie ''.
 */
function pickOlibraryIsbn(list) {
  if (!Array.isArray(list) || list.length === 0) return '';
  const clean = list
    .map((x) => String(x ?? '').replace(/[^0-9xX]/g, ''))
    .filter((x) => isValidIsbn(x));
  if (clean.length === 0) return '';
  const isbn13Fr = clean.find((i) => i.length === 13 && i.startsWith('978'));
  if (isbn13Fr) return isbn13Fr;
  const anyIsbn13 = clean.find((i) => i.length === 13);
  if (anyIsbn13) return anyIsbn13;
  return clean[0];
}

// ------------------------------------------------------------
// Normalisation des dates publiées
// ------------------------------------------------------------

/**
 * Réduit un mois (nom FR/EN, abrégé ou complet) à son numéro 1-12.
 * "jan", "Jan", "janv.", "janvier", "january", "fév", "Feb"… -> 1-2…
 */
function monthNumber(raw) {
  if (!raw) return null;
  const key = String(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z]/g, '')
    .slice(0, 3);
  const MONTHS = {
    jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, avr: 4, may: 5, mai: 5,
    jun: 6, jui: 6, jul: 7, aug: 8, aou: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  return MONTHS[key] || null;
}

/**
 * Réduit une date brute (depuis Google Books / Open Library : "YYYY", "YYYY-MM",
 * "YYYY-MM-DD", "Jan 2005", "1 janv. 2005", "01/02/2005"…) au format ISO strict
 * AAAA-MM-JJ, en complétant à -01-01 lorsque le mois ou le jour est inconnu.
 * Retourne '' si aucune année exploitable n'est trouvée.
 */
function normalizeReleaseDate(raw) {
  if (raw === null || raw === undefined) return '';
  const s = String(raw).trim();
  if (!s) return '';

  const toIso = (year, month, day) => {
    const y = Number(year);
    if (!y || y < 1000 || y > 2100) return '';
    const mm = Number(month) >= 1 && Number(month) <= 12
      ? String(Number(month)).padStart(2, '0')
      : '01';
    const dd = Number(day) >= 1 && Number(day) <= 31
      ? String(Number(day)).padStart(2, '0')
      : '01';
    return `${y}-${mm}-${dd}`;
  };

  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (m) return toIso(m[1], m[2], m[3]);

  // JJ/MM/AAAA, JJ-MM-AAAA, JJ.MM.AAAA ou MM/DD/AAAA (convention FR : 1er = jour)
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    let a = Number(dmy[1]);
    let b = Number(dmy[2]);
    // Convention FR : 1er = jour. Si le 2e dépasse 12, c'est un format
    // US MM/DD -> on échange pour reposer sur (jour, mois).
    if (b > 12 && a <= 12) [a, b] = [b, a];
    return toIso(dmy[3], b, a);
  }

  // "1 janvier 2005", "1 jan. 2005" (jour + nom de mois + année)
  const dmyName = s.match(/^(\d{1,2})[,\s]+([A-Za-zÀ-ÿ]+)[.,]*\s*(\d{4})$/);
  if (dmyName) {
    const mo = monthNumber(dmyName[2]);
    if (mo) return toIso(dmyName[3], mo, dmyName[1]);
  }
  // "Jan 2005", "janvier 2005" (nom de mois + année)
  const my = s.match(/^([A-Za-zÀ-ÿ]+)\s+(\d{4})$/);
  if (my) {
    const mo = monthNumber(my[1]);
    if (mo) return toIso(my[2], mo);
  }
  // "2005 janvier" (année + nom de mois)
  const ym = s.match(/^(\d{4})\s+([A-Za-zÀ-ÿ]+)/);
  if (ym) {
    const mo = monthNumber(ym[2]);
    if (mo) return toIso(ym[1], mo);
  }
  // "YYYY-MM" caché en début de chaîne
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return toIso(iso[1], iso[2]);
  // Dernière chance : une seule année au sein de la chaîne
  const year = s.match(/\b(1[5-9]\d{2}|20\d{2})\b/);
  if (year) return toIso(year[1]);
  return '';
}

// ------------------------------------------------------------
// Extraction du n° de tome
// ------------------------------------------------------------

/**
 * Extrait le numéro de tome d'un titre (ou d'une série) :
 * "tome 15", "t. 8", "T9", "volume 2", "n° 12", "#12", "3/5"…
 * @returns {string} le numéro (ou '' si non détecté)
 */
function extractTomeNumber(...texts) {
  for (const raw of texts) {
    const s = String(raw || '').trim();
    if (!s) continue;
    // "tome 15", "t. 8", "T9", "volume 2", "n° 12", "épisode 3"…
    let m = s.match(/\b(?:tome|t|volume|vol|n[°º]|numero|numéro|é?pisode|partie|part)\s*[:.#]?\s*#?\s*(\d{1,3})(?=[\s\-–—.,;:!?/]|$)/i);
    if (m) return m[1];
    // « Série 12: Album », « Série 12 » : le numéro suit immédiatement le nom
    // de série (ex. "Astérix 13: Le Bouclier arverne"). 3 chiffres max pour
    // ne pas confondre avec une année ("Métal Hurlant 1977" -> pas de tome).
    m = s.match(/\b[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\-]{0,30}\s{1,3}(\d{1,3})\b(?=[:\s]|$)/);
    if (m) return m[1];
    // "#12"
    m = s.match(/#(\d{1,3})\b/);
    if (m) return m[1];
    // "3/5" (éventuellement "3 + 5")
    m = s.match(/(\d{1,3})\s*\/\s*\d{0,3}/);
    if (m) return m[1];
    // Chiffre final (3 chiffres max pour ne pas confondre avec une année)
    m = s.match(/\b(\d{1,3})$/);
    if (m) return m[1];
  }
  return '';
}

// ------------------------------------------------------------
// Inférence de la série depuis le titre
// ------------------------------------------------------------

/**
 * Découpe un titre type "Série — Album", "Série : Album", "Série, Album"
 * ou "Série, tome 15" et renvoie { series, cleanTitle, tome } (cleanTitle
 * et tome peuvent être vides), ou null si aucune série plausible n'est
 * détectée en début de titre. `tome` porte le n° de volume « consommé »
 * par le découpage (cas « Série, tome 15 ») afin qu'il ne soit pas perdu.
 */
function splitTitleSeries(title) {
  const s = String(title || '').trim();
  if (!s) return null;

  // « Série — Album », « Série : Album », « Série - Album »
  // (série multi-mots et séries avec points : "L.E.I.A.", "S.T.A.R.")
  let m = s.match(/^([A-Za-zÀ-ÿ0-9'’&.\s\-]{2,60}?)\s*[–—\-:]\s+([A-Za-zÀ-ÿ0-9'’&.:\-,\s]{2,120})$/);
  let rest = m ? m[2] : '';
  let tome = '';
  if (!m) {
    // « Série. Album » (point de séparation)
    m = s.match(/^([A-Za-zÀ-ÿ0-9'’&.\s\-]{2,60}?)\.\s+([A-Za-zÀ-ÿ0-9'’&.:\-,\s]{2,120})$/);
    rest = m ? m[2] : '';
  }
  if (!m) {
    // « Série, tome 15 (: sous-titre)? » — toujours testé AVANT le cas générique
    // ci-dessous, sinon « tome 15 » serait confondu avec un nom d'album.
    // Le n° (groupe 2) est capturé : il constitue le tome_number quand le
    // titre est de ce type ("Lanfeust de Troy, tome 1 : L'Ivoire…").
    m = s.match(
      /^([A-Za-zÀ-ÿ0-9'’&.\s\-]{2,60}?)\s*,\s*(?:tome|t\.?|vol\.?|volume|n[°º]|é?pisode)\b[\s.:#]*#?\s*(\d{1,3})\b\s*[–—:]?\s*(.*)$/i
    );
    rest = m && m[3] ? m[3] : '';
    tome = m ? m[2] : '';
  }
  if (!m) {
    // « Série, Album » (virgule entre série et nom d'album) ; le groupe
    // d'album autorise les espaces ("Spirou et Fantasio, Le Lac sans fond")
    // et les guillemets/apostrophes éventuels.
    m = s.match(/^([A-Za-zÀ-ÿ0-9'’&.\s\-]{2,60}?)\s*,\s+([A-Za-zÀ-ÿ0-9'’&.:\-“”\s]{2,120})$/);
    rest = m ? m[2] : '';
  }
  if (!m) return null;

  const candidate = m[1].trim();
  if (!candidate || /\d/.test(candidate)) return null; // "1984 : …" n'est pas une série

  // Reste entre parenthèses SEUL (« Persepolis, Vol. 1 (Spanish) » ->
  // « (Spanish) ») : note éditoriale / langue d'édition, pas un titre
  // d'album. On renvoie un cleanTitle vide : l'appelant conserve alors le
  // titre d'origine (série et tome restent extraits).
  let cleanTitle = String(rest || '').trim();
  if (/^\([^)]*\)$/.test(cleanTitle)) cleanTitle = '';

  return { series: candidate, cleanTitle, tome };
}

// ------------------------------------------------------------
// Normalisation des genres (catégories / subjects)
// ------------------------------------------------------------

/**
 * Normalise un sujet/genre pour la déduplication : minuscules, accents et
 * TOUS les caractères non-alphanumériques retirés. Les blancs parasites
 * d'Open Library sont **en plein mot** (« Judai sme », « Bandes dessine es »)
 * : on ne peut pas simplement réduire les espaces, il faut les supprimer
 * tout court pour aligner « Judaïsme »≈« Judai sme »≈« Judaism » et
 * « Bandes dessinées »≈« Bandes dessine es ». Sert uniquement à grouper ;
 * l'affichage conserve le libellé lisible.
 */
function genreKey(label) {
  return String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase();
}

/* Bruit à exclure des genres : le préfixe « series: » (ce sont des données
   de série qui fuient depuis les subjects Open Library, pas un genre) et
   les notices linguistiques/métadonnées. */
const NOISY_GENRE = [
  /^series:/i,
  /translations? into /i,
  /^fiction(\s|$)/i,
  /children'?s/i,
];

/* Mapping de subjects anglophones courants vers des genres lisibles.
   Chaque règle est testée sur la version « genreKey » du libellé
   (minuscule, sans accents) pour tolérer « judai sme », « bandes
   dessine es »… ; l'ordre des règles compte (la plus spécifique d'abord). */
const GENRE_MAP = [
  [/^comic books?, strips?/i, 'Bande dessinée'],
  [/^comics? ?&? ?graphic novels?/i, 'Roman graphique'],
  [/^graphic novel/i, 'Roman graphique'],
  [/^comic book/i, 'Bande dessinée'],
  [/^adventure/i, 'Aventure'],
  [/^science fiction/i, 'Science-fiction'],
  [/^fantasy/i, 'Fantastique'],
  [/^humor(istic)?/i, 'Humour'],
  [/^western/i, 'Western'],
  [/^history/i, 'Historique'],
  [/^biography/i, 'Biographie'],
  [/^non[- ]?fiction/i, 'Non-fiction'],
  [/^memoir/i, 'Mémoires'],
  // Tolérantes aux blancs parasites d'Open Library : les clés normalisées
  // de « Bandes dessinées » et « Bandes dessine es » donnent toutes deux
  // « bandesdessinees » (idem « Judai sme » / « Judaïsme » → « judaisme »).
  [/^bandes?dessine/, 'Bande dessinée'],
  [/^judaisme/, 'Judaïsme'],
];

/**
 * Réduit une liste de catégories/subjects en une chaîne de genres lisible :
 * nettoyage du bruit (préfixe « series: », notices linguistiques), mapping
 * de subjects courants, déduplication insensible à la casse, limite au
 * nombre max de catégories et à une longueur totale bornée
 * (colonne genre TEXT).
 */
function normalizeGenre(categories, max = 3) {
  // Open Library renvoie parfois `subjects`/`categories` en UNE seule chaîne
  // « a, b, c, … » : on la décortique dès qu'elle porte > 1 virgule (les
  // vrais sujets simples à virgule unique, ex. « Comic books, strips »,
  // sont conservés intacts).
  const rawList = (Array.isArray(categories) ? categories : [categories])
    .map((g) => String(g || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const list = rawList
    .flatMap((g) => (g.split(',').length > 2 ? g.split(',') : [g]))
    .map((g) => String(g).replace(/\s+/g, ' ').trim())
    .filter((g) => g && !NOISY_GENRE.some((re) => re.test(g)));
  const seen = new Set();
  const unique = [];
  for (const g of list) {
    // Déduplication insensible aux accents et aux blancs parasites :
    // « Judai sme » ≈ « Judaism » ≈ « Judaïsme ».
    const key = genreKey(g);
    if (!key || seen.has(key)) continue;
    const mapped =
      GENRE_MAP.find(([re]) => re.test(key))?.[1] || // mapping par clé normalisée
      GENRE_MAP.find(([re]) => re.test(g))?.[1] ||   // re-test sur le libellé original
      g;
    const mappedKey = genreKey(mapped);
    if (seen.has(mappedKey)) continue; // « Bandes dessinées » ≈ « Bande dessinée »
    seen.add(key);
    seen.add(mappedKey);
    unique.push(mapped);
    if (unique.length >= max) break;
  }
  let joined = '';
  for (const g of unique) {
    const next = joined ? `${joined}, ${g}` : g;
    if (next.length > 500) break;
    joined = next;
  }
  return joined;
}

/**
 * Tronque une valeur texte à une longueur donnée (sécurise les colonnes
 * VARCHAR de la table comics) en ajoutant un point de suspension.
 */
function clip(value, length) {
  const s = String(value || '').replace(/\s+/g, ' ').trim();
  if (s.length <= length) return s;
  return `${s.slice(0, length - 1).trimEnd()}…`;
}

// ------------------------------------------------------------
// API publique
// ------------------------------------------------------------

/**
 * Recherche principale par ISBN : Google Books d'abord,
 * Open Library en secours.
 * @param {string} isbnRaw ISBN brut (espaces/tirets autorisés)
 * @returns {Promise<ComicPrefill|null>} métadonnées ou null si introuvable
 */
async function searchByIsbn(isbnRaw) {
  // ISBN-10 -> ISBN-13
  let isbn = cleanIsbn(isbnRaw);
  if (/^\d{9}[\dXx]$/.test(isbn) && !isbn.startsWith('978') && !isbn.startsWith('979')) {
    const converted = isbn10ToIsbn13(isbn);
    if (converted) isbn = converted;
  }
  if (!isValidIsbn(isbn)) {
    throw new Error(
      "ISBN invalide : 13 chiffres (ISBN-13) ou 10 caractères (ISBN-10) attendus."
    );
  }

  let result = null;

  // 1) Google Books
  try {
    result = await fetchFromGoogleBooks(isbn);
  } catch (err) {
    console.warn(`[ISBN] Échec Google Books pour ${isbn} :`, err.message);
  }

  // Champs « utiles » au pré-remplissage du formulaire, en plus du titre :
  // tome/volume, auteurs, série, éditeur, date de parution, synopsis.
  // (Le genre est exclu : l'API renvoie toujours la valeur par défaut
  // « Bande dessinée » quand elle n'en fournit aucun, ce qui ne compte
  // pas comme un contenu.)
  const FIELDS_MEANINGFUL = ['tome_number', 'authors', 'series', 'publisher', 'release_date', 'synopsis'];

  const hasMeta = (record) =>
    Boolean(record) && FIELDS_MEANINGFUL.some((f) => String(record[f] || '').trim().length > 0);

  // Complément Open Library /search.json (index de recherche) : le titre
  // y est complet (« Série, tome N — Album ») alors que l'API /api/books
  // y supprime le préfixe de série — le n° de tome et la description
  // (synopsis) n'y existent donc que dans l'index. N'est appelé que si
  // ces champs sont encore vides dans la fiche (une seule requête
  // supplémentaire dans un cas rare).
  const applySearchExtras = async (record) => {
    // Note : le genre n'est PAS récupéré ici (search.json n'en fournit pas)
    // — il est complété via /api/books (branche 2) quand nécessaire.
    if (
      record &&
      (!record.tome_number || !record.synopsis || !record.series)
    ) {
      try {
        const extras = await fetchFromOpenLibrarySearch(isbn);
        if (extras) {
          record = {
            ...record,
            tome_number: record.tome_number || extras.tome,
            synopsis: record.synopsis || extras.synopsis,
            series: record.series || extras.series,
          };
        }
      } catch (err) {
        console.warn(`[ISBN] Échec Open Library (search.json) pour ${isbn} :`, err.message);
      }
    }
    return record;
  };

  // 2) Fallback / enrichissement par Open Library — utilisé quand Google
  // Books est absent, ou quand son genre est la valeur par défaut
  // (« Bande dessinée »), c'est-à-dire NON fourni par l'API : les subjects
  // Open Library en fournissent alors un réel, et la fusion complète les
  // autres vides sans jamais écraser les valeurs déjà fournies par Google
  // Books. Quand le genre Google Books est déjà réel, aucun appel OL n'est
  // lancé (sauf série manquante, cf. branche 3).
  if (!result || genreIsDefault(result)) {
    try {
      const ol = await fetchFromOpenLibrary(isbn);
      if (ol && (hasMeta(ol) || ol.title || !genreIsDefault(ol))) {
        result = result ? mergeComicPrefill(result, ol) : ol;
      }
    } catch (err) {
      console.warn(`[ISBN] Échec Open Library pour ${isbn} :`, err.message);
    }
  } else if (result && !result.series) {
    // 3) Fiche utilisable mais SANS série (cas fréquent : « Titre d'album »
    // seul, ou « Série, tome N »…). On interroge Open Library UNIQUEMENT
    // pour récupérer sa série (subject « series: ») sans toucher aux autres
    // champs fournis par Google Books.
    try {
      const ol = await fetchFromOpenLibrary(isbn);
      if (ol && String(ol.series || '').trim()) {
        result = { ...result, series: String(ol.series).trim() };
      }
    } catch (err) {
      /* Aucune série fournie : on conserve la fiche telle quelle. */
    }
  }

  // 4) Complément /search.json : le n° de tome et la description (synopsis)
  // ne figurent QUE dans l'index de recherche quand /api/books les a
  // retirés du titre (« Série, tome N — Album » -> « Album »). N'est appelé
  // que si ces champs sont encore vides dans la fiche.
  if (result) {
    result = await applySearchExtras(result);
  }

  return result;
}

/**
 * Recherche TEXTUELLE multi-résultats : Google Books + Open Library en
 * CASCADE/FUSION (même philosophie que searchByIsbn, transposée à la LISTE
 * de fiches). Sert à la modale « Remplir via ISBN » quand l'ISBN / le
 * code-barres échoue : l'utilisateur saisit titre / auteur / série.
 *
 * Stratégie combinée (les deux API sont COMPLÉMENTAIRES, pas concurrentes) :
 *   1) Les deux fournisseurs sont interrogés EN PARALLÈLE (cf. corps de la
 *      fonction) : Google Books = source PRIORITAIRE (meilleur index BD de
 *      référence, couvertures nettes, champs series via volumeInfo.series),
 *      Open Library /search.json?fields=… = complément / recours — la cascade
 *      ne coûte donc aucune latence additionnelle.
 *   2) FUSION des deux listes (dédoublonnement par HOMONYMIE — ISBN commun,
 *      série+tome+album, titre en préfixe — cf. prefillsHomonymy) :
 *        - CASCADE : Google vide ou indisponible (503/429, panne réseau…) ET
 *          Open Library sans aucun document -> la liste finale est fournie
 *          PAR Open Library (et son échec absorbé renvoie [] plutôt qu'une
 *          erreur : un 200 + data: [] reste préféable à un 503 quand rien n'a
 *          été fusionné) ;
 *        - FUSION : les deux rentournent des fiches -> une fiche OL homonyme
 *          ENRICHIT la fiche Google (complétion des CHAMPS VIDES — synopsis,
 *          série, dessinateurs, éditeur, genre réel… — via mergeComicPrefill,
 *          qui conserve Google prioritaire pour chaque champ déjà rempli) et
 *          l'ISBN y est propagé quand la fiche Google n'en avait pas.
 *      L'ordre final est stable : les fiches Google restent D'ABORD (dans
 *      l'ordre de pertinence Google), les fiches Open Library s'ajoutent
 *      ensuite ; le tout est plafonné à `max` fiches.
 *
 * Robustesse : un échec Open Library ne fait JAMAIS échouer une recherche
 * déjà exploitée par Google Books (warning + liste Google intacte). En cas
 * d'échec CROISÉ VRAI — Google indisponible ET Open Library sans réponse
 * exploitable (null : panne réseau / corps illisible) — on relance l'erreur
 * EXPLICITE de Google Books : seule elle porte le code HTTP + le message
 * user-facing sécurisé (503/429/403…) géré par le contrôleur. Quand Open
 * Library a bien RÉPONDU mais n'a trouvé AUCUN document, la réponse finale
 * est 200 + [] (la recherche a fonctionné, elle n'a tout simplement rien
 * trouvé des deux côtés).
 *
 * @param {string} query mots-clés libres (« Les Démons d'Alexia … »)
 * @param {number} [max] nombre max de résultats AU TOTAL (défaut 10, borne haute 20)
 * @returns {Promise<ComicPrefill[]>} liste de fiches normalisées (mêmes champs
 *   que searchByIsbn : title, series, tome_number, authors, illustrators,
 *   publisher, release_date AAAA-MM-JJ strict, genre, synopsis, cover_image)
 *   avec `source` ∈ { 'google_books', 'open_library',
 *   'google_books+open_library' } — éventuellement VIDE si aucun volume trouvé
 *   des deux côtés (200 + [] côté contrôleur).
 * @throws {Error} requête vide / erreurs Google explicites (400/403/429/5xx)
 */
async function searchByQuery(query, max = 10) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q) throw new Error('Requête de recherche vide : indiquez un titre, un auteur ou une série.');
  // Cas d'usage : l'utilisateur colle un « isbn:978… » dans le champ texte —
  // Google Books interprète lui-même cette syntaxe en `q` ; aucun traitement
  // particulier n'est nécessaire (Open Library matche aussi l'ISBN brut,
  // cf. docblock searchOpenLibraryText).

  const limit = Math.max(1, Math.min(Number(max) || 10, 20));
  console.log(`[ISBN] searchByQuery : « ${q} » (maxResults=${limit}) via Google Books + Open Library`);

  // ---- Étapes 1+2 : Google Books + Open Library, EN PARALLÈLE. -------------
  // Les deux fournisseurs sont interrogés SIMULTANÉMENT (Promise.allSettled)
  // — la cascade « OL quand Google n'a rien renvoyé » ne coûte alors AUCUNE
  // latence additionnelle (en séquence il fallait attendre la réponse Google
  // avant de pouvoir appeler Open Library ; le pire cas cumulait deux appels
  // et leurs timeout de 15 s). Chacun est borné à `limit` dès le départ : la
  // fusion plafonnera la liste finale à `limit` fiches, ordre Google d'abord.
  //   - Google Books : source PRIORITAIRE (meilleur index BD francophone) ;
  //     son échec explicite est CONSERVÉ pour être relancé en cas d'échec
  //     croisé (message sécurisé + code HTTP gérés par le contrôleur).
  //   - Open Library : complément / secours ; son échec est déjà absorbé en
  //     null par searchOpenLibraryText (non-bloquant par contracte).
  const [gbResult, olResult] = await Promise.allSettled([
    googleBooks.searchVolumesMany(q, { maxResults: limit }),
    searchOpenLibraryText(q, limit),
  ]);

  let googleRecords = [];
  let googleError = null;
  if (gbResult.status === 'fulfilled') {
    googleRecords = gbResult.value.map((parsed) => toComicPrefillFromGoogle(parsed, ''));
  } else {
    // CASCADE : on absorbe l'échec Google ici — si Open Library ne renvoie
    // rien non plus, `googleError` est relancée en fin de fonction (message
    // explicite : quota / clé refusée / service en panne).
    googleError = gbResult.reason;
    console.warn(`[ISBN] Échec Google Books pour ${q} :`, googleError.message);
  }

  let olRecords = [];
  if (olResult.status === 'fulfilled' && Array.isArray(olResult.value)) {
    olRecords = olResult.value.filter((r) => r.title); // sans titre -> inutile au formulaire
  }

  // ---- Étape 3 : FUSION + DÉDOUBLONNAGE par homonymie. ---------------------
  // Distinction cruciale : `olResult` FULFILLED et VIDE (Open Library a bien
  // répondu « aucun document ») ≠ REJECTED/null (panne réseau, corps illisible)
  // — dans le premier cas la recherche EST réussie : 200 + data: [] est la
  // bonne réponse; dans le second, si Google Books échoue à son tour, seule sa
  // propre erreur explicite (message sécurisé + code HTTP) mérite d'être
  // remontée au contrôleur.
  const olAnswered = olResult.status === 'fulfilled';

  const merged = mergeQueryResults(googleRecords, olRecords, limit);
  console.log(
    `[ISBN] searchByQuery : « ${q} » — GB=${googleRecords.length}, OL=${olRecords.length}${olAnswered ? '' : ' (indisponible)'} -> ${merged.length} fiche(s) fusionnée(s)`
  );

  // Échec CROISÉ VRAI : Google indisponible ET Open Library SANS RÉPONSE
  // exploitée (null — réseau / corps illisible). On relance l'erreur EXPLICITE
  // de Google (statut HTTP + message user-facing déjà sécurisé) — c'est elle
  // que le contrôleur associe au code renvoyé au client ; une erreur OL brute
  // (« fetch failed », « HTTP 503 »…) n'en donnerait aucun contexte utile.
  // Quand Open Library a RÉPONDU (« aucun document » inclus) -> merged = []
  // -> 200 + [] (la recherche a fonctionné, elle n'a rien trouvé des deux côtés).
  if (merged.length === 0 && googleError && !olAnswered) {
    throw googleError;
  }

  return merged;
}

/**
 * Normalisation « compacte » pour l'homonymie : accents retirés (NFD), TOUS
 * les caractères non-alphanumériques supprimés, minuscules — même esprit que
 * `genreKey` du module (« Lanfeust de TROY » = « lanfeustdetroy »,
 * « L'Ivoire » = « livoire »). Une comparaison sur chaîne compacte ignore
 * ponctuation, guillemets et doubles espaces sans jamais tronquer.
 */
function normKeyPart(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/gi, '')
    .toLowerCase();
}

/**
 * ALBUM d'une fiche pour l'homonymie : le titre SANS son préfixe de série ni
 * sa mention de tome. Google Books catalogue souvent un volume sous la forme
 * « Série — Album » (voire « Série Tome N » seul) alors qu'Open Library renvoie
 * « Série, tome 1 — Album » : retirer LE MÊME PRÉFIXE NORMALISÉ des deux côtés
 * fait converger les formes (les albums restants sont comparés compactement).
 * En l'absence de préfixe reconnaissable dans le titre, TOUT le titre est
 * l'album.
 */
function albumOfPrefill(record) {
  const titleCompact = normKeyPart(record?.title);
  if (!titleCompact) return '';
  const seriesCompact = normKeyPart(record?.series);
  if (!seriesCompact || !titleCompact.startsWith(seriesCompact)) {
    return titleCompact; // pas de préfixe série -> le titre entier est l'album
  }
  let rest = titleCompact.slice(seriesCompact.length);
  // Mention de tome résiduelle (« …Tome 1 — Album » -> « tome1album… ») :
  // retirée — elle est déjà portée par le champ tome_number (évalué séparément),
  // ne pas la laisser biaiser la comparaison d'albums.
  return rest.replace(/^tome\d{1,3}/, '').replace(/^t\d{1,3}([^\d]|$)/, '$1').trim();
}

/**
 * Détermine si DEUX fiches décrivent le MÊME album (homonymie FORTE — un seul
 * doublon : UNE ligne, enrichie) ou la même RÉGION série/tome (homonymie
 * FAIBLE — volumes OU albums DISTINCTS d'une même série : la référence est
 * enrichie par les champs vides de l'incidente ET la ligne reste visible dans
 * la grille pour le choix utilisateur).
 *
 * HOMONYMIE FORTE (« strong ») — strict doublon :
 *   1. ISBN commun (les deux renseignés et IDENTIQUES) -> même exemplaire ;
 *      deux ISBN DIFFÉRENTS -> false (éditions/volumes distincts) ;
 *   2. sinon : même SÉRIE connue des deux côtés ET même album normalisé
 *      (albumOfPrefill — la forme « Série — Album » de Google converge avec la
 *      forme « Série, tome N — Album » d'Open Library) ;
 *   3. sans série reconnue des deux côtés : repli TITRE — un titre est le
 *      PRÉFIXE de l'autre (>= 12 caractères), la suite ne débute PAS par un
 *      chiffre ni une mention de tome (« …Tome 1 » ≠ « …Tome 10 ») et les tomes
 *      sont compatibles.
 * HOMONYMIE FAIBLE (« weak ») — même SÉRIE connue des deux côtés : tomes
 * différents, ou albums distincts/inconnus (avec au moins un tome connu).
 * @returns {'strong'|'weak'|false}
 */
function prefillsHomonymy(a, b) {
  if (!a || !b) return false;

  // ISBN commun ET identique -> MÊME exemplaire, point (homonymie FORTE). Un
  // ISBN présent d'un seul côté ne constitue PAS une preuve de distinctitude
  // non plus : on retombe sur la comparaison structurelle des metadata (c'est
  // le cas 1 des tests : GB sans ISBN + OL avec ISBN de même album -> fusion +
  // propagation d'ISBN par mergeWithIsbnPropagation).
  const aIsbn = String(a.isbn || '').replace(/[^0-9xX]/g, '');
  const bIsbn = String(b.isbn || '').replace(/[^0-9xX]/g, '');
  if (aIsbn && bIsbn) {
    return aIsbn === bIsbn ? 'strong' : false; // ISBN différents -> éditions/volumes distincts
  }

  // SÉRIE connue des deux côtés et ÉGALE : on compare le TOME puis l'ALBUM.
  const as = normKeyPart(a.series);
  const bs = normKeyPart(b.series);
  if (as && bs) {
    if (as !== bs) return false; // séries différentes -> albums distincts
    const at = normKeyPart(a.tome_number);
    const bt = normKeyPart(b.tome_number);
    if (at && bt) {
      if (at !== bt) return 'weak'; // même série, tomes DIFFÉRENTS -> les deux volumes restent visibles
    }
    const aa = albumOfPrefill(a);
    const ba = albumOfPrefill(b);
    if (aa && ba) return aa === ba ? 'strong' : (at || bt) ? 'weak' : 'strong';
    return (at || bt) ? 'weak' : false; // un album inconnu : on ne fusionne que si série+tome connus
  }

  // Séries inconnues d'au moins un côté : repli TITRE — homonymie FORTE si un
  // titre est le PRÉFIXE de l'autre (« Lanfeust de Troy Tome 1 » ⊂ « …Tome 1
  // — L'Ivoire… ») avec un préféreau substantiel (>= 12 caractères), une suite
  // qui ne débute PAS par un chiffre ni une mention de tome (« …Tome 1 » ≠
  // « …Tome 10 ») et des tomes COMPATIBLES (égaux quand les deux connus). On
  // ne monte jamais plus bas qu'à FAIBLE : les titres courts / homonymies
  // partielles resteraient distinctes -> choix utilisateur dans la grille.
  const ta = normKeyPart(a.title);
  const tb = normKeyPart(b.title);
  if (!ta || !tb) return false;
  const at = normKeyPart(a.tome_number);
  const bt = normKeyPart(b.tome_number);
  if (at && bt && at !== bt) return false;
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  if (shorter.length >= 12 && longer.startsWith(shorter)) {
    const rest = longer.slice(shorter.length);
    if (rest && !/^\d/.test(rest) && !/^tome/i.test(rest)) return 'strong';
  }
  return false;
}

/**
 * Trouve la PREMIÈRE fiche de `list` en homonymie FORTE (index renvoyé) — à
 * défaut, la PREMIÈRE en homonymie FAIBLE — sinon -1. L'ordre de la liste est
 * conservé : la priorité Google est déjà portée par l'ordre d'insertion dans
 * mergeQueryResults, pas par cette fonction.
 */
function findHomonymIndex(list, rec) {
  let weakIdx = -1;
  for (let i = 0; i < list.length; i += 1) {
    const h = prefillsHomonymy(list[i], rec);
    if (h === 'strong') return i;
    if (h === 'weak' && weakIdx === -1) weakIdx = i;
  }
  return weakIdx; // -1 si aucune homonymie (même faible)
}

/**
 * mergeComicPrefill + PROPAGATION D'ISBN : ce champ n'est PAS géré par
 * mergeComicPrefill ; les fiches Google sans ISBN sont courantes (volumeInfo.
 * isbn absente) et c'est précisément le gain d'Open Library dans ces cas — on
 * reporte l'ISBN incident sur la cible UNIQUEMENT si celle-ci n'en avait pas.
 * `source` est recomputé sur les sources RÉELLES des deux fiches : une fusion
 * OL+OL (cascade, deux works Open Library) reste bien « open_library » —
 * mergeComicPrefill posait systématiquement « google_books+open_library ».
 */
function mergeWithIsbnPropagation(primary, secondary) {
  const merged = mergeComicPrefill(primary, secondary);
  if (!String(merged.isbn || '').replace(/[^0-9xX]/g, '')) {
    const recIsbn = String(secondary?.isbn || '').replace(/[^0-9xX]/g, '');
    if (recIsbn) merged.isbn = recIsbn;
  }
  const srcA = String(primary?.source || '');
  const srcB = String(secondary?.source || '');
  const hasG = srcA.includes('google_books') || srcB.includes('google_books');
  const hasO = srcA.includes('open_library') || srcB.includes('open_library');
  merged.source =
    hasG && hasO ? 'google_books+open_library' :
    hasG ? 'google_books' :
    'open_library'; // OL seul (cascade de deux works OL) — jamais fictif
  return merged;
}

/**
 * Clé de DÉDOUBLONNAGE d'une fiche : [série | tome | ALBUM], chaque partie
 * compacte (cf. normKeyPart / albumOfPrefill) — « même clé = mêmes séries/tome/
 * album ». L'ISBN est volontairement hors clé : l'identité réelle est calculée
 * paire à paire par prefillsHomonymy dans mergeQueryResults. DeUX albums
 * DIFFÉRENTS d'une même série restent différenciés par leur album -> clés
 * distinctes -> lignes séparées dans la grille, l'utilisateur choisit.
 */
function dedupeKeyComicPrefill(record) {
  if (!record || !String(record.title || '').trim()) return '';
  return [
    normKeyPart(record.series),
    normKeyPart(record.tome_number),
    albumOfPrefill(record),
  ].join('|');
}

/**
 * FUSIONNE deux listes de ComicPrefill (Google PRIORITAIRE, OL en COMPLEMENT)
 * et plafonne à `limit` fiches. Ordre : d'abord les fiches Google (ordre de
 * pertinence GB conservé), ensuite les fiches Open Library UNIQUEMENT — une
 * fiche OL « doublonne » (même titre normalisé) enrichit la fiche déjà
 * insérée au lieu d'en dupliquer une ligne : seuls les champs VIDES sont
 * complétés (mergeComicPrefill, Google prioritaire champ par champ : un ISBN /
 * éditeur / date fournis par Google ne sont JAMAIS écrasés par Open Library),
 * et l'ISBN est PROPAGÉ depuis la fiche OL uniquement quand la fiche existante
 * n'en a pas (`source` devient alors « google_books+open_library »).
 *
 * Indexation : `keyIndex` (Map clé -> INDEX dans `out`) mémorise l'emplacement
 * de chaque fiche au moment de son insertion ; une homonyme OL est ensuite
 * localisée par index direct (`out[idx]`) enrichie IN PLACE — l'index 0 est
 * une position valide, d'où le test `=== undefined` (et non « falsy ») pour
 * distinguer « absente » de « première fiche ».
 */
function mergeQueryResults(googleRecords, olRecords, limit) {
  const out = [];

  for (const rec of [...(googleRecords || []), ...(olRecords || [])]) {
    if (!rec || !String(rec.title || '').trim()) continue; // sans titre -> inutile au formulaire

    const idx = findHomonymIndex(out, rec);
    if (idx === -1) {
      if (out.length < limit) out.push(rec); // ligne UNIQUE, plafonnée à `limit`
      continue;
    }

    // Enrichissement de la référence par les vides de l'incidente
    // (mergeWithIsbnPropagation : Google prioritaire + propagation d'ISBN).
    out[idx] = mergeWithIsbnPropagation(out[idx], rec);

    // HOMONYMIE FAIBLE uniquement : la ligne incidente est CONSERVÉE à part —
    // deux albums DISTINCTS d'une même série doivent rester visibles dans la
    // grille (cas 3 des tests unitaires) ; la FORTE, elle, n'en duplique pas.
    if (prefillsHomonymy(out[idx], rec) === 'weak' && out.length < limit) {
      out.push(rec);
    }
  }

  return out;
}

/**
 * Mapping d'un volume Google Books standardisé (googleBooksClient.js) vers une
 * fiche ComicPrefill — FACTORISATION de fetchFromGoogleBooks (le mapping y est
 * dupliqué pour respecter « le client doit rester autonome ») : en texte libre
 * on n'a PAS d'ISBN à portée (il figure dans volumeInfo.isbn, éventuellement
 * absent) -> `isbn` est laissé à la valeur passée en paramètre ('').
 */
function toComicPrefillFromGoogle(parsed, isbnValue) {
  const authorList = parsed.authors || [];

  // Auteurs : le 1er auteur = scénariste, les suivants = dessinateurs
  // (même convention d'équipe BD que fetchFromGoogleBooks).
  const authors = authorList.join(', ');
  const illustrators = authorList.length > 1 ? authorList.slice(1).join(', ') : '';

  const series = parsed.seriesInfo ? parsed.seriesInfo.name : '';
  const tomeNumber =
    (parsed.seriesInfo && parsed.seriesInfo.tomeNumber) ||
    extractTomeNumber(parsed.title, series) ||
    '';

  return {
    isbn: String(isbnValue || parsed.isbn || ''),
    title: clip(parsed.title, 512),
    series: clip(series, 512),
    tome_number: clip(tomeNumber, 50),
    authors: clip(authors, 512),
    illustrators: clip(illustrators, 512),
    publisher: clip(parsed.publisher, 512),
    release_date: normalizeReleaseDate(parsed.publishedDate),
    genre: normalizeGenre(parsed.categories) || DEFAULT_GENRE,
    synopsis: parsed.description || '',
    cover_image: parsed.coverUrl || null,
    source: 'google_books',
  };
}

/**
 * Indique si le genre d'une fiche est vide ou égal à la valeur par défaut
 * (« Bande dessinée »), c'est-à-dire NON fourni par l'API.
 */
function genreIsDefault(record) {
  if (!record) return true;
  const g = String(record.genre || '').trim();
  if (!g) return true;
  return g.toLowerCase() === DEFAULT_GENRE.toLowerCase();
}

/**
 * Fusionne une fiche Google Books (privilégiée) avec une fiche Open Library
 * de secours : chaque champ non vide d'Open Library remplit le champ vide
 * de Google Books (série, tome_number, auteurs, éditeur, date, genre,
 * synopsis, couverture). La priorité Google Books est conservée pour les
 * champs déjà renseignés — seuls les vides sont complétés. Le genre par
 * défaut de Google Books ne masque pas un genre réel d'Open Library.
 * `source` vaut alors « google_books+open_library ».
 */
function mergeComicPrefill(primary, secondary) {
  if (!primary || !secondary) return primary || secondary;
  const out = { ...primary };
  for (const key of [
    'title',
    'series',
    'tome_number',
    'authors',
    'illustrators',
    'publisher',
    'release_date',
    'genre',
    'synopsis',
    'cover_image',
  ]) {
    const pv = String(primary[key] ?? '').trim();
    const sv = String(secondary[key] ?? '').trim();
    if (!pv && sv) out[key] = sv;
  }
  if (genreIsDefault(out) && !genreIsDefault(secondary)) out.genre = secondary.genre;
  out.source = 'google_books+open_library';
  return out;
}

module.exports = {
  cleanIsbn,
  isValidIsbn,
  isbn10ToIsbn13,
  isLocalCoverPath,
  downloadCoverImage,
  searchByIsbn,
  // Recherche texte combinée Google Books + Open Library (cascade/fusion) —
  // helpers exposés pour le test unitaire de la stratégie de fusion.
  mergeQueryResults,
  dedupeKeyComicPrefill,
  toComicPrefillFromOpenLibraryDoc,
  searchByQuery,
  mergeComicPrefill,
  genreIsDefault,
  DEFAULT_CONDITION,
  DEFAULT_GENRE,
};
