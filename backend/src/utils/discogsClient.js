/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
const env = require('../config/env');
// Helpers de comparaison de TITRES D'ALBUM partagés avec MusicBrainz
// (mots, sans articles : le même album est référencé différemment entre les
// bases — « Black Album » / « The Black Album » / « Metallica - Black Album »).
const { albumTitleTokens, albumTitleEquals, titleContainsAll } = require('./musicBrainzClient');
const { createTtlCache } = require('./imageProcessor');

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------
// Discogs exige un jeton personnel + un User-Agent identifiable.
// Obtention du jeton : https://www.discogs.com/settings/developers
//   (« Create New Token », permission Lecture seule suffisante).
// Quota par défaut du token : 25 requêtes/min (250/min en max).
const DISCOGS_BASE = env.discogs.apiUrl;
const HEADER_TOKEN = env.discogs.token;
const USER_AGENT = env.discogs.userAgent;
const RATE_LIMIT_PER_MINUTE = env.discogs.rateLimitPerMinute;

/**
 * Erreur de l'intégration Discogs.
 * Transport un statut HTTP à renvoyer au client.
 */
class DiscogsError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'DiscogsError';
    this.status = status;
  }
}

/**
 * La recherche Discogs exige un jeton : le service n'est « configuré »
 * que si `DISCOGS_TOKEN` est renseigné (et non la valeur d'exemple).
 */
function isConfigured() {
  return typeof HEADER_TOKEN === 'string'
    && HEADER_TOKEN.trim().length > 0
    && HEADER_TOKEN !== 'votre-jeton-discogs-ici';
}

// ------------------------------------------------------------
// État de DERNIÈRE ERREUR de recherche (lecture seule du contrôleur) :
// la cascade « Last.fm -> Discogs -> MusicBrainz » de musicBrainzController
// a besoin de distinguer « Discogs inconnu du disque » (null SANS erreur) de
// « Discogs JOIGNABLE mais indisponible » (429 quota / jeton expiré / réseau)
// pour décider de l'état remonté au client ('not-found' vs 'unavailable').
// searchByQuery la met à jour en cas d'échec (non bloquant : null renvoyée).
// ------------------------------------------------------------
let DISCOGS_ERROR_LAST = null;

// ------------------------------------------------------------
// Mini file anti-débit (25 requêtes/min par défaut)
// ------------------------------------------------------------
// File de tokens (token bucket) : au maximum `rateLimitPerMinute`
// requêtes par minute. En cas de 429, on met la file au repos pendant
// `retryAfter` secondes (déduites de l'en-tête Retry-After, sinon 60 s).
let bucketTokens = RATE_LIMIT_PER_MINUTE;
let bucketAt = Date.now();
let pausedUntil = 0;

/** Attend (si nécessaire) que la file ait un jeton disponible. */
async function acquireRateToken() {
  // Respect d'un éventuel « pause » suivant 429
  let now = Date.now();
  if (now < pausedUntil) {
    await new Promise((r) => setTimeout(r, pausedUntil - now));
    now = Date.now();
  }
  // Recalcul de la file depuis la dernière recharge
  const capacity = RATE_LIMIT_PER_MINUTE;
  const refillPerMs = capacity / 60000;
  if (bucketTokens < capacity) {
    bucketTokens = Math.min(capacity, bucketTokens + (now - bucketAt) * refillPerMs);
    bucketAt = now;
  }
  if (bucketTokens >= 1) {
    bucketTokens -= 1;
    return;
  }
  // Plus aucun jeton : on attend qu'un jeton soit réapprovisionné.
  const waitMs = Math.ceil(((1 - bucketTokens) / refillPerMs));
  await new Promise((r) => setTimeout(r, waitMs));
  bucketTokens = 0;
  bucketAt = Date.now();
}

/** Met la file au repos après une 429 (durée issue de Retry-After). */
function applyThrottling(retryAfterHeader) {
  const raw = parseInt(retryAfterHeader, 10);
  const seconds = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 60) : 60;
  pausedUntil = Date.now() + seconds * 1000;
}

// ------------------------------------------------------------
// Requêtes vers l'API Discogs
// ------------------------------------------------------------

