/**
 * GoogleBooksClient.js — client d'API Google Books (API #1 : v1/volumes)
 * ================================================================
 * Interroge l'API Google Books de manière sécurisée et robuste, avec :
 *   - gestion de la clé API `GOOGLE_BOOKS_API_KEY` (.env) ;
 *   - recherche de volume par ISBN (fetchBookByIsbn) ;
 *   - recherche de volume par requête texte (fetchBookByQuery — sert à
 *     la recherche du VISUEL GLOBAL d'une série dans seriesService.js) ;
 *   - extraction des informations de SÉRIE (métadonnées, sinon déduction
 *     depuis le titre : « Série — Album », « Série, tome N »…) ;
 *   - gestion des images de SUBSTITUTION quand l'API ne renvoie aucune
 *     couverture (BD -> livre par défaut, série -> saga/collection).
 *
 * 🔐 CLÉ API (process.env.GOOGLE_BOOKS_API_KEY) :
 *   - présente  -> ajoutée en paramètre de requête `key=<clé>` (quotas
 *     augmentés via le projet Google Cloud associé) ;
 *   - absente   -> la requête est exécutée SANS clé, dans la limite des
 *     quotas publics anonymes (~1 000 requêtes/jour/IP), avec un avertissement.
 * La lecture se fait à CHAPPEL (process.env) : si la clé change sans
 * redémarrage (docker restart / .env rechargé), l'appel suivant voit le
 * changement sans mémoire en trop.
 *
 * ⚠ NE JAMAIS logguer ni renvoyer la clé dans une response HTTP : ici
 * elle n'apparaît que dans l'URL sortante ; les erreurs levées ne citent
 * QUE le code HTTP et le payload condensé de Google (jamais l'URL brute,
 * qui contiendrait `key=`). Voir buildErrorFromResponse().
 */

const env = require("../config/env");
const { createTtlCache } = require("./imageProcessor");

const USER_AGENT = env.books.userAgent;
const BASE_URL = "https://www.googleapis.com/books/v1";

// ------------------------------------------------------------
// Images de SUBSTITUTION (génériques) — même pattern d'assets locaux que
// l'image d'entité « no_group.jpg » des artistes : servies statiquement par
// le frontend (frontend/public/img -> /img/…) et stockées TELLES QUELLES
// dans les colonnes de la base (mêmes chemins partagés entre utilisateurs).
//   - livre/BD sans couverture     -> /img/no_title.jpg  (le seul asset local
//     « livre » disponible, idem repli des séries) ;
//   - série sans visuel global     -> /img/no_title.jpg  (meme identité visuelle
//     que SERIES_NO_TITLE_URL de seriesService.js).
// ------------------------------------------------------------
const DEFAULT_BOOK_COVER_URL = "/img/no_title.jpg";
const DEFAULT_SERIES_COVER_URL = "/img/no_title.jpg";

// ------------------------------------------------------------
// Clé API — lecture à l'appel (fallback propre sans clé)
// ------------------------------------------------------------

/**
 * Récupère la clé Google Books depuis l'environnement (process.env, chargée
 * par dotenv via config/env.js).
 * @returns {string} la clé telle quelle (peut être '' si absente de .env).
 */
function getApiKey() {
  return String(process.env.GOOGLE_BOOKS_API_KEY || "").trim();
}

/**
 * Renvoie true si la clé est définie dans .env. @returns {boolean}
 */
function hasApiKey() {
  return getApiKey().length > 0;
}

// ------------------------------------------------------------
// Utilitaires
// ------------------------------------------------------------

/**
 * Normalise un ISBN / code-barres scanner : retire tirets, espaces et tout
 * caractère non pertinent ; ne conserve que chiffres (et « X » de contrôle
 * d'un ISBN-10). "978-2-01-200865-6", " 978 2 01 …" -> "9782012008656".
 */
function cleanIsbn(isbn) {
  return isbn ? String(isbn).replace(/[^0-9xX]/g, "") : "";
}

/** Attend `ms` millisecondes. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Renvoie une URL de couverture normalisée en HTTPS (Google Books renvoie
 * parfois « http://books.google.com/… »). @returns {string|null}
 */
