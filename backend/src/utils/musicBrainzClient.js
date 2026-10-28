const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const env = require('../config/env');

// ------------------------------------------------------------
// Configuration
// ------------------------------------------------------------
// MusicBrainz n'exige AUCUN jeton : seuls un User-Agent valide
// (nom de l'app + contact) et le respect du débit (1 req/seconde
// maximum) sont attendus.
const MUSICBRAINZ_BASE = env.musicbrainz.apiUrl;
const COVERART_BASE = env.musicbrainz.coverArtUrl;
const USER_AGENT = env.musicbrainz.userAgent;

/**
 * Erreur de l'intégration MusicBrainz / Cover Art Archive.
 * Transport un statut HTTP à renvoyer au client.
 */
class MusicBrainzError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'MusicBrainzError';
    this.status = status;
  }
}

// ------------------------------------------------------------
// Requêtes vers l'API MusicBrainz
// ------------------------------------------------------------

/**
 * Requête GET JSON vers MusicBrainz (aucune authentification,
 * seul l'en-tête User-Agent est requis).
 * @throws {MusicBrainzError} en cas d'échec réseau ou de réponse en erreur.
 */
async function getJSON(url) {
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        // MusicBrainz exige un User-Agent identifiable (nom + contact)
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new MusicBrainzError(
      `Impossible de joindre l'API MusicBrainz (${err.message}).`,
      502
    );
  }
  if (response.status === 404) {
    throw new MusicBrainzError('Ressource MusicBrainz introuvable.', 404);
  }
  if (response.status === 429) {
    throw new MusicBrainzError(
      'Limite de débit MusicBrainz atteinte (429) : réessayez dans quelques instants.',
      429
    );
  }
  if (!response.ok) {
    throw new MusicBrainzError(`Erreur MusicBrainz HTTP ${response.status}.`, 502);
  }
  return response.json();
}

// ------------------------------------------------------------
// Recherche par code-barres (EAN/UPC)
// ------------------------------------------------------------