// Cache in-memory (TTL 10 min) des réponses JSON Discogs : placé AU-DESSUS
// du rate limiter — une réponse déjà en cache ne consomme AUCUN jeton de la
// file anti-débit (25 req/min), ce qui préserve le quota pour les recherches
// réellement nouvelles. Seules les réponses RÉUSSIES sont mémorisées.
const DISCOGS_JSON_CACHE = createTtlCache({ ttlMs: 10 * 60 * 1000, maxSize: 500 });

/**
 * Requête GET JSON vers l'API Discogs (authentifiée via `Authorization`).
 * @throws {DiscogsError} 401 (jeton invalide), 403 (token/permissions),
 *   429 (quota de débit atteint), 502 (autre échec en amont).
 */
async function getJSON(url) {
  if (!isConfigured()) {
    throw new DiscogsError(
      "L'intégration Discogs n'est pas configurée (DISCOGS_TOKEN manquant dans .env).",
      503
    );
  }
  const cached = DISCOGS_JSON_CACHE.get(url);
  if (cached !== undefined) return cached;
  await acquireRateToken();
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Discogs token=${HEADER_TOKEN.trim()}`,
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new DiscogsError(`Impossible de joindre l'API Discogs (${err.message}).`, 502);
  }
  if (response.status === 401) {
    // Fermeture propre du corps de réponse (fuite mémoire évitée).
    try { await response.body?.cancel(); } catch {}
    throw new DiscogsError(
      'Jeton Discogs invalide ou expiré : régénérez-le (https://www.discogs.com/settings/developers).',
      401
    );
  }
  if (response.status === 403) {
    try { await response.body?.cancel(); } catch {}
    throw new DiscogsError(
      "Accès Discogs refusé (403) : vérifiez que le token est actif et que l'application possède la permission de lecture.",
      403
    );
  }
  if (response.status === 429) {
    applyThrottling(response.headers.get('retry-after'));
    try { await response.body?.cancel(); } catch {}
    throw new DiscogsError(
      'Débit Discogs atteint (429) : réessayez dans 1 à 2 minutes.',
      429
    );
  }
  if (!response.ok) {
    try { await response.body?.cancel(); } catch {}
    throw new DiscogsError(`Erreur Discogs HTTP ${response.status}.`, 502);
  }
  const data = await response.json();
  DISCOGS_JSON_CACHE.set(url, data);
  return data;
}

// ------------------------------------------------------------
// Recherche par code-barres (EAN/UPC)
// ------------------------------------------------------------

/** Normalise une date Discogs (YYYY, YYYY-MM, YYYY-MM-DD) en YYYY-MM-DD. */
function normalizeDate(value) {
  const match = String(value || '').match(/^(\d{4})(?:-(\d{2}?))?(?:-(\d{2}?))?/);
  if (!match) return null;
  const month = (match[2] || '01').padStart(2, '0');
  const day = (match[3] || '01').padStart(2, '0');
  return `${match[1]}-${month}-${day}`;
}

/**
 * Récupère la fiche COMPLÈTE d'une release Discogs via :
 *   GET /releases/<ID>
 * L'endpoint de RECHERCHE (résultat de /database/search) ne renvoie PAS
 * la tracklist, les `labels` détaillés ni les `styles` : il faut donc un
 * second appel pour pré-remplir correctement le nombre de chansons, la
 * tracklist, le style/genre et la maison d'édition.
 * @param {number} releaseId id numérique de la release (item.id du search).
 * @returns {Promise<object|null>} release complète (artists, labels,
 *   genres, styles, year, tracks…), ou null si indisponible (non bloquant).
 */
async function fetchRelease(releaseId) {
  try {
    return await getJSON(`${DISCOGS_BASE}/releases/${encodeURIComponent(releaseId)}`);
  } catch (err) {
    // Fiche complète indisponible : on continue avec le résultat de recherche
    // (tracklist vide, label générique) — ce n'est pas bloquant.
    console.warn(`[discogs] Fiche release ${releaseId} indisponible :`, err.message);
    return null;
  }
}

/** Normalise un libellé Discogs (trim + espaces internes réduits). */
function normText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