function forceHttps(url) {
  const raw = String(url || "").trim();
  if (!raw) return null;
  if (raw.startsWith("//")) return `https:${raw}`; // protocole-relative
  if (raw.startsWith("http://")) return `https://${raw.slice(7)}`;
  return /^https:\/\//i.test(raw) || raw.startsWith("/") ? raw : null;
}

/**
 * Construit une erreur à partir d'une réponse HTTP NON OK de Google Books,
 * avec un message explicite par code. SÉCURITÉ : la clé d'API ne doit jamais
 * fuiter dans les logs ni dans les messages renvoyés au client — on cite
 * donc seulement le code HTTP et un payload condensé de l'erreur Google
 * (éventuellement dans `err.details`) ; jamais l'URL qui contient `key=`.
 * @param {number} status code HTTP
 * @param {object|null} body réponse JSON de Google si disponible
 * @returns {Error} avec `err.status` renseigné
 */
function buildErrorFromResponse(status, body) {
  const googleMsg =
    (body &&
      typeof (body.error && body.error.message) === "string" &&
      body.error.message) ||
    "";
  let message;
  switch (status) {
    case 400:
      // « Invalid parameter », ISBN illisible, requête malformée…
      message = `Google Books : requête invalide (HTTP 400). ${googleMsg}`.trim();
      break;
    case 403:
      // Clé API refusée / non autorisée pour l'API Google Books.
      message = `Google Books : accès refusé (HTTP 403) — vérifiez que GOOGLE_BOOKS_API_KEY est valide et associée à l'API "Books" sur console.cloud.google.com. ${googleMsg}`.trim();
      break;
    case 429:
    case 503:
      // Quota dépassé (« Queries per day » / « quotaExceeded ») ou dégradation
      // Google : réessayer immédiatement n'y change rien -> on échoue vite,
      // la couche appels (isbnClient / seriesService) basculera sur le
      // fournisseur de secours (Open Library) sans latence inutile.
      message = `Google Books : quota dépassé ou service dégradé (HTTP ${status}) — réessayez plus tard ; le recours Open Library prend le relais. ${googleMsg}`.trim();
      break;
    case 500:
    case 502:
    case 504:
      message = `Google Books : erreur interne du service Google (HTTP ${status}) — réessayez dans quelques instants.`;
      break;
    default:
      message = `Google Books : réponse HTTP ${status} inattendue. ${googleMsg}`.trim();
  }
  const err = new Error(message);
  err.status = status;
  if (body) err.details = body; // diagnostic interne : N'EST JAMAIS réexpédié tel quel au client
  return err;
}

/**
 * Fetch avec un nouvel essai sur les codes TRANSITOIRES (429, 5xx, timeout) —
 * hors quota journalierGoogle (« per day » / « quotaExceeded », cf.
 * buildErrorFromResponse : échec rapide pour laisser le recours passer).
 * @param {string} url URL complète (clé éventuellement déjà en paramètre)
 * @param {{attempts?: number, delayMs?: number}} [retry]
 * @returns {Promise<Response>} la réponse OK
 */
async function fetchWithRetry(url, { attempts = 2, delayMs = 1500 } = {}) {
  let lastError = null;
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(15000),
      });
      if (response.ok) return response;

      const bodyText = await response.text().catch(() => "");
      let body = null;
      try {
        body = JSON.parse(bodyText);
      } catch (_) {
        body = { raw: bodyText.slice(0, 300) }; // payload illisible : conservé tel quel, condensé
      }

      // Quota JOURNALIER (règle à J+1) : nouvel essai inutile -> on échoue
      // directement pour que les fournisseurs de secours (Open Library) en profitent.
      if (response.status === 429 && /per[_\s]?day|quota/i.test(bodyText)) {
        throw buildErrorFromResponse(429, body);
      }

      lastError = buildErrorFromResponse(response.status, body);
      // Réessaye uniquement sur les codes transitoires (429, 5xx)
      if (response.status === 429 || response.status >= 500) {
        console.warn(`[googleBooks] HTTP ${response.status} : nouvel essai dans ${delayMs / 1000}s…`);
        await sleep(delayMs);
        continue;
      }
      throw lastError; // code ferme (400/403/429 quota) : inutile de réessayer
    } catch (err) {
      if (err && (err.name === "AbortError" || err.name === "TimeoutError")) {
        lastError = err;
        if (i < attempts - 1) {
          console.warn(`[googleBooks] Timeout : nouvel essai dans ${delayMs / 1000}s…`);
          await sleep(delayMs);
          continue;
        }
      } else if (err && typeof err.status === "number") {
        throw err; // erreur construite par buildErrorFromResponse : on la laisse remonter
      } else {
        lastError = err; // panne réseau hors ligne : un nouvel essai peut aider
        if (i < attempts - 1) {
          console.warn(`[googleBooks] Erreur réseau (${err && err.message}) : nouvel essai dans ${delayMs / 1000}s…`);
          await sleep(delayMs);
          continue;
        }
      }
    }
  }
  throw (
    lastError ||
    new Error("Google Books : tentatives épuisées sans réponse exploitable.")
  );
}

