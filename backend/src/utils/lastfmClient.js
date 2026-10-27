const crypto = require('crypto');
const env = require('../config/env');

// ------------------------------------------------------------
// Client API Last.fm — PRIORITÉ 1 pour :
//   - la photo / logo d'ARTISTE des disques (artist.search + artist.getInfo) ;
//   - les fiches d'ALBUM : tracklist (album.getInfo → toptracks), genres/tags
//     (tags de l'album), label (entry.label), jaquette d'album (image) et les
//     albums de l'artiste (artist.getTopAlbums — candidats « disques »).
// ------------------------------------------------------------
// Requête GET JSON : https://ws.audioscrobbler.com/2.0/?method=…&api_key=…&format=json
//   - artist.search    : recherche d'artistes par nom (limit max 50, page de 20) ;
//   - artist.getinfo   : fiche de l'artiste retenu — le champ `image` est une LISTE
//                        de { "#text", "size" } (small → extralarge) : on retient
//                        la plus grande taille disponible ;
//   - album.search     : recherche d'albums par artiste + titre (albumsearch) ;
//   - album.getInfo    : fiche de l'album — `toptracks.track` (piste : name,
//                        length en secondes), `tags.tag` (genres), `entry.label`,
//                        `image` (liste { "#text", "size" }) et `url` ;
//   - artist.getTopAlbums : liste des albums de l'artiste ({ name, url }) —
//                        interrogée avec la SIGNATURE `api_sig` quand
//                        LASTFM_SHARED_SECRET est renseignée.
// Quota standard : 20 requêtes/seconde + quota journalier par méthode.
// La clé publique (LASTFM_API_KEY) suffit pour les méthodes GET de métadonnées ;
// le secret partagé (LASTFM_SHARED_SECRET) signe la requête (`api_sig` = MD5 des
// paramètres triés + secret) : il est exploité dès qu'il est renseigné.
const LASTFM_BASE = env.lastfm.apiUrl;
const API_KEY = (env.lastfm.apiKey || '').trim();
const SHARED_SECRET = String(env.lastfm.sharedSecret || '').trim();
const USER_AGENT = env.lastfm.userAgent;

/**
 * Erreur de l'intégration Last.fm.
 * Transport un statut HTTP à renvoyer au client.
 */
class LastfmError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'LastfmError';
    this.status = status;
  }
}

/**
 * La recherche Last.fm exige une clé valide : le service n'est « configuré »
 * que si `LASTFM_API_KEY` est renseignée (et non la valeur d'exemple).
 */
function isConfigured() {
  return typeof API_KEY === 'string'
    && API_KEY.length > 0
    && !API_KEY.includes('votre-');
}

// Diagnostic au démarrage : LASTFM_SHARED_SECRET identique à LASTFM_API_KEY est
// LE symptôme du refus de la signature `api_sig` (erreur Last.fm 13) — le vrai
// secret partagé se trouve sur https://www.lastfm.com/api/account. Non bloquant :
// getJSONSigned replie alors sur le GET non signé (clé seule).
if (isConfigured() && SHARED_SECRET.length > 0 && API_KEY === SHARED_SECRET) {
  console.warn(
    "[lastfm] LASTFM_SHARED_SECRET est identique à LASTFM_API_KEY : la signature `api_sig` " +
      'sera rejetée par Last.fm (erreur 13). Requêtes repliées sur le GET non signé ' +
      '(clé seule) — renseigne le vrai secret partagé (https://www.lastfm.com/api/account).'
  );
}

/**
 * Requête GET JSON vers l'API Last.fm.
 * Les code=10 (clé invalide), 429 et erreurs génériques sont normalisés en
 * LastfmError ; le caller applique son repli (Discogs / MusicBrainz).
 * @throws {LastfmError} 404 (méthode inexistante), 429 (quota), 502 (autre échec).
 */