/**
 * Construit la tracklist formatée d'une release Discogs.
 *
 * Format d'une ligne : « A1 : Blackened (6:42) » — position, titre, durée
 * entre parenthèses si disponible. La position Discogs est conservée TELLE
 * QUELLE, quel que soit le format de notation du support (« A1 »/« B2 » pour
 * un double 33 tours, « 1 »/« 2 » pour un CD, « 2:1 »/« 1.5 » pour les
 * pistes bonus…) : ne rien y reconstruire, c'est la notation réelle de la
 * jaquette. Une position absente est simplement omise (titre seul).
 *
 * Toutes les pistes sont comptées (y compris bonus/hidden) : `type_` est un
 * tag utilisateur non fiable — filtrer dessus produisait
 * « Nombre de chansons = 0 / tracklist vide » pour les releases où Discogs
 * étiquette les pistes comme « bonus ».
 *
 * Sources de pistes (ordre de priorité) :
 *  - `tracklist` : LE tableau d'origine de GET /releases/<id> —
 *    [{position, title, duration, type_}] aplati, dans l'ordre de lecture
 *    du support (A1…D3 pour un 45t double). C'est ce champ qu'il faut
 *    lire : la fiche de release Discogs ne contient PAS de champs
 *    « media » ni « tracks » ;
 *  - `media` [{tracks}] / `tracks` : replis défensifs (formes antérieures
 *    de l'API) ;
 *  - entrée du `results` de /database/search : aucun des champs ci-dessus
 *    — la tracklist est alors vide (comptage 0) : d'où le second appel
 *    GET /releases/<id> obligatoire.
 * @param {object} item release (fiche complète ou résultat de recherche).
 * @returns {{ tracklist: string, trackCount: number }} texte formaté
 *   (une piste par ligne) + nombre total de pistes.
 */
function buildTracklist(item) {
  const lines = [];
  let trackCount = 0;

  const addTrack = (position, title, duration) => {
    const titleText = normText(title);
    if (!titleText) return;
    trackCount += 1;
    const pos = normText(position);
    const dur = normText(duration);
    const head = pos ? `${pos} : ` : '';
    lines.push(`${head}${titleText}${dur ? ` (${dur})` : ''}`);
  };

  // Parcours des pistes : le tableau `tracklist` de GET /releases/<id> en
  // priorité (aplati, dans l'ordre de lecture), puis repli sur `media`
  // [{tracks}] structuré, puis le tableau `tracks` aplati.
  const sources = [];
  if (Array.isArray(item.tracklist) && item.tracklist.length > 0) {
    item.tracklist.forEach((t) => {
      if (t) sources.push(t);
    });
  }
  if (sources.length === 0 && Array.isArray(item.media) && item.media.length > 0) {
    item.media.forEach((medium) => {
      if (!medium || !Array.isArray(medium.tracks)) return;
      medium.tracks.forEach((t) => {
        if (t) sources.push(t);
      });
    });
  }
  if (sources.length === 0 && Array.isArray(item.tracks)) {
    item.tracks.forEach((t) => {
      if (t) sources.push(t);
    });
  }

  sources.forEach((t) => addTrack(t.position, t.title, t.duration));
  return { tracklist: lines.join('\n'), trackCount };
}

/**
 * Convertit une release Discogs en données de pré-remplissage
 * (shape compatible avec la fiche MusicBrainz du formulaire frontend).
 * Accepte aussi bien une entrée du `results` (recherche) qu'une fiche
 * complète (GET /releases/<id>) : les champs détaillés quand ils existent.
 * @param {object} item entrée du champ `results` de la réponse de recherche
 *   OU release complète issue de GET /releases/<id>.
 * @param {string} barcode code-barres saisi (conservé tel quel).
 */