// ------------------------------------------------------------
// Appels API de base — avec la clé si disponible, sinon sans
// ------------------------------------------------------------

/**
 * Construit l'URL COMPLETE de recherche `volumes` (la clé réelle n'apparaît
 * QUE dans cette URL sortante — jamais dans un message d'erreur ou un log,
 * cf. note de sécurité d'en-tête de module).
 */
function buildVolumesUrl(queryString, maxResults, apiKey) {
  const params = [
    `q=${encodeURIComponent(queryString)}`,
    `maxResults=${maxResults}`,
  ];
  if (apiKey) params.push(`key=${encodeURIComponent(apiKey)}`);
  return `${BASE_URL}/volumes?${params.join("&")}`;
}

/**
 * Version MASQUÉE d'une URL pour la journalisation : remplace toujours la clé
 * par `***` (sécurité) et ne garde qu'un extrait de la requête lisible.
 */
function maskUrlForLog(url) {
  return url.replace(/key=[^&]*/, "key=***").slice(0, 220);
}

/**
 * Interroge `volumes` avec une requête texte libre.
 * ⚠ La requête doit être déjà encodée par l'appelant (encodeURIComponent).
 * @param {string} queryString ex : "isbn:9782012008656" (déjà nettoyée)
 * @param {{maxResults?: number}} [opts]
 * @returns {Promise<object|null>} la réponse JSON complète, ou null si AUCUN
 *   volume trouvé (items vides = ISBN inconnu : pas une erreur).
 */
// Cache in-memory (TTL 10 min) des résultats de recherche Google Books :
// une même requête (ISBN / nom de série) répétée ne re-frappe PAS l'API —
// économie de quota journalier. Le RÉSULTAT FINAL (objet data ou null « aucun
// volume ») est mémorisé, jamais la réponse brute.
const GOOGLE_BOOKS_CACHE = createTtlCache({ ttlMs: 10 * 60 * 1000, maxSize: 500 });