/** Normalise un code-barres : ne retient que les chiffres (8 à 14 attendus). */
function cleanBarcode(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

/**
 * Récupère le détail complet d'une release via l'endpoint de lecture :
 *   GET /ws/2/release/<MBID>?inc=recordings+genres
 * « recordings » inclut la liste des pistes de chaque support
 * (medium.tracks, avec en secours recording.title) ; « genres » porte les
 * genres proposés au niveau de la release (souvent vide : les genres
 * réels sont sur les recordings liés).
 * L'endpoint de RECHERCHE ne renvoie PAS la liste des pistes ni les
 * genres : il est donc nécessaire d'aller récupérer la fiche complète
 * avec un second appel pour pré-remplir correctement la tracklist, le
 * nombre de titres et le style/genre musical.
 * @param {string} releaseId MBID de la release.
 * @returns {Promise<object|null>} release complète (media + tracks +
 *   genres), ou null si indisponible (non bloquant).
 */
async function fetchReleaseDetails(releaseId) {
  try {
    return await getJSON(
      `${MUSICBRAINZ_BASE}/ws/2/release/${releaseId}?inc=recordings+genres&fmt=json`
    );
  } catch (err) {
    // Détails indisponibles : on continue avec la fiche de recherche seule
    // (tracklist vide, genre vide) — ce n'est pas bloquant.
    console.warn(`[musicbrainz] Détails de la release ${releaseId} indisponibles :`, err.message);
    return null;
  }
}

/**
 * Récupère la jaquette d'une release via Cover Art Archive.
 * @param {string} releaseId MBID de la release.
 * @returns {Promise<string|null>} URL https de l'image (images[0].image), ou null.
 */
async function fetchCoverArt(releaseId) {
  try {
    const response = await fetch(`${COVERART_BASE}/release/${releaseId}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const images = Array.isArray(data.images) ? data.images : [];
    const front = images[0];
    if (front && front.image) {
      let url = String(front.image);
      if (url.startsWith('http://')) url = url.replace('http://', 'https://');
      return url;
    }
  } catch (err) {
    // Pas de jaquette : on continue sans (ce n'est pas bloquant).
    console.warn(`[musicbrainz] Jaquette indisponible pour ${releaseId} :`, err.message);
  }
  return null;
}

// ------------------------------------------------------------
// Recherche d'ARTISTE (photo / logo) — utilisée à la création d'un
// nouveau disque quand l'image d'artiste n'a pas été fournie :
//   1. MusicBrainz : recherche de l'artiste par son nom -> MBID ;
//   2. Cover Art Archive : image « front » de l'artiste (photo / logo).
// ------------------------------------------------------------

/**
 * Normalise un nom d'artiste pour la comparaison / déduplication :
 * minuscules, espaces réduits, apostrophes typographiques harmonisées.
 * ⚠ Doit rester aligné avec le `norm_name` SQL de la table artists
 * (migration « artists.table » — database/migrations/008) : c'est cette
 * clé qui relie les disques à l'entité Artiste en base.
 */
function normalizeArtistName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    // ’ et ‘ (U+2018 / U+2019) -> apostrophe droite simple « ' »
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ');
}

/**
 * Mots du nom d'un ALBUM pour la comparaison inter-bases : minuscules, sans
 * ponctuation et sans articles (« The Black Album » ≡ « Black Album », et
 * « Metallica - Black Album » porte bien les mots [black album] que le
 * scanneur / la saisie utilisateur connaissent). Exporté : utilisé aussi par
 * discogsClient.js pour ses comparaisons de titres.
 */
function albumTitleTokens(raw) {
  const STOPWORDS = new Set(['the', 'a', 'an']);
  return String(raw || '')
    .toLowerCase()
    // Ponctuation / symboles remplacés par des espaces (tirets « - », /, &, …).
    .normalize('NFKD')
    .replace(/[^a-z0-9\u00c0-\u024f\s]/gi, ' ')
    .split(/\s+/)
    .filter((w) => w !== '' && !STOPWORDS.has(w));
}

/** Égalité stricte entre le titre d'une release et le titre saisi (mots
 *  triés, sans articles) : « Black Album » ≡ « The Black Album ». */
function albumTitleEquals(releaseTitle, wantTokens) {
  const key = (t) => [...albumTitleTokens(t)].sort().join(' ');
  return key(releaseTitle) === [...wantTokens].sort().join(' ');
}

/** Le titre de la release CONTIENT-IL TOUS les mots saisis (sans articles) ? */
function titleContainsAll(haystackTokens, needleTokens) {
  return needleTokens.length > 0 && needleTokens.every((t) => haystackTokens.includes(t));
}

/**
 * Recherche un artiste sur MusicBrainz par son nom :
 *   GET /ws/2/artists/?query=name:"<Nom>"&fmt=json&limit=10
 * Privilégie la correspondance EXACTE du nom normalisé ; à défaut, prend le
 * premier résultat (l'API classe par pertinence).
 * @returns {Promise<{id: string, name: string}|null>} l'artiste retenu, ou
 *   null si aucun résultat (404 MusicBrainz compris).
 * @throws {MusicBrainzError} 429/502… (indisponibilité de l'API).
 */
async function searchArtistMbid(artistName) {
  const name = String(artistName || '').trim();
  if (!name) return null;
  // JSON.stringify(name) fournit les guillemets du champ Lucene `name:"…"`.
  const url =
    `${MUSICBRAINZ_BASE}/ws/2/artists/?query=${encodeURIComponent(`name:${JSON.stringify(name)}`)}` +
    `&fmt=json&limit=10`;
  let data;
  try {
    data = await getJSON(url);
  } catch (err) {
    // Artiste inconnu de MusicBrainz (404) : résultat vide, pas une erreur.
    if (err instanceof MusicBrainzError && err.status === 404) return null;
    throw err;
  }
  const artists = Array.isArray(data.artists) ? data.artists : [];
  if (artists.length === 0) return null;
  const wanted = normalizeArtistName(name);
  const exact = artists.find((a) => a && normalizeArtistName(a.name) === wanted);
  const pick = exact || artists[0] || null;
  return pick ? { id: pick.id, name: pick.name } : null;
}

/**
 * Récupère l'image « front » (photo / logo) d'un artiste via Cover Art
 * Archive :   GET https://coverartarchive.org/artist/<MBID>
 * @returns {Promise<string|null>} URL https de l'image, ou null si
 *   indisponible (non bloquant).
 */
async function fetchArtistArtwork(artistMbid) {
  const mbid = String(artistMbid || '').trim();
  if (!mbid) return null;
  try {
    const response = await fetch(`${COVERART_BASE}/artist/${encodeURIComponent(mbid)}`, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const images = Array.isArray(data.images) ? data.images : [];
    const front = images.find((i) => i && (i.front || (i.types && i.types.front))) || images[0];
    if (front && front.image) {
      let url = String(front.image);
      if (url.startsWith('http://')) url = url.replace('http://', 'https://');
      return url;
    }
  } catch (err) {
    console.warn(`[musicbrainz] Image d'artiste indisponible pour ${mbid} :`, err.message);
  }
  return null;
}

/**
 * Recherche d'une parution par code-barres (EAN/UPC 8 à 14 chiffres)
 * via l'endpoint de recherche MusicBrainz :
 *   GET /ws/2/release/?query=barcode:<EAN>&fmt=json
 * puis lecture de la fiche complète (tracklist, genres) :
 *   GET /ws/2/release/<MBID>?inc=recordings+genres
 *
 * Extraction : titre, artiste (artist-credit), date, label (label-info),
 * style/genre, tracklist (position + titre + durée, ex.
 * « A1 : Blackened (6:42) ») + leur nombre, MBID (id).
 * La jaquette est récupérée en parallèle sur Cover Art Archive.
 *
 * @returns {Promise<object>} données de pré-remplissage { barcode, artist,
 *   title, label, genre, release_date, tracklist, track_count, cover_image,
 *   mbid, source }
 * @throws {MusicBrainzError} 400 si le code est invalide, 404 si absent,
 *   429/502 en cas d'erreur en amont.
 */
async function searchByBarcode(rawBarcode) {
  const code = cleanBarcode(rawBarcode);
  if (!/^\d{8,14}$/.test(code)) {
    throw new MusicBrainzError(
      'Code-barres invalide : 8 à 14 chiffres attendus (EAN/UPC).',
      400
    );
  }

  // 1) Recherche de la release porteuse de ce code-barres (1 appel/seconde max)
  const search = await getJSON(
    `${MUSICBRAINZ_BASE}/ws/2/release/?query=barcode:${code}&fmt=json`
  );
  // On privilégie la release dont le champ `barcode` correspond strictement
  // au code scanné (le score de la recherche n'est pas fiable à 100 %).
  const releases = (search && Array.isArray(search.releases) ? search.releases : []);
  const release =
    releases.find((r) => cleanBarcode(r && r.barcode) === code) || releases[0] || null;
  if (!release) {
    throw new MusicBrainzError(
      `Aucun disque trouvé sur MusicBrainz pour le code-barres ${code}.`,
      404
    );
  }

  // 2) MBID : fiche complète (tracklist, genres) + jaquette Cover Art
  //    Archive, en parallèle (le détail MB est nécessaire car l'endpoint
  //    de recherche ne renvoie ni tracklist ni genres).
  //    NB : l'appel détail + l'appel recherche restent chacun sous le
  //    quota de 1 req/seconde MusicBrainz (2 appels au total par lookup).
  const mbid = release.id || '';
  const [details, coverImage] = mbid
    ? await Promise.all([fetchReleaseDetails(mbid), fetchCoverArt(mbid)])
    : [null, null];

  // 3) Données de pré-remplissage : on fusionne la fiche de recherche
  //    (artist-credit, label-info, barcode) avec la fiche complète
  //    (media/tracks, genres). Les clés présentes dans `details` priment.
  return toPrefill({ ...release, ...(details || {}) }, code, coverImage, mbid);
}

/**
 * Recherche d'une PARUTION par MOTS-CLÉS LIBRES (EAN/UPC ou phrase « titre »
 * / « artiste titre ») — maillon 3 de la CASCADE PRIORITAIRE
 * (1. Last.fm -> 2. Discogs -> 3. MUSICBRAINZ), commun à l'import par
 * code-barres et à la recherche par mots-clés du contrôleur.
 *   - EAN/UPC (8-14 chiffres)  : `barcode:<code>` — le chemin exact, déjà
 *     exploité par searchByBarcode (deux appels MB + CAA, quota 1 req/s) ;
 *   - phrase libre             : Lucene `artist:"<Artiste>" AND release:"<Titre>"`
 *     quand la saisie contient deux mots ou plus (découpage premier-mot =
 *     artiste, le reste = titre — heuristique des imports manuels), sinon la
 *     release seule si c'est un titre court. Aucun résultat : null (non
 *     bloquant — le contrôleur renvoie alors le 404 final).
 * @returns {Promise<object|null>} fiche MusicBrainz normalisée (shape toPrefill,
 *   MBID, jaquette Cover Art Archive), ou null si inconnu / non configuré.
 */
async function searchByQuery(rawQuery) {
  const code = cleanBarcode(rawQuery);
  if (/^\d{8,14}$/.test(code)) {
    return searchByBarcode(code);
  }
  const queryText = String(rawQuery || '').replace(/\s+/g, ' ').trim();
  if (!queryText) return null;

  // Découpage heuristique « artiste — album » : priorité à un séparateur
  // EXPLICITE (césure em/en « — »/« – » ou trait d'union « - » entourée
  // d'espaces) — la recherche Lucene porte alors les DEUX champs nommés, bien
  // plus précise. Sinon, repli au premier mot comme artiste quand la chaîne
  // contient plusieurs mots (titre court : seul champ `release`).
  let artist = '';
  let title = queryText;
  const sep = queryText.search(/(?:\s[—–]\s|\s-\s)/);
  if (sep > 0) {
    artist = queryText.slice(0, sep).trim();
    title = queryText.slice(sep).replace(/^(?:\s[—–]\s|\s-\s)/, '').trim() || queryText;
  } else if (/\s/.test(queryText)) {
    const sp = queryText.indexOf(' ');
    artist = queryText.slice(0, sp).trim();
    title = queryText.slice(sp + 1).trim();
    if (!title) { artist = ''; title = queryText; }
  }

  let data;
  try {
    const clause = artist && title
      ? `artist:${JSON.stringify(artist)} AND release:${JSON.stringify(title)}`
      : `release:${JSON.stringify(title)}`;
    data = await getJSON(
      `${MUSICBRAINZ_BASE}/ws/2/release/?query=${encodeURIComponent(clause)}` +
        `&fmt=json&limit=10`
    );
  } catch (err) {
    // PANNES NON BLOQUANTES : la cascade est au bout du chemin (MusicBrainz =
    // dernier maillon) — l'erreur est propagée telle quelle : le contrôleur la
    // transforme en 502/429 explicite (états 'unavailable' dans providers).
    throw err;
  }

  const releases = Array.isArray(data.releases) ? data.releases : [];
  if (releases.length === 0) return null;

  // Sélection du CANDIDAT CLASSÉ N°1 par Lucene (artist-credit + titre exacts
  // déjà validés — jamais un album « proche » sans artiste).
  const creditNames = (r) =>
    Array.isArray(r && r['artist-credit'])
      ? r['artist-credit'].map((a) => a && normalizeArtistName(a.name)).filter(Boolean)
      : [];
  const wantedArtist = artist ? normalizeArtistName(artist) : '';
  const userTokens = albumTitleTokens(title);
  const candidates = releases.filter((r) => {
    if (!r || !r.title) return false;
    if (artist && creditNames(r).length > 0 && !creditNames(r).includes(wantedArtist)) return false;
    if (!userTokens.length) return false;
    return albumTitleEquals(r.title, userTokens) || titleContainsAll(albumTitleTokens(r.title), userTokens);
  });
  const pick = candidates[0] || releases[0];
  const mbid = (pick && pick.id) || '';
  const [details, coverImage] = mbid
    ? await Promise.all([fetchReleaseDetails(mbid), fetchCoverArt(mbid)])
    : [null, null];
  return toPrefill({ ...pick, ...(details || {}) }, /^\d{8,14}$/.test(code) ? code : null, coverImage, mbid);
}

/**
 * Recherche d'une PARUTION par ARTISTE + TITRE D'ALBUM (import « manuel » de
 * la fiche — complément du scan par code-barres) via l'endpoint Lucene :
 *   GET /ws/2/release/?query=artist:"<Artiste>" AND release:"<Album>"&fmt=json
 * puis lecture de la fiche complète (tracklist, genres) + jaquette Cover Art
 * Archive, exactement comme searchByBarcode. Privilégie la release dont le
 * titre normalisé correspond EXACTEMENT et dont l'artiste figure dans le
 * artist-credit ; à défaut, titre exact seul. Aucun candidat exact : null —
 * le basculement sur Last.fm / Discogs s'en charge (jamais d'album « proche »).
 * @param {string} artistName nom de l'artiste.
 * @param {string} albumTitle titre de l'album.
 * @returns {Promise<object|null>} données de pré-remplissage (shape toPrefill,
 *   barcode = null), ou null si MusicBrainz ne connaît pas le couple exact.
 * @throws {MusicBrainzError} 400 si les coordonnées sont vides, 429/502 en cas
 *   d'erreur en amont.
 */
async function searchByRelease(artistName, albumTitle) {
  const artist = String(artistName || '').trim();
  const title = String(albumTitle || '').trim();
  if (!artist || !title) {
    throw new MusicBrainzError(
      "L'artiste et le titre de l'album sont requis pour la recherche.",
      400
    );
  }
  // Champ Lucene name:"…" : JSON.stringify fournit guillemets + échappements.
  const data = await getJSON(
    `${MUSICBRAINZ_BASE}/ws/2/release/?query=${encodeURIComponent(`artist:${JSON.stringify(artist)} AND release:${JSON.stringify(title)}`)}` +
      `&fmt=json&limit=10`
  );
  const releases = Array.isArray(data.releases) ? data.releases : [];
  if (releases.length === 0) return null;
  const creditNames = (r) =>
    Array.isArray(r && r['artist-credit'])
      ? r['artist-credit'].map((a) => a && normalizeArtistName(a.name)).filter(Boolean)
      : [];
  // Sélection du candidat en 3 paliers (jamais un album approximatif sans
  // indication de l'artiste — la saisie manuelle est re-vérifiée à l'écran) :
  //   1. TITRE exact (mots comparés SANS articles : « Black Album » == « The
  //      Black Album ») + artiste présent dans l'artist-credit ;
  //   2. le titre de la release CONTIENT tous les mots de la recherche (sans
  //      articles) + artiste connu — versions live / BO / remasters inclus,
  //      les releases « Official » sont préférées ;
  //   3. résultat CLASSÉ N°1 avec artiste exact + au moins un mot commun non
  //      neutre entre le titre saisi et celui de la release.
  const wantedArtist = normalizeArtistName(artist);
  const userTokens = albumTitleTokens(title);
  const artistOkOf = (r) => {
    const names = creditNames(r);
    return names.length === 0 || names.includes(wantedArtist);
  };
  // Année de parution (pour privilégier la SORTIE ORIGINALE aux remasters /
  // rééditions quand plusieurs releases partagent le même titre exact).
  const yearOf = (r) => {
    const m = String((r && r.date) || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/);
    return m ? Number(m[1]) : 9999;
  };
  // Candidats pertinents (titre exact « mots sans articles », sinon le titre
  // CONTIENT tous les mots saisis) ET artiste connu quand l'API le précise.
  const candidates = [];
  releases.forEach((r, idx) => {
    if (!r || !r.title || !userTokens.length) return;
    if (!artistOkOf(r)) return;
    const exact = albumTitleEquals(r.title, userTokens);
    const contains = titleContainsAll(albumTitleTokens(r.title), userTokens);
    if (exact || contains) candidates.push({ r, idx, tier: exact ? 0 : 1 });
  });
  // Classement des candidats : TITRE exact d'abord, puis SORTIE LA PLUS
  // ANTICHIQUE (la parution originale — tracklist/genres/date de référence)
  // avant les remasters / rééditions, puis statut « Official », enfin l'ordre
  // d'origine de la recherche Lucene.
  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (yearOf(a.r) !== yearOf(b.r)) return yearOf(a.r) - yearOf(b.r);
    const ao = String(a.r.status || '').toLowerCase() === 'official' ? 0 : 1;
    const bo = String(b.r.status || '').toLowerCase() === 'official' ? 0 : 1;
    if (ao !== bo) return ao - bo;
    return a.idx - b.idx;
  });
  let pick = candidates.length > 0 ? candidates[0].r : null;
  // Dernier recours : premier résultat CLASSÉ avec artiste exact + au moins un
  // mot commun non neutre entre le titre saisi et celui de la release.
  if (!pick) {
    const first = releases[0];
    if (first && creditNames(first).includes(wantedArtist)) {
      const shared = albumTitleTokens(first.title).filter((t) => userTokens.includes(t));
      if (shared.length >= 1) pick = first;
    }
  }
  if (!pick) return null;
  const mbid = pick.id || '';
  const [details, coverImage] = mbid
    ? await Promise.all([fetchReleaseDetails(mbid), fetchCoverArt(mbid)])
    : [null, null];
  return toPrefill({ ...pick, ...(details || {}) }, null, coverImage, mbid);
}