function toPrefill(item, barcode) {
  const title = item.title || '';
  const artists = Array.isArray(item.artists) ? item.artists : [];
  const artist = artists
    .map((a) => (a ? a.name : ''))
    .filter(Boolean)
    .join(', ');

  // Maison d'édition : préférence aux `labels` détaillés de la fiche
  // complète (plus précis) ; repli sur l'ancien champ `label` générique.
  const labelNames = new Set();
  const detailedLabels = Array.isArray(item.labels) ? item.labels : [];
  detailedLabels.forEach((l) => {
    if (l && typeof l.name === 'string' && l.name) labelNames.add(l.name);
  });
  if (labelNames.size === 0 && item.label) labelNames.add(item.label);
  const label = [...labelNames].join(', ');

  // Style / genre : `genres` + `styles` (la fiche complète les fournit ;
  // la recherche ne fournit que `genre`/`genres`).
  const genreSet = new Set();
  if (Array.isArray(item.genre)) item.genre.forEach((g) => g && genreSet.add(g));
  if (Array.isArray(item.genres)) item.genres.forEach((g) => g && genreSet.add(g));
  if (Array.isArray(item.styles)) item.styles.forEach((s) => s && genreSet.add(s));
  const genre = [...genreSet].join(', ');

  // Tracklist : position réelle + titre + durée (si disponible) de toutes
  // les pistes de la fiche complète (GET /releases/<id>), au format
  // « A1 : Blackened (6:42) », quelle que soit la notation du support.
  // buildTracklist() est non bloquant : sans champs `tracklist`/`media`/
  // `tracks` (résultat de recherche seul), la tracklist est vide et le
  // comptage vaut 0.
  const { tracklist, trackCount } = buildTracklist(item);

  return {
    barcode,
    artist,
    title,
    label,
    genre,
    release_date: normalizeDate(item.year) || null,
    tracklist,
    track_count: trackCount,
    // Image : `cover_image` (haute résolution) si disponible, sinon `thumb`.
    cover_image: item.cover_image || item.thumb || null,
    // Identifiants Discogs (persistés avec le disque) :
    // id + url de la fiche release Discogs. L'API renvoie `resource_url`
    // (URL de l'API) et `uri`, mais rarement `url` : on déduit l'URL web
    // de la fiche (https://www.discogs.com/releases/<id>) quand elle manque.
    discogs_release_id: item.id || null,
    discogs_url:
      typeof item.url === 'string' && item.url
        ? item.url
        : (item.id ? `https://www.discogs.com/releases/${item.id}` : null),
    source: 'discogs',
  };
}

/**
 * Recherche d'une parution par code-barres (EAN/UPC 8 à 14 chiffres)
 * via l'endpoint de recherche Discogs :
 *   GET /database/search?barcode=<EAN>&type=release
 * puis lecture de la fiche complète pour la tracklist/styles/labels :
 *   GET /releases/<ID>
 *
 * Extraction : titre, artiste(s), label, année, genre + styles, tracklist
 * (position + titre + durée, ex. « A1 : Blackened (6:42) »), miniature,
 * id de la release et URL de la fiche Discogs.
 *
 * @returns {Promise<object>} données de pré-remplissage { barcode, artist,
 *   title, label, genre, release_date, tracklist, track_count, cover_image,
 *   discogs_release_id, discogs_url, source }
 * @throws {DiscogsError} 400 si le code est invalide, 404 si introuvable,
 *   401/403/429 selon les statuts Discogs, 502 en cas d'échec en amont.
 */
async function searchByBarcode(rawBarcode) {
  const code = String(rawBarcode || '').replace(/[^0-9]/g, '');
  if (!/^\d{8,14}$/.test(code)) {
    throw new DiscogsError(
      'Code-barres invalide : 8 à 14 chiffres attendus (EAN/UPC).',
      400
    );
  }

  const url = `${DISCOGS_BASE}/database/search?barcode=${encodeURIComponent(code)}&type=release`;
  const data = await getJSON(url);

  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length === 0) {
    throw new DiscogsError(
      `Aucun disque trouvé sur Discogs pour le code-barres ${code}.`,
      404
    );
  }

  // On part du premier résultat (id + url de la fiche), puis on complète
  // avec la fiche complète (tracklist, labels détaillés, styles).
  const best = results[0];
  const full = best && best.id ? await fetchRelease(best.id) : null;
  return toPrefill({ ...best, ...(full || {}) }, code);
}

/**
 * Recherche d'un ARTISTE (photo / logo) par son nom :
 *   GET /database/search?q=<nom>&type=artist&per_page=5
 * PRIORITÉ 2 du repli automatique d'image d'artiste (après Last.fm).
 * L'entrée de RECHERCHE porte déjà l'image (`cover_image`, miniature haute
 * résolution ; id Discogs en secours) : aucun second appel de fiche n'est
 * nécessaire. Privilégie la correspondance EXACTE du nom normalisé ; à
 * défaut, prend le premier résultat (l'API classe par pertinence).
 * @returns {Promise<{imageUrl: string|null}|null>} l'image retournée, ou null si
 *   aucun résultat (402 compris) — non bloquant pour la cascade de repli.
 * @throws {DiscogsError} 429/401/502… (indisponibilité de l'API / quota).
 */