async function searchVolumes(queryString, { maxResults = 1 } = {}) {
  // 🔐 Clé API : présente -> paramètre `key` ; absente -> requête publique.
  const apiKey = getApiKey();
  const url = buildVolumesUrl(queryString, maxResults, apiKey);

  // Cache : un résultat déjà connu (y compris « aucun volume ») est renvoyé
  // sans nouvel appel réseau.
  const cached = GOOGLE_BOOKS_CACHE.get(url);
  if (cached !== undefined) {
    console.log(`[googleBooks] <<< cache hit pour cette requête (${maskUrlForLog(url)})`);
    return cached;
  }

  console.log(
    `[googleBooks] >>> GET ${maskUrlForLog(url)} (clé GOOGLE_BOOKS_API_KEY : ${
      apiKey ? "OUI — quotas du projet Google Cloud" : "NON — quotas publics par IP (~1000/j)"
    })`
  );

  let response;
  try {
    response = await fetchWithRetry(url, { attempts: 2, delayMs: 1500 });
  } catch (err) {
    // Quota JOURNALIER dépassé (réponse Google « consumer project_number:… » +
    // quota_limit_value) : réessayer avec la MÊME clé est inutile à l'échelle
    // de la journée. Pas de repli SANS clé non plus : le pool anonyme Google
    // renvoie lui-même un 429 quota (vérifié depuis deux réseaux distincts —
    // le « consumer » anonyme cité est celui du pool public, jamais le projet
    // de l'utilisateur). On laisse donc le fournisseur de secours (Open
    // Library) prendre le relais immédiatement, sans latence supplémentaire.
    if (err && err.status === 429) {
      const googleMsg =
        (err.details && err.details.error && err.details.error.message) || "";
      const cm = String(googleMsg).match(/consumer ?'([^']+)'/);
      const consumer = cm ? cm[1] : "?";
      console.warn(
        `[googleBooks] HTTP 429 (quota journalier, consumer=${consumer}) — ` +
          "aucun repli SANS clé (pool public Google Books lui-même en 429 quota). " +
          "Vérifier le quota « Queries per day » du projet dans console.cloud.google.com " +
          "(APIs & Services → Book Search API). Le fournisseur de secours (Open Library) prend le relais."
      );
    }
    throw err;
  }

  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object") {
    console.warn("[googleBooks] ⚠ Réponse non parsable en JSON — abandon propre.");
    return null;
  }
  // Cas normal « aucun volume » : Google renvoie `{"kind":"…","totalItems":0}`
  // SANS le tableau items (celui-ci n'est présent que si des résultats
  // existent). C'est un résultat VALIDE, pas une anomalie.
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length === 0 && !(typeof data.totalItems === "number" && data.totalItems > 0)) {
    console.log(
      `[googleBooks] <<< Réponse OK : aucun volume pour cette requête (totalItems=${
        typeof data.totalItems === "number" ? data.totalItems : 0
      })`
    );
    // « Aucun volume » est un résultat STABLE (ISBN inconnu) : on le mémorise
    // (null) pour ne pas re-frapper l'API au prochain scan du même code-barres.
    GOOGLE_BOOKS_CACHE.set(url, null);
    return null;
  }
  if (items.length < 1) {
    console.warn(
      `[googleBooks] ⚠ Réponse inattendue totalItems=${data.totalItems} sans tableau « items » : ${JSON.stringify(data).slice(0, 300)}`
    );
    return null;
  }
  const firstTitle = ((items[0].volumeInfo || {}).title || "?");
  console.log(
    `[googleBooks] <<< Réponse OK : totalItems=${data.totalItems}, 1er volume renvoyé : « ${String(firstTitle).slice(0, 80)} »`
  );
  // Résultat trouvé : on mémorise la réponse JSON complète (le cache est
  // volontairement au-dessus de l'analyse — analyzeVolume reste idempotent).
  GOOGLE_BOOKS_CACHE.set(url, data);
  return data;
}

// ------------------------------------------------------------
// Extraction du n° de tome / découpage du titre en série (utils locaux,
// dupliqués MINIMISÉS de isbnClient.js : le client doit rester autonome.
// Les heuristiques complètes (mapping genres, dates…) restent dans isbnClient.)
// ------------------------------------------------------------

/**
 * Extrait le numéro de tome d'un texte : "tome 15", "t. 8", "T9", "volume 2",
 * "n° 12", "#12", "3/5"… @returns {string} le numéro ('' si non détecté).
 */