async function getJSON(url) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        // Identité de l'app (dernier paramètre : User-Agent + libellé) —
        // Last.fm recommande un UA identifiable ; la clé reste dans l'URL.
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new LastfmError(`Impossible de joindre l'API Last.fm (${err.message}).`, 502);
  }
  if (response.status === 429) {
    throw new LastfmError('Quota Last.fm atteint (429) : réessayez dans un instant.', 429);
  }
  // Lire le corps même en cas d'échec HTTP : Last.fm renvoie des erreurs
  // JSON { error, message } avec le code 10 pour une clé API invalide.
  let data;
  try {
    data = await response.json();
  } catch (err) {
    if (!response.ok) throw new LastfmError(`Erreur Last.fm HTTP ${response.status}.`, 502);
    throw new LastfmError(`Réponse Last.fm illisible (${err.message}).`, 502);
  }
  // Réponse d'erreur (HTTP 403/400 ou corps 200) : { "error": <code>, "message": "…" }
  if (data && typeof data.error === 'number' && data.error >= 1) {
    const detail = typeof data.message === 'string' ? ` (${data.message})` : '';
    // code=10 = clé API invalide / absente (« Invalid API key ») : le service
    // est hors-ligne — non bloquant, mais signalé net en diagnostic.
    // code=6 = signature `api_sig` invalide : LASTFM_SHARED_SECRET incohérente
    // avec LASTFM_API_KEY (compte développeur différent) — signalé explicitement.
    const message =
      data.error === 10
        ? `Clé Last.fm invalide ou absente${detail}`
        : data.error === 6
          ? `Signature Last.fm invalide (LASTFM_SHARED_SECRET incohérente avec LASTFM_API_KEY)${detail}`
          : `Erreur Last.fm ${data.error}${detail}`;
    throw new LastfmError(message, data.error === 10 || data.error === 6 ? 503 : (response.ok ? 502 : response.status));
  }
  if (!response.ok) throw new LastfmError(`Erreur Last.fm HTTP ${response.status}.`, 502);
  return data;
}

/**
 * Normalise un nom pour la comparaison exacte : minuscules, espaces réduits,
 * apostrophes typographiques harmonisées (comme normalizeArtistName de
 * musicBrainzClient.js — aligné avec l'algorithme `norm_name` des tables
 * artists/vinyls).
 */
function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    // ’ et ‘ (U+2018 / U+2019) -> apostrophe droite simple « ' »
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ');
}

/**
 * Recherche un artiste sur Last.fm par son nom :
 *   GET /2.0/?method=artist.search&artist=<nom>&api_key=<clé>&format=json
 * (limit=20, au max 1500 requêtes/jour). Privilégie la correspondance EXACTE du
 * nom normalisé ; à défaut, prend le premier résultat (l'API classe par
 * pertinence).
 * @returns {Promise<{name: string}|null>} l'artiste retenu, ou null si aucun.
 * @throws {LastfmError} 429/502… (indisponibilité de l'API).
 */
async function searchArtist(artistName) {
  const name = String(artistName || '').trim();
  if (!name || !isConfigured()) return null;
  const data = await getJSON(
    `${LASTFM_BASE}?method=artist.search&artist=${encodeURIComponent(name)}` +
    `&api_key=${encodeURIComponent(API_KEY)}&limit=20&format=json`
  );
  const matches = Array.isArray(data && data.results && data.results.artistmatch)
    ? data.results.artistmatch
    : [];
  if (matches.length === 0) return null;
  const wanted = normalizeName(name);
  const exact = matches.find((a) => a && normalizeName(a.name) === wanted);
  const pick = exact || matches[0] || null;
  return pick ? { name: String(pick.name) } : null;
}

/**
 * Récupère l'image (photo / logo) d'un artiste via :
 *   GET /2.0/?method=artist.getinfo&artist=<nom>&api_key=<clé>&format=json
 * Le champ `image` liste les rendus disponibles, du plus PETIT au plus GRAND
 * ({ "#text": <url>, "size": "small" | "medium" | "large" | "extralarge" }) :
 * on retient la plus grande taille disponible. « #text » : séquence de texte
 * XML — dans le JSON Last.fm, une image est un objet { "#text", "size" }.
 * @param {string} artistName nom exact de l'artiste tel que renvoyé par searchArtist.
 * @returns {Promise<string|null>} URL http(s) de l'image, ou null si indisponible
 *   (aucune image sur la fiche — non bloquant).
 */