async function searchArtist(artistName) {
  const raw = String(artistName || '').trim();
  if (!raw) return null;
  const data = await getJSON(
    `${DISCOGS_BASE}/database/search?q=${encodeURIComponent(raw)}&type=artist&per_page=5`
  );
  const items = Array.isArray(data.results) ? data.results : [];
  if (items.length === 0) return null;
  // Correspondance EXACTE du nom normalisé en priorité (la recherche Discogs est
  // un fuzz matching : « Black Sabbath Riot » peut remonter avant l'original).
  const wanted = raw.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ');
  const norm = (v) => String(v || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ');
  let pick = items.find((i) => i && norm(i.title) === wanted);
  if (!pick) pick = items[0];
  // `cover_image` : image de l'artiste (haute résolution) de l'entrée de
  // recherche — `thumb` comme secours éventuel.
  const imageUrl = String((pick && (pick.cover_image || pick.thumb)) || '');
  return imageUrl ? { imageUrl } : null;
}

/**
 * Recherche d'une PARUTION par ARTISTE + TITRE D'ALBUM (import « manuel » —
 * complément du scan EAN) :
 *   GET /database/search?q=<Artiste> <Album>&type=release&per_page=10
 * puis lecture de la fiche COMPLÈTE de la release retenue :
 *   GET /releases/<ID>  (tracklist, labels détaillés, styles).
 * Sélection du candidat : le `title` de la release doit porter le titre de
 * l'album ET le premier artiste le nom recherché (correspondances normalisées)
 * ; à défaut aucun résultat n'est retenu — jamais un album « proche » (le
 * fallback garde la main sur les autres sources).
 * @param {string} artistName nom de l'artiste.
 * @param {string} albumTitle titre de l'album.
 * @returns {Promise<object|null>} données de pré-remplissage (shape toPrefill,
 *   barcode = null), ou null si Discogs ne connaît pas le couple exact.
 * @throws {DiscogsError} 401/403/429/502 (indisponibilité / quota / jeton).
 */
async function searchArtistAlbum(artistName, albumTitle) {
  const artist = normText(artistName);
  const title = normText(albumTitle);
  if (!artist || !title || !isConfigured()) return null;
  const data = await getJSON(
    `${DISCOGS_BASE}/database/search?q=${encodeURIComponent(`${artist} ${title}`)}&type=release&per_page=10`
  );
  const items = (Array.isArray(data.results) ? data.results : []).filter(Boolean);
  if (items.length === 0) return null;
  // Comparaisons de titres via les helpers partagés (musicBrainzClient.js) ;
  // l'artiste est comparé minuscules + apostrophes harmonisées (mêmes règles
  // que searchArtist plus haut).
  const norm = (v) => String(v || '').toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ');
  const wantArtist = norm(artist);
  const wantTokens = albumTitleTokens(title);
  // L'entrée de recherche Discogs ne porte PAS toujours `artists` (compilations)
  // : on déduit alors l'artiste du libellé « Artiste - Album » quand il existe.
  const artistNamesOf = (i) => {
    const list = (Array.isArray(i.artists) ? i.artists : []).map((a) => norm(a && a.name)).filter(Boolean);
    if (list.length === 0 && typeof i.title === 'string') {
      const dash = i.title.indexOf(' - ');
      if (dash > 0) list.push(i.title.slice(0, dash).toLowerCase().replace(/[\u2018\u2019]/g, "'").trim());
    }
    return list;
  };
  // Sélection en 3 paliers — jamais un album approximatif sans indication :
  //   1. TITRE exactement égal (mots, sans articles) + artiste connu (liste
  //      `artists` ou déduit du libellé « Artiste - Album ») ;
  //   2. le titre de la release CONTIENT tous les mots saisis (sans articles)
  //      — versions remaster / éditions live (« Metallica - Black Album »,
  //      « … 1991 »), l'artiste étant préféré quand il est connu ;
  //   3. premier résultat CLASSÉ par pertinence, artiste exact requis, et au
  //      moins 3 mots communs non neutres avec le titre saisi (sécurité anti
  //      faux positif — « Metallica - Metallica » ≠ « Black Album »).
  const pick =
    items.find(
      (i) => albumTitleEquals(i.title, wantTokens) && (!artistNamesOf(i).length || artistNamesOf(i).includes(wantArtist))
    ) ||
    items.find(
      (i) => titleContainsAll(albumTitleTokens(i.title), wantTokens) && (!artistNamesOf(i).length || artistNamesOf(i).includes(wantArtist))
    ) ||
    (() => {
      const first = items[0];
      if (!first) return null;
      if (artistNamesOf(first).length && !artistNamesOf(first).includes(wantArtist)) return null;
      const shared = albumTitleTokens(first.title).filter((t) => wantTokens.includes(t));
      return shared.length >= 3 ? first : null;
    })() ||
    null;
  if (!pick) return null;
  // Fiche complète de la release retenue : tracklist, labels détaillés,
  // styles (l'entrée de recherche seule ne porteraient que le genre).
  const full = pick.id ? await fetchRelease(pick.id) : null;
  const prefill = toPrefill({ ...pick, ...(full || {}) }, null);
  return { ...prefill, barcode: null }; // import par artiste + titre : pas d'EAN.
}

/**
 * Recherche d'une PARUTION par MOTS-CLÉS LIBRES (EAN/UPC ou phrase « titre »
 * / « artiste titre ») — maillon 2 de la CASCADE PRIORITAIRE
 * (1. Last.fm -> 2. DISCOGS -> 3. MusicBrainz), commun à l'import par
 * code-barres et à la recherche par mots-clés du contrôleur :
 *   GET /database/search?q=<chaîne>&type=release&per_page=10
 * (le paramètre `barcode` est déjà exploité par searchByBarcode). La chaîne
 * est passée telle quelle : l'API Discogs recherche simultanément titre,
 * artiste, label — c'est le « fuzzer » de secours quand Last.fm ne trouve rien.
 * Candidat retenu : premier résultat de la recherche CLASSÉE par pertinence
 * (fiche complète GET /releases/<id> pour la tracklist / labels / genres).
 * PANNES NON BLOQUANTES (quota 429, jeton expiré, réseau) : `null` — la
 * cascade retombe alors sur MusicBrainz (jamais d'exception non classée), et
 * l'erreur est journalisée côté contrôleur pour les avertissements.
 * @param {string} query chaîne libre (≥ 2 caractères).
 * @returns {Promise<object|null>} fiche Discogs normalisée (shape toPrefill,
 *   barcode conservé si la saisie était un EAN), ou null (non bloquant —
 *   DISCOGS_ERROR_LAST porte l'erreur éventuelle pour le contrôleur).
 */
async function searchByQuery(rawQuery) {
  const queryText = String(rawQuery || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!queryText || !isConfigured()) return null;

  let data;
  DISCOGS_ERROR_LAST = null;
  try {
    data = await getJSON(
      `${DISCOGS_BASE}/database/search?q=${encodeURIComponent(queryText)}&type=release&per_page=10`
    );
  } catch (err) {
    // Non bloquant : quota Discogs (25 req/min), jeton expiré, réseau — la
    // cascade retombe sur MusicBrainz ; l'état 'unavailable' est remonté via
    // l'erreur journalisée par le contrôleur (voir DISCOGS_ERROR_LAST).
    DISCOGS_ERROR_LAST = err;
    console.warn('[discogs] recherche mots-clés impossible :', err.message);
    return null;
  }

  const items = (Array.isArray(data.results) ? data.results : []).filter(Boolean);
  if (items.length === 0) return null;

  // SÉLECTION du candidat — le premier résultat CLASSÉ par pertinence est la
  // référence (search classant titre + artiste + label) ; si la saisie était
  // un EAN/UPC, on privilégie le résultat dont LE code-barres coïncide.
  const isBarcode = /^\d{8,14}$/.test(queryText);
  const pick =
    (isBarcode
      ? items.find((i) => /^\d{8,14}$/.test(i && String(i.barcode || '').replace(/\D/g, '')) || null)
      : null
    ) || items[0] || null;
  if (!pick) return null;

  const full = pick.id ? await fetchRelease(pick.id).catch(() => null) : null;
  return toPrefill({ ...pick, ...(full || {}) }, isBarcode ? queryText : null);
}

/**
 * Dernière ERREUR de recherche Discogs (lecture seule du contrôleur) — à
 * appelé APRÈS searchByQuery/searchByBarcode pour distinguer « inconnu »
 * (null sans erreur, état 'not-found') d'« indisponibilité » (429 quota /
 * jeton expiré / réseau, état 'unavailable' dans providers + warnings).
 */
function lastSearchError() {
  return DISCOGS_ERROR_LAST;
}

module.exports = {
  DiscogsError,
  searchByBarcode,
  searchByQuery,
  searchArtist,
  searchArtistAlbum,
  isConfigured,
  lastSearchError,
};