function extractTomeNumber(...texts) {
  for (const raw of texts) {
    const s = String(raw || "").trim();
    if (!s) continue;
    // « tome 15 », « t. 8 », « volume 2 », « n° 12 »…
    let m = s.match(
      /\b(?:tome|t|volume|vol|n[°º]|numero|numéro|é?pisode|partie|part)\s*[:.#]?\s*#?\s*(\d{1,3})(?=[\s\-–—.,;:!?/]|$)/i
    );
    if (m) return m[1];
    // « Série 13: Album » — le numéro suit immédiatement un nom de série
    // (max 3 chiffres pour ne pas confondre avec une année).
    m = s.match(/\b[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’\-]{0,30}\s{1,3}(\d{1,3})\b(?=[:\s]|$)/);
    if (m) return m[1];
    // « #12 », « 3/5 »
    m = s.match(/#(\d{1,3})\b/);
    if (m) return m[1];
    m = s.match(/(\d{1,3})\s*\/\s*\d{0,3}/);
    if (m) return m[1];
    // Chiffre final en queue de chaîne (« … - 12 »)
    m = s.match(/\b(\d{1,3})$/);
    if (m) return m[1];
  }
  return "";
}

/**
 * Découpe un titre type « Série — Album », « Série : Album », « Série, Album »
 * ou « Série, tome 15 » et renvoie { series, cleanTitle, tome } (champs
 * éventuellement vides) ou null si aucune série plausible en tête de titre.
 */
function splitTitleSeries(title) {
  const s = String(title || "").trim();
  if (!s) return null;

  let m = s.match(
    /^([A-Za-zÀ-ÿ0-9'’&.\s\-]{2,60}?)\s*[–—\-:]\s+([A-Za-zÀ-ÿ0-9'’&.:\-,\s]{2,120})$/
  );
  let rest = m ? m[2] : "";
  let tome = "";
  if (!m) {
    // « Série. Album » (point de séparation)
    m = s.match(
      /^([A-Za-zÀ-ÿ0-9'’&.\s\-]{2,60}?)\.\s+([A-Za-zÀ-ÿ0-9'’&.:\-,\s]{2,120})$/
    );
    rest = m ? m[2] : "";
  }
  if (!m) {
    // « Série, tome 15 (: sous-titre)? » — toujours testé AVANT le cas générique
    m = s.match(
      /^([A-Za-zÀ-ÿ0-9'’&.\s\-]{2,60}?)\s*,\s*(?:tome|t\.?|vol\.?|volume|n[°º]|é?pisode)\b[\s.:#]*#?\s*(\d{1,3})\b\s*[–—:]?\s*(.*)$/i
    );
    rest = m && m[3] ? m[3] : "";
    tome = m ? m[2] : "";
  }
  if (!m) {
    // « Série, Album » (virgule entre série et album)
    m = s.match(
      /^([A-Za-zÀ-ÿ0-9'’&.\s\-]{2,60}?)\s*,\s+([A-Za-zÀ-ÿ0-9'’&.:\-“”\s]{2,120})$/
    );
    rest = m ? m[2] : "";
  }
  if (!m) return null;

  const candidate = m[1].trim();
  if (!candidate || /\d/.test(candidate)) return null; // « 1984 : … » n'est pas une série

  // Parenthèse seule (« (Spanish) ») : note éditoriale, pas un album.
  let cleanTitle = String(rest || "").trim();
  if (/^\([^)]*\)$/.test(cleanTitle)) cleanTitle = "";

  return { series: candidate, cleanTitle, tome };
}

// ------------------------------------------------------------
// Analyse d'un volume Google Books -> objet standardisé
// ------------------------------------------------------------

/**
 * Analyse le PREMIER volume de la réponse et construit un objet standardisé :
 *   { title, authors[], authorString, publisher, publishedDate, description,
 *     pageCount, coverUrl, categories[], seriesInfo: {name, tomeNumber},
 *     seriesCoverUrl }
 * - `coverUrl` : meilleure résolution disponible en `imageLinks`, forcée en
 *   HTTPS, AVEC image de SUBSTITUTION générique (`DEFAULT_BOOK_COVER_URL`) si
 *   Google n'offre aucune image — la colonne reste ainsi toujours renseignée.
 * - `seriesInfo.name` : métadonnée `volumeInfo.series` quand elle existe,
 *   sinon déduite du titre (découpage « Série — Album » / « Série, tome N »).
 * - `seriesCoverUrl` : visuel GLOBAL de la série, distinct de la couverture
 *   du TOME ; il est cherché via une recherche texte sur le NOM DE SÉRIE seul
 *   (jamais « série + titre d'album » : ces APIs cataloguent des albums — un
 *   tel résultat serait couvert de SA jaquette et contaminerait l'image de
 *   série). Aucun résultat -> `DEFAULT_SERIES_COVER_URL` (l'image générique
 *   d'une saga/collection).
 * @param {object} data réponse JSON de /volumes (déjà validée : items non vide)
 * @returns {Promise<object>} l'objet standardisé
 */
async function analyzeVolume(data) {
  const volume = (data.items && data.items[0]) || {};
  const info = volume.volumeInfo || {};

  // ----- titre / série ---------------------------------------------
  let title = String(info.title || "").replace(/\s+/g, " ").trim();
  let seriesName = String(info.series || "").trim();

  let tomeNumber = "";
  if (seriesName && extractTomeNumber(seriesName)) {
    // La mention de série porte le n° (« Série 12: Album »)
    tomeNumber = extractTomeNumber(seriesName);
  }
  if (!tomeNumber) tomeNumber = extractTomeNumber(title) || "";

  // En l'absence de métadonnée « series », on déduit la série du titre ; le n°
  // « consommé » par le découpage (« Série, tome 15 ») est rapporté ici.
  // (La variable `volume` locale sert aux deux branches : couverture, pages…)
  void volume;
  if (!seriesName) {
    const split = splitTitleSeries(title);
    if (split) {
      seriesName = split.series;
      if (!tomeNumber) tomeNumber = split.tome || "";
      // On ne remplace le titre que si l'« album » restant est réellement un
      // sous-titre (sinon : on s'en tenait à une simple mise en forme).
      const startsWithTome =
        /^(?:t\.?|tome|vol\.?|volume|n[°º]|é?pisode)[\s.]*\d/i.test(split.cleanTitle);
      if (split.cleanTitle && !startsWithTome) title = split.cleanTitle;
    }
  }

  // ----- auteurs / éditeur --------------------------------------
  const authorList = Array.isArray(info.authors)
    ? info.authors.map((a) => String(a || "").trim()).filter(Boolean)
    : [];
  const publisher = String(info.publisher || "").replace(/\s+/g, " ").trim();

  // ----- description / pages -------------------------------------------
  const description = String(
    info.description || ""
  ).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const pageCount =
    typeof info.pageCount === "number" && Number.isFinite(info.pageCount)
      ? info.pageCount
      : null;

  // ----- couverture (SUBSTITUTION si absente) -------------------------
  let coverUrl = null;
  if (info.imageLinks) {
    coverUrl =
      forceHttps(
        info.imageLinks.extraLarge ||
          info.imageLinks.large ||
          info.imageLinks.medium ||
          info.imageLinks.small ||
          info.imageLinks.thumbnail
      );
  }
  if (!coverUrl) {
    // Image de SUBSTITUTION générique : Google n'offre aucune image -> on
    // attribue l'image locale par défaut (jamais une colonne vide à l'import).
    coverUrl = DEFAULT_BOOK_COVER_URL;
  }

  // ----- catégories / genres -------------------------------------------
  const categories = Array.isArray(info.categories)
    ? info.categories.map((c) => String(c || "").trim()).filter(Boolean)
    : [];

  return {
    title,
    authors: authorList,
    authorString: authorList.join(", "),
    publisher,
    publishedDate: String(info.publishedDate || "").trim(),
    description,
    pageCount,
    coverUrl,
    categories,
    seriesInfo: {
      name: seriesName,
      tomeNumber,
      // source : "metadata" (champs Google) ou "inferred" (découpage du titre)
      source: info.series ? "metadata" : "inferred",
    },
  };
}

/**
 * Recherche via l'API un VISUEL GLOBAL pour le NOM DE SÉRIE seul et renvoie
 * le 1er visuel exploitable (meilleure résolution, HTTPS).
 * ⚠ Recherche portée par LE NOM DE SÉRIE UNIQUEMENT (jamais + titre du tome) :
 * voir le bandeau au-dessus d'analyzeVolume — un résultat issu du titre d'un
 * album ferait revenir SA jaquette, qui dupliquerait la couverture dans la
 * colonne series_image. Non bloquant : AUCUNE erreur ne remonte (null).
 * @param {string} seriesName nom de la série (déjà déterminé)
 * @returns {Promise<string|null>} URL https exploitable, ou null.
 */
async function fetchSeriesCoverUrl(seriesName) {
  const name = String(seriesName || "").trim();
  if (!name) return null;
  try {
    const data = await searchVolumes(name, { maxResults: 5 });
    if (!data) return null;
    for (const item of data.items || []) {
      const links = item && item.volumeInfo && item.volumeInfo.imageLinks;
      if (!links) continue;
      const cover = forceHttps(
        links.extraLarge || links.large || links.medium || links.small || links.thumbnail
      );
      if (cover) return cover;
    }
    return null;
  } catch (err) {
    // Non bloquant : panne API / quota ne doit JAMAIS échouer l'import.
    console.warn(
      `[googleBooks] Visuel de série introuvable pour « ${name} » : ${err.message}`
    );
    return null;
  }
}

// ------------------------------------------------------------
// FONCTIONS PUBLIQUES
// ------------------------------------------------------------

/**
 * Recherche un livre/BD par son ISBN (code-barres).
 * Étape 1 : normalisation de l'ISBN (tirets / espaces retirés).
 * Étape 2 : requête `https://www.googleapis.com/books/v1/volumes?q=isbn:<cleanIsbn>`
 *           (+ paramètre `key` si GOOGLE_BOOKS_API_KEY est définie, sinon requête publique).
 * Étape 3 : erreurs HTTP explicites et sécurisées (400/403/429/5xx) ;
 *           ISBN inconnu (items vides) -> null SANS erreur : l'appelant
 *           (isbnController / isbnClient) gère le recours / la réponse 404.
 * Étape 4 : extraction des informations de série + image de SUBSTITUTION
 *           générique si aucune couverture n'est renvoyée.
 * @param {string} isbn ISBN brut (format libre : tirets, espaces autorisés)
 * @returns {Promise<object|null>} objet standardisé ({ title, authors, … }
 *   cf. analyzeVolume), ou null si aucun volume trouvé pour cet ISBN.
 * @throws {Error} erreurs explicites : ISBN vide, requête invalide (400),
 *   clé refusée (403), quota dépassé (429), service en panne (5xx)…
 */
async function fetchBookByIsbn(isbn) {
  // ⚠ NOMMAGE CRITIQUE : la variable locale ne doit PAS s'appeler « cleanIsbn » —
  // cela OMBRAGERAIT (shadow) la fonction `cleanIsbn()` déclarée plus haut dans
  // le module et lancerait une erreur TDZ « Cannot access 'cleanIsbn' before
  // initialization » à CHAQUE import par ISBN (erreur silencieusement absorbée
  // par le recours Open Library : toute la chaîne Google Books était hors service).
  const cleanedIsbn = cleanIsbn(isbn); // retire tirets et espaces
  if (!cleanedIsbn || cleanedIsbn.length < 10) {
    throw new Error(
      "ISBN manquant ou trop court : format attendu 13 chiffres (ISBN-13) ou 10 caractères (ISBN-10)."
    );
  }

  const data = await searchVolumes(`isbn:${cleanedIsbn}`, { maxResults: 1 });
  if (!data) return null; // ISBN inconnu -> pas d'erreur, l'appelant gère le recours

  const parsed = await analyzeVolume(data);

  // ----- informations de SÉRIE + image de substitution de série --------
  parsed.isbn = cleanedIsbn; // ISBN normalisé (retour utile pour l'import)
  let seriesCoverUrl = null;
  if (parsed.seriesInfo.name) {
    seriesCoverUrl = await fetchSeriesCoverUrl(parsed.seriesInfo.name);
    if (!seriesCoverUrl) {
      // Aucune image spécifique n'a pu être trouvée pour l'intitulé de la
      // série -> image de SUBSTITUTION générique des sagas/collections.
      seriesCoverUrl = DEFAULT_SERIES_COVER_URL;
    }
  } else {
    // Pas de série détectée : on laisse le champ vide (champs à null) mais
    // l'image par défaut EST attribuée pour que la colonne ne reste jamais
    // vide si l'appelant s'en sert tel quel (conformité « gestion d'images
    // de substitution »).
    seriesCoverUrl = DEFAULT_SERIES_COVER_URL;
  }
  parsed.seriesCoverUrl = seriesCoverUrl;

  return parsed;
}

/**
 * Recherche PLUSIEURS volumes via une requête texte libre (titre, série,
 * auteur…) — sert à la RECHERCHE PAR MOTS-CLÉS de la modale d'ajout de BD :
 * à l'opposé de fetchBookByQuery (1er résultat uniquement), renvoie la liste
 * COMPLÈTE des volumes standardisés (un pour chaque item Google) afin que
 * l'utilisateur choisisse le bon parmi plusieurs homonymes / éditions.
 * - `coverUrl` reçoit l'image de SUBSTITUTION générique quand Google n'en
 *   offre aucune (jamais de colonne vide, idem fetchBookByIsbn).
 * - `publishedDate` : format brut Google (« YYYY », « YYYY-MM », …) — la
 *   normalisation AAAA-MM-JJ STRICT est faite par isbnClient.js
 *   (normalizeReleaseDate) pour rester alignée sur l'input type="date" du
 *   frontend.
 * - L'erreur remonte TELLE QUELLE (400/403/429/5xx explicites du client) :
 *   contrairement à fetchBookByQuery (recherche de visuel non bloquante), la
 *   recherche mots-clés EST l'action demandée par l'utilisateur — le
 *   contrôleur décide du statut HTTP à renvoyer au client.
 * @param {string} searchQuery requête texte (« Les Démons d'Alexia… »…)
 * @param {{maxResults?: number}} [opts] nombre max de volumes (défaut 10)
 * @returns {Promise<object[]>} liste d'objets standardisés (cf. analyzeVolume,
 *   + `seriesCoverUrl`), éventuellement VIDE si aucun résultat ; une erreur
 *   Google (quota/4xx/5xx…) est levée telle quelle.
 */
async function searchVolumesMany(searchQuery, { maxResults = 10 } = {}) {
  const q = String(searchQuery || "").trim();
  if (!q) return [];
  // searchVolumes renvoie null (PAS un objet) quand items est vide / totalItems=0
  // — cas « aucun volume » renvoyé tel quel, PAS une erreur.
  const data = await searchVolumes(q, { maxResults }); // lève les erreurs Google
  if (!data) return [];
  const items = Array.isArray(data.items) ? data.items : [];
  const results = [];
  const seriesCovers = {}; // DEDUPLICATION des visuels de série entre items homonymes
  for (const item of items) {
    // analyzeVolume(indexData) est index-insensible (items[i] passé comme
    // « premier ») : on le réutilise tel quel pour chaque volume.
    const parsed = await analyzeVolume({ items: [item] });
    // ----- informations de SÉRIE + image de substitution de série --------
    let seriesCoverUrl;
    if (parsed.seriesInfo.name) {
      const sName = parsed.seriesInfo.name;
      if (!(sName in seriesCovers)) {
        seriesCovers[sName] =
          (await fetchSeriesCoverUrl(sName)) || DEFAULT_SERIES_COVER_URL;
      }
      seriesCoverUrl = seriesCovers[sName];
    } else {
      seriesCoverUrl = DEFAULT_SERIES_COVER_URL;
    }
    parsed.seriesCoverUrl = seriesCoverUrl;
    results.push(parsed);
  }
  return results;
}

/**
 * Recherche un volume via une requête texte libre (titre, série…) — sert à
 * la recherche d'un VISUEL GLOBAL de série (seriesService.js).
 * @param {string} searchQuery requête texte (« Asterix », « Blueberry »…)
 * @returns {Promise<object|null>} 1er objet standardisé, ou null si aucun
 *   résultat OU sur AUCUNE erreur interne (non bloquant — la couche appelante
 *   enchaîne alors ses recours et son image de repli).
 */
async function fetchBookByQuery(searchQuery) {
  const q = String(searchQuery || "").trim();
  if (!q) return null;
  try {
    const data = await searchVolumes(q, { maxResults: 1 });
    if (!data) return null;
    return await analyzeVolume(data);
  } catch (err) {
    // Non bloquant : la série est trouvée par des recours alternatifs
    // (Open Library, image de repli locale). La création n'est JAMAIS bloquée.
    console.warn(`[googleBooks] Recherche en échec (« ${q} ») : ${err.message}`);
    return null;
  }
}

module.exports = {
  // Fonctions principales (import BD par code-barres + recherche texte)
  fetchBookByIsbn,
  fetchBookByQuery,
  // Recherche texte MULTI-résultats — modale « Remplir via ISBN / mots-clés »
  searchVolumesMany,
  // Accès à la clé API (utilitaires de diagnostic / tests)
  getApiKey,
  hasApiKey,
  // Utilitaires réutilisables par isbnClient.js / seriesService.js
  analyzeVolume,
  fetchSeriesCoverUrl,
  cleanIsbn,
  extractTomeNumber,
  splitTitleSeries,
  forceHttps,
  buildErrorFromResponse,
  BASE_URL,
  // Images de SUBSTITUTION (génériques) — alignées sur les assets frontend
  DEFAULT_BOOK_COVER_URL,
  DEFAULT_SERIES_COVER_URL,
};