async function fetchArtistImage(artistName) {
  const name = String(artistName || '').trim();
  if (!name || !isConfigured()) return null;
  let data;
  try {
    data = await getJSON(
      `${LASTFM_BASE}?method=artist.getinfo&artist=${encodeURIComponent(name)}` +
      `&api_key=${encodeURIComponent(API_KEY)}&format=json`
    );
  } catch (err) {
    console.warn(`[lastfm] artist.getinfo indisponible pour « ${name} » :`, err.message);
    return null;
  }
  const artist = data && data.artist;
  if (!artist) return null;
  const images = Array.isArray(artist.image) ? artist.image : [];
  // L'ordre d'énumération n'est pas contractuel partout : on cherche d'abord
  // les tailles grandes explicites (extralarge, puis large), et à défaut on
  // prend le DERNIER entry valide de la liste (la plus grande résolution).
  const PREFERRED_SIZES = ['extralarge', 'large'];
  for (const size of PREFERRED_SIZES) {
    const entry = images.find((i) => i && String(i.size || '').toLowerCase() === size);
    if (entry && typeof entry['#text'] === 'string' && /^https?:\/\//i.test(entry['#text'])) {
      return entry['#text'];
    }
  }
  for (let i = images.length - 1; i >= 0; i--) {
    const url = images[i] && (typeof images[i]['#text'] === 'string' ? images[i]['#text'] : '');
    if (/^https?:\/\//i.test(url)) return url;
  }
  return null;
}

// ------------------------------------------------------------
// Fiche d'ALBUM — methods album.search / album.getInfo, exploitées en
// COMPLEMENT (ou en priorité quand elle trouve la fiche) de Discogs et
// MusicBrainz lors de l'import d'un disque par artiste + titre.
// Le secret partagé (LASTFM_SHARED_SECRET) signe ces requêtes (api_sig).
// ------------------------------------------------------------

/**
 * La signature `api_sig` Last.fm est le MD5 des paramètres de requête (TRIÉS
 * par clef, clés+valeurs concaténées) suivi du secret partagé :
 *   api_sig = md5("album…Black%20Album" + "artistMetallica" + … + SHARED_SECRET)
 * Elle n'est ajoutée QUE si `LASTFM_SHARED_SECRET` est renseigné (et non la
 * valeur d'exemple) ; sinon la requête reste sans signature.
 * @param {object} params paramètres GET déjà finalisés (clé, méthode…).
 * @returns {string} query string signé (ou non).
 */
function buildQuery(params) {
  const all = { ...params };
  if (SHARED_SECRET.length > 0 && !SHARED_SECRET.includes('votre-')) {
    const signature = Object.keys(all)
      .sort()
      .map((k) => `${k}${String(all[k])}`)
      .join('') + SHARED_SECRET;
    all.api_sig = crypto.createHash('md5').update(signature, 'utf8').digest('hex');
  }
  return new URLSearchParams(all).toString();
}

/**
 * GET **signé** vers l'API Last.fm (méthodes `album.*` / `artist.getTopAlbums`) :
 * si le secret partagé est renseigné et que Last.fm REJETTE la signature
 * (`api_sig`) — erreur 13 « Invalid method signature supplied » ou 6 (secret
 * incohérent avec la clé) — la requête est rejouée SANS signature. Les méthodes
 * GET de métadonnées n'exigent en effet que `api_key` : l'intégrité de la fiche
 * est préservée même quand le .env porte un secret erroné (cas observé en
 * staging : LASTFM_SHARED_SECRET identique à LASTFM_API_KEY).
 * @param {object} params paramètres GET déjà finalisés.
 */
async function getJSONSigned(params) {
  try {
    return await getJSON(`${LASTFM_BASE}?${buildQuery(params)}`);
  } catch (err) {
    const signatureRejected = err instanceof LastfmError && (
      /erreur last\.fm (6|13)\b/i.test(err.message) ||
      /signature last\.fm invalide/i.test(err.message)
    );
    if (signatureRejected) {
      console.warn(
        `[lastfm] signature api_sig rejetée (${err.message}) : nouvel essai non signé (clé seule).`
      );
      return getJSON(`${LASTFM_BASE}?${new URLSearchParams(params).toString()}`);
    }
    throw err;
  }
}

/**
 * Récupère le texte d'un nœud Last.fm au format JSON : un élément de XML
 * simple devient une chaîne, mais selon la méthode il peut aussi être enveloppé
 * dans { "#text": "…" } (nœud avec attributs) — les deux formes sont gérées.
 */
function nodeText(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value['#text'] === 'string') return String(value['#text']).trim();
  return '';
}

/** Normalise une date Last.fm (« 20 July 1991 », « 1991 ») en YYYY-MM-DD. */
function normalizeReleaseDate(value) {
  const raw = nodeText(value);
  // Date complète (JOUR MOIS ANNÉE — mois en anglais, ex. « 20 July 1991 »).
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const full = raw.match(/\b(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{4})\b/);
  if (full && MONTHS[full[2].toLowerCase().slice(0, 3)]) {
    const month = String(MONTHS[full[2].toLowerCase().slice(0, 3)]).padStart(2, '0');
    return `${full[3]}-${month}-${String(full[1]).padStart(2, '0')}`;
  }
  // Année seule (ou extrayable d'un texte libre) : repli au 1er janvier.
  const year = raw.match(/\b(19\d{2}|20\d{2})\b/);
  return year ? `${year[1]}-01-01` : null;
}