/**
 * Convertit une release MusicBrainz en données de pré-remplissage
 * (shape identique à l'ancienne fiche Discogs, pour le formulaire frontend).
 * Accepte aussi bien une fiche de recherche qu'une fiche complète
 * (endpoint /ws/2/release/<id>?inc=…).
 */
function toPrefill(release, barcode, coverImage, mbid) {
  // Titre
  const title = release.title || '';

  // Artiste : release["artist-credit"] (liste de { name, artist, joinphrase })
  const artistCredit = Array.isArray(release['artist-credit'])
    ? release['artist-credit']
    : [];
  const artist = artistCredit
    .map((a) => (a && a.name) || '')
    .filter(Boolean)
    .join(', ');

  // Label : release["label-info"] (liste de { label: { name }, catalog-number })
  // ou labels : [{ name }] sur la fiche complète. On déouble par nom.
  const labelEntries = [];
  const labelInfo = Array.isArray(release['label-info']) ? release['label-info'] : [];
  labelInfo.forEach((l) => {
    if (typeof l === 'string') labelEntries.push(l);
    else if (l && l.label && l.label.name) labelEntries.push(l.label.name);
    else if (l && l.name) labelEntries.push(l.name);
  });
  if (Array.isArray(release.labels)) {
    release.labels.forEach((l) => {
      if (l && l.name) labelEntries.push(l.name);
    });
  }
  const label = [...new Set(labelEntries.filter(Boolean))].join(', ');

  // Date : release.date au format "YYYY", "YYYY-MM" ou "YYYY-MM-DD"
  const dateMatch = String(release.date || '').match(
    /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/
  );
  const releaseDate = dateMatch
    ? `${dateMatch[1]}-${dateMatch[2] || '01'}-${dateMatch[3] || '01'}`
    : null;

  // Style / genre : non retourné par l'endpoint de recherche. Sur la fiche
  // complète, il peut être sur release.genres (rarement rempli) ET surtout
  // sur chaque recording (recording.genres = [{name, count}]). On agrège
  // les genres de tous les mediums/recordings puis on les déduplique.
  const genreSet = new Set();
  const pushGenre = (g) => {
    if (!g) return;
    if (typeof g === 'string') genreSet.add(g);
    else if (g && typeof g.name === 'string' && g.name) genreSet.add(g.name);
  };
  if (Array.isArray(release.genres)) release.genres.forEach(pushGenre);
  if (Array.isArray(release.styles)) release.styles.forEach(pushGenre);
  if (Array.isArray(release.media)) {
    release.media.forEach((medium) => {
      const mediumTracks = Array.isArray(medium && medium.tracks)
        ? medium.tracks
        : Array.isArray(medium && medium['track-list'])
          ? medium['track-list']
          : [];
      mediumTracks.forEach((t) => {
        if (t && Array.isArray(t.recording && t.recording.genres)) {
          t.recording.genres.forEach(pushGenre);
        }
      });
    });
  }
  const genre = [...genreSet].join(', ');

  // Tracklist : parcours des mediums -> tracks (JSON key « tracks », non
  // « track-list »). Le titre vient de track.title, en secours
  // track.recording.title. Format (identique à l'import Discogs) : une
  // piste par ligne au format « A1 : Blackened (6:42) » — position réelle
  // du support (track.position : « A1 », « B2 », « 3 »…), titre, durée si
  // connue (recording.length en millisecondes). Une position ou une durée
  // absente est simplement omise.
  let trackCount = 0;
  const lines = [];
  const norm = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  const addTrack = (position, title, lengthMs) => {
    const titleText = norm(title);
    if (!titleText) return;
    trackCount += 1;
    let duration = '';
    if (Number.isFinite(lengthMs) && lengthMs > 0) {
      const totalSeconds = Math.round(lengthMs / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      duration = ` (${minutes}:${String(seconds).padStart(2, '0')})`;
    }
    const pos = norm(position);
    lines.push(`${pos ? `${pos} : ` : ''}${titleText}${duration}`);
  };
  if (Array.isArray(release.media)) {
    release.media.forEach((medium) => {
      const mediumTracks = Array.isArray(medium && medium.tracks)
        ? medium.tracks
        : Array.isArray(medium && medium['track-list'])
          ? medium['track-list']
          : [];
      mediumTracks.forEach((t) => {
        if (!t) return;
        addTrack(
          t.position,
          (typeof t.title === 'string' && t.title) ||
          (t.recording && typeof t.recording.title === 'string' && t.recording.title) ||
          '',
          (t.recording && Number(t.recording.length)) || null
        );
      });
    });
  }
  // Repli : release["track-list"] ou champ track-count natif.
  if (trackCount === 0 && Array.isArray(release['track-list'])) {
    release['track-list'].forEach((t) => {
      if (t) addTrack(t.position, t.title, Number(t.length));
    });
  }
  if (trackCount === 0 && Number.isFinite(release['track-count'])) {
    trackCount = release['track-count'] || 0;
  }

  return {
    barcode,
    artist,
    title,
    label,
    genre,
    release_date: releaseDate,
    tracklist: lines.join('\n'),
    track_count: trackCount,
    cover_image: coverImage || null,
    mbid: mbid || null,
    source: 'musicbrainz',
  };
}

// ------------------------------------------------------------
// Téléchargement d'une jaquette distante -> stockage local
// ------------------------------------------------------------

const MIME_TO_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/**
 * Télécharge une image distante et l'enregistre dans un sous-dossier du
 * volume de uploads. Générique : également utilisé par isbnClient.js
 * pour le téléchargement des couvertures BD (./uploads/comics).
 * @param {string} url         URL http(s) de l'image
 * @param {string} subDir      sous-dossier relatif à env.uploadDir (ex. "vinyls")
 * @param {string} [fallbackExt] extension si le Content-Type est inconnu
 * @returns {Promise<string>} chemin d'accès local "/uploads/<subDir>/<fichier>"
 * @throws {Error} si l'URL est invalide ou si le téléchargement échoue.
 */
async function downloadCoverImageToDir(url, subDir, fallbackExt = '.jpg') {
  const source = String(url || '').trim();
  if (!/^https?:\/\//i.test(source)) {
    throw new Error("URL d'image invalide.");
  }
  let response;
  try {
    response = await fetch(source, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new Error(`Téléchargement de l'image impossible (${err.message}).`);
  }
  if (!response.ok) {
    throw new Error(`Téléchargement de l'image impossible (HTTP ${response.status}).`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("Fichier d'image vide reçu.");
  }
  const contentType = (response.headers.get('content-type') || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const ext = MIME_TO_EXT[contentType] || fallbackExt;
  const filename = `cover-${crypto.randomBytes(12).toString('hex')}${ext}`;
  const dir = path.join(env.uploadDir, subDir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/${subDir}/${filename}`;
}

/**
 * Télécharge une image distante (ex. Cover Art Archive) et la stocke
 * LOCALEMENT sur le volume de uploads (./uploads/vinyls).
 * @returns {Promise<string>} chemin d'accès local "/uploads/vinyls/<fichier>"
 * @throws {MusicBrainzError} si l'URL est invalide ou si le téléchargement échoue.
 */
async function downloadRemoteCover(sourceUrl) {
  try {
    return await downloadCoverImageToDir(sourceUrl, 'vinyls');
  } catch (err) {
    throw new MusicBrainzError(
      `Téléchargement de la jaquette impossible (${err.message}).`,
      502
    );
  }
}

/**
 * L'intégration MusicBrainz ne dépend d'aucune clé : elle est toujours
 * "configurée" (le User-Agent est défini côté serveur).
 */
function isConfigured() {
  return USER_AGENT.length > 0;
}

// ------------------------------------------------------------
// Image d'ARTISTE (photo / logo) — résolution côté backend
// ------------------------------------------------------------

/**
 * Chemin local de repli : image par défaut des artistes sans photo.
 * Chemin physique de référence : C:\Users\irwin\geek0thek\img\no_group.jpg
 * (servi comme statique par le frontend, cf. frontend/public/img).
 */
const ARTIST_NO_GROUP_URL = '/img/no_group.jpg';

module.exports = {
  MusicBrainzError,
  searchByBarcode,
  searchByQuery,
  searchByRelease,
  albumTitleTokens,
  albumTitleEquals,
  titleContainsAll,
  searchArtistMbid,
  fetchArtistArtwork,
  normalizeArtistName,
  ARTIST_NO_GROUP_URL,
  downloadRemoteCover,
  downloadCoverImageToDir,
  isConfigured,
};