/** Durée en secondes (ou « m:ss ») -> format « M:SS » de la tracklist. */
function formatDuration(value) {
  const raw = String(value == null ? '' : value).trim();
  if (/^\d{1,3}:\d{2}$/.test(raw)) return raw; // déjà au format « 6:42 »
  const seconds = parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * Recherche un ALBUM sur Last.fm par artiste + titre :
 *   GET /2.0/?method=album.search&artist=<nom>&album=<titre>&api_key=<clé>&format=json
 * (signée `api_sig` si LASTFM_SHARED_SECRET). Privilégie la correspondance
 * EXACTE des deux noms normalisés ; à défaut, aucun résultat n'est retenu
 * plutôt que de pré-remplir avec un album fautif (le fallback Discogs /
 * MusicBrainz garde la main).
 * @returns {Promise<{name: string, artist?: string, url: string|null}|null>}
 *   l'album retenu, ou null si aucun résultat exact.
 * @throws {LastfmError} 429/502… (indisponibilité de l'API).
 */
async function searchAlbum(artistName, albumTitle) {
  const artist = String(artistName || '').trim();
  const title = String(albumTitle || '').trim();
  if (!artist || !title || !isConfigured()) return null;
  const data = await getJSONSigned({
    method: 'album.search',
    artist,
    album: title,
    api_key: API_KEY,
    limit: 20,
    format: 'json',
  });
  const results = Array.isArray(data && data.results && data.results.album)
    ? data.results.album
    : [];
  if (results.length === 0) return null;
  // Correspondance EXACTE en priorité : le titre normalisé doit coïncider
  // (protection contre un album homonyme d'un autre artiste), et l'artiste
  // aussi quand la fiche le porte. À défaut, premier résultat par pertinence —
  // la suite (fetchAlbumInfo) ne valide QUE si le nom de l'album renvoyé
  // correspond au titre cherché : jamais de pré-remplissage fautif.
  const wantedArtist = normalizeName(artist);
  const wantedTitle = normalizeName(title);
  const exact = results.find(
    (r) =>
      r &&
      normalizeName(nodeText(r.name)) === wantedTitle &&
      (!nodeText(r.artist) || normalizeName(nodeText(r.artist)) === wantedArtist)
  );
  const pick = exact || results[0] || null;
  if (!pick) return null;
  return {
    name: nodeText(pick.name),
    artist: nodeText(pick.artist) || artist,
    url: typeof pick.url === 'string' ? pick.url : null,
  };
}

/**
 * Récupère la fiche COMPLÈTE d'un album via :
 *   GET /2.0/?method=album.getInfo&artist=<nom>&album=<titre>&api_key=<clé>&format=json
 * (signée `api_sig` si LASTFM_SHARED_SECRET) et la normalise en données de
 * pré-remplissage du formulaire disque — tracklist (toptracks, ordonnées),
 * genres (tags de l'album), label (si présent), date de sortie, URL Last.fm
 * et jaquette d'ALBUM (image `extralarge`), en plus de l'image d'artiste gérée
 * par fetchArtistImage.
 * @returns {Promise<object|null>} fiche normalisée { album_name, artist, url,
 *   label, release_date, tracklist, track_count, genres, cover_image }, ou null
 *   si Last.fm ne connaît pas cet album (non bloquant — repli Discogs/MB).
 * @throws {LastfmError} 429/502… (indisponibilité de l'API / clé invalide).
 */
async function fetchAlbumInfo(artistName, albumTitle) {
  const artist = String(artistName || '').trim();
  const title = String(albumTitle || '').trim();
  if (!artist || !title || !isConfigured()) return null;
  const data = await getJSONSigned({
    method: 'album.getInfo',
    artist,
    album: title,
    api_key: API_KEY,
    format: 'json',
  });
  const album = (data && data.album) || {};
  if (!nodeText(album.name) && !album.url) return null;
  // VALIDATION stricte : la fiche retournée doit bien porter le titre
  // demandé (last.fm résout parfois un autre album homonyme) et, si l'artiste
  // est précisé sur la fiche, son nom normalisé doit coïncider. Sinon : null
  // — les sources Discogs / MusicBrainz conservent la main (repli propre).
  if (normalizeName(nodeText(album.name)) !== normalizeName(title)) return null;
  const albumArtist = nodeText(album.artist && album.artist.name);
  if (albumArtist && normalizeName(albumArtist) !== normalizeName(artist)) return null;

  // Tracklist : `toptracks.track` (un OBJET par piste, ou un TABLEAU ;
  // `length` en secondes dans l'XML Last.fm). Format d'une ligne :
  // « titre (M:SS) » — Last.fm ne fournit pas la position physique du support.
  const trackItems = Array.isArray(album.toptracks && album.toptracks.track)
    ? album.toptracks.track
    : album.toptracks && album.toptracks.track
      ? [album.toptracks.track]
      : [];
  const lines = [];
  let trackCount = 0;
  trackItems.forEach((t) => {
    const name = nodeText(t && t.name);
    if (!name) return;
    trackCount += 1;
    const duration = formatDuration(t && (t.length || t.duration));
    lines.push(`${name}${duration ? ` (${duration})` : ''}`);
  });

  // Genres / tags musicaux : `tags.tag` (liste de { name }) — joint par « , ».
  const tagItems = Array.isArray(album.tags && album.tags.tag)
    ? album.tags.tag
    : album.tags && album.tags.tag
      ? [album.tags.tag]
      : [];
  const genres = [...new Set(
    tagItems
      .map((t) => nodeText(t && t.name))
      .filter(Boolean)
  )].join(', ');

  // Label : parfois porté par `label` (ou `entry.label`) — absent sur la
  // plupart des fiches : null dans ce cas (complété par Discogs/MusicBrainz).
  const label = nodeText(album.label || (album.entry && album.entry.label)) || null;

  // Jaquette d'ALBUM : même structure que l'image d'artiste (liste de
  // { "#text", "size" }) : on retient la plus grande résolution disponible.
  const images = Array.isArray(album.image) ? album.image : [];
  let coverImage = null;
  for (const size of ['extralarge', 'large']) {
    const entry = images.find((i) => i && String(i.size || '').toLowerCase() === size);
    if (entry && typeof entry['#text'] === 'string' && /^https?:\/\//i.test(entry['#text'])) {
      coverImage = entry['#text'];
      break;
    }
  }
  if (!coverImage) {
    for (let i = images.length - 1; i >= 0; i--) {
      const url = images[i] && (typeof images[i]['#text'] === 'string' ? images[i]['#text'] : '');
      if (/^https?:\/\//i.test(url)) { coverImage = url; break; }
    }
  }

  return {
    album_name: nodeText(album.name) || title,
    artist: nodeText(album.artist && album.artist.name) || artist,
    url: typeof album.url === 'string' ? album.url : null,
    label,
    release_date: normalizeReleaseDate(album.releasedate || album.release),
    tracklist: lines.join('\n'),
    track_count: trackCount,
    genres,
    cover_image: coverImage,
    source: 'lastfm',
  };
}

/**
 * Liste des albums les plus écoutés d'un artiste (candidats « disques » de
 * l'import par artiste) :
 *   GET /2.0/?method=artist.getTopAlbums&artist=<nom>&limit=<n>&api_key=<clé>&format=json
 * (signée `api_sig` si LASTFM_SHARED_SECRET).
 * @param {string} artistName nom de l'artiste (celui retenu par searchArtist).
 * @param {number} [limit=5] nombre d'albums maximal (1..50).
 * @returns {Promise<Array<{name: string, url: string}>>} liste (peut être vide).
 * @throws {LastfmError} 429/502… (indisponibilité de l'API).
 */
async function fetchTopAlbums(artistName, limit = 5) {
  const name = String(artistName || '').trim();
  if (!name || !isConfigured()) return [];
  const maxLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 5));
  try {
    const data = await getJSONSigned({
      method: 'artist.getTopAlbums',
      artist: name,
      api_key: API_KEY,
      limit: String(maxLimit),
      format: 'json',
    });
    const raw = Array.isArray(data && data.topalbums && data.topalbums.album)
      ? data.topalbums.album
      : data && data.topalbums && data.topalbums.album
        ? [data.topalbums.album]
        : [];
    return raw
      .map((a) => ({ name: nodeText(a && a.name), url: a && typeof a.url === 'string' ? a.url : null }))
      .filter((a) => a.name);
  } catch (err) {
    // Non bloquant : la liste des albums est un confort, pas une condition
    // de l'import (la recherche album.search reste le chemin principal).
    console.warn(`[lastfm] artist.getTopAlbums indisponible pour « ${name} » :`, err.message);
    return [];
  }
}

module.exports = {
  LastfmError,
  isConfigured,
  searchArtist,
  fetchArtistImage,
  searchAlbum,
  fetchAlbumInfo,
  fetchTopAlbums,
};
