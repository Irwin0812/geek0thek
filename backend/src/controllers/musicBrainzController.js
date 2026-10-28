const {
  searchByBarcode,
  searchByRelease,
  searchByQuery: searchMusicbrainzByQuery,
  MusicBrainzError,
  isConfigured,
} = require('../utils/musicBrainzClient');
const {
  searchByBarcode: searchDiscogsByBarcode,
  searchArtistAlbum: searchDiscogsByRelease,
  searchByQuery: searchDiscogsByQuery,
  DiscogsError,
  lastSearchError: discogsLastSearchError,
  isConfigured: isDiscogsConfigured,
} = require('../utils/discogsClient');
// Last.fm — SOURCE PRIORITAIRE des deux imports (scan par code-barres ET
// saisie artiste + titre) : la fiche d'album complète (tracklist toptracks,
// tags/genres, label si présent, jaquette d'ALBUM, URL) est récupérée via
// album.search → album.getInfo et prime champ par champ dans la fusion.
// Au scan EAN, Last.fm n'ayant pas d'index par code-barres, l'IDENTITÉ
// « artiste + album » de la parution est identifiée par MusicBrainz / Discogs
// (en parallèle) qui servent ensuite de PORTES D'ENTRÉE à Last.fm ; en cas
// d'échec ou d'absence de résultat Last.fm, MusicBrainz / Discogs fournissent
// alors la fiche en secours — les champs manquants sont comblés par la fusion
// (mergeResults, priorité Last.fm sur les visuels / métadonnées).
const {
  searchAlbum,
  searchAlbumsByQuery,
  searchAlbumByBarcode,
  fetchAlbumInfo,
  LastfmError,
  isConfigured: isLastfmConfigured,
} = require('../utils/lastfmClient');

// ------------------------------------------------------------
// RECHERCHE PAR MOTS-CLÉS (EAN/UPC ou « artiste titre ») — CASCADE STRICTE
//   1. LAST.FM (prioritaire, notamment pour les visuels / jaquettes)
//   2. DISCOGS (second recours)
//   3. MUSICBRAINZ (troisième recours)
// L'ordre d'INTERROGATION est celui de la priorisation métier : chaque maillon
// n'est consulté que si les précédents n'ont trouvé AUCUNE fiche valide —
// jamais d'appels en parallèle ici (contrairement au scan par code-barres, où
// l'identité « artiste + album » doit passer par les bases indexées par EAN).
// La fusion (mergeResults) conserve quand même la priorité Last.fm champ à
// champ dès qu'une seconde source complète une fiche partielle.
// ------------------------------------------------------------

/**
 * Résolution SÉQUENTIELLE des trois sources dans l'ORDRE STRICT de la cascade.
 * Chaque maillon n'est interrogé que si les précédents n'ont fourni AUCUNE
 * fiche (résultat vide OU panne : repli non bloquant). Les états 'unavailable'
 * remontent ensuite au client via providers + warnings quand une fiche existe,
 * ou en 429/502 final quand TOUTES les sources actives ont échoué.
 * @returns {Promise<{lastfm: PromiseSettledResult|null,
 *   discogs: PromiseSettledResult|null, musicbrainz: PromiseSettledResult|null,
 *   queried: { lastfm?: boolean, discogs?: boolean, musicbrainz?: boolean }}>}
 *   les résolus de la cascade + `queried` : les sources RÉELLEMENT INTERROGÉES
 *   (null / absent = non interrogée : non configurée, ou un maillon précédent a
 *   déjà fourni la fiche).
 */
async function runKeywordCascade(queryText) {
  const settled = { lastfm: null, discogs: null, musicbrainz: null };
  const queried = {};
  let found = false;

  // 1. PRIORITÉ — LAST.FM : album.search&album=<chaîne libre> (+ artist= si la
  //    saisie porte un « Artiste - Album » explicite) puis résolution des fiches
  //    complètes (album.getInfo : tracklist, genres, label, date et JAQUETTE
  //    D'ALBUM — les fiches validées sont seules conservées). `[]` = inconnu de
  //    Last.fm : la cascade ENCHAÎNE ; une panne d'infrastructure (429/502…)
  //    porte 'unavailable' et enchaîne aussi sur les secours.
  if (isLastfmConfigured()) {
    queried.lastfm = true;
    try {
      const hits = await searchAlbumsByQuery(queryText);
      found = Array.isArray(hits) && hits.length > 0;
      settled.lastfm = { status: 'fulfilled', value: found ? hits : [] };
    } catch (err) {
      console.warn('[musicbrainz keywordLookup] Recherche Last.fm impossible, repli Discogs / MusicBrainz :', err.message);
      settled.lastfm = { status: 'rejected', reason: err };
    }
  }

  // 2. SECONDE RECOURS — DISCOGS (si configuré ET si Last.fm n'a rien fourni) :
  //    /database/search?q=<chaîne>&type=release, fiche complète du premier
  //    résultat classé. Le client Discogs capture ses pannes internes (quota
  //    429, jeton expiré, réseau) et renvoie null — la cascade enchaîne sur
  //    MusicBrainz ; l'erreur portée par DISCOGS_ERROR_LAST alimente l'état
  //    'unavailable' remonté au client.
  if (!found && isDiscogsConfigured()) {
    queried.discogs = true;
    try {
      const hit = await searchDiscogsByQuery(queryText);
      found = Boolean(hit);
      settled.discogs = { status: 'fulfilled', value: hit || null };
    } catch (err) {
      // Inattendu (le client Discogs ne lève normalement pas d'exception) : la
      // cascade enchaîne sur MusicBrainz ; l'erreur porte 'unavailable'.
      console.warn('[musicbrainz keywordLookup] Recherche Discogs impossible, repli MusicBrainz :', err.message);
      settled.discogs = { status: 'rejected', reason: err };
    }
  }

  // 3. DERNIER RECOURS — MUSICBRAINZ (si Last.fm ET Discogs n'ont rien fourni) :
  //    Lucene artist:"…" AND release:"…", ou barcode:<EAN> quand la saisie est
  //    un code-barres pur (MBID + jaquette Cover Art Archive). Dernier maillon
  //    : ses erreurs NON BLOQUANTES n'ont plus de repli — elles remontent en
  //    429/502 au client si aucune source n'a fourni la fiche.
  if (!found) {
    queried.musicbrainz = true;
    try {
      const hit = await searchMusicbrainzByQuery(queryText);
      found = Boolean(hit);
      settled.musicbrainz = { status: 'fulfilled', value: hit || null };
    } catch (err) {
      console.warn('[musicbrainz keywordLookup] Recherche MusicBrainz impossible :', err.message);
      settled.musicbrainz = { status: 'rejected', reason: err };
    }
  }

  return { ...settled, queried };
}

/**
 * GET /api/musicbrainz/status
 * MusicBrainz n'exige aucun jeton d'API : le service est donc toujours
 * "configuré" (un seul User-Agent identifié est requis côté serveur).
 * L'état de Last.fm (key publique + secret partagés) et de Discogs (token)
 * est exposé pour information. Les trois sources alimentent ENSEMBLE l'import
 * disque — scan par code-barres ET saisie artiste + titre (cascade / repli
 * mutuel, cf. lookupBarcode & searchRelease).
 */
function status(req, res) {
  return res.json({
    configured: isConfigured(),
    provider: 'musicbrainz',
    // Fiche d'album + photo d'artiste PRIORITÉ 1 : actif si LASTFM_API_KEY valide.
    lastfm: { configured: isLastfmConfigured() },
    // Secours (repli de la cascade) : actif si DISCOGS_TOKEN est renseigné.
    discogs: { configured: isDiscogsConfigured() },
  });
}

// ------------------------------------------------------------
// FUSSION des fiches multi-sources (MusicBrainz + Last.fm + Discogs)
// ------------------------------------------------------------

/**
 * Concatène plusieurs listes de libellés « a, b » en une seule sans doublon
 * (comparaison insensible à la casse et aux espaces).
 */
function mergeLabels(...values) {
  const seen = new Set();
  const out = [];
  for (const v of values) {
    String(v || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((p) => {
        const k = p.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          out.push(p);
        }
      });
  }
  return out.join(', ');
}

/**
 * Fusionne les fiches des trois sources d'import disque — STRATÉGIE COMBINÉE
 * (cascade / repli, PRIORITÉ LAST.FM) :
 *   - LAST.FM (PRIORITÉ 1) : porte la fiche d'ALBUM — tracklist toptracks,
 *     tags/genres, label et date de sortie quand connus, URL de la fiche et
 *     jaquette d'ALBUM (image extralarge de album.getInfo) ; au scan EAN c'est
 *     la première source interrogée (album.search&query=<EAN> → album.getInfo) ;
 *   - MUSICBRAINZ (secours 1) : MBID + tracklist fidèle à la RELEASE EXACTE
 *     et jaquette Cover Art Archive quand Last.fm n'apporte rien ;
 *   - DISCOGS (secours 2) : labels détaillés, image HD, id release + URL.
 * Chaque champ est pris à la PREMIÈRE source de l'ordre ci-dessus qui le
 * porte ; genre ET label accumulent les libellés des sources sans doublon.
 * @returns {object|null} fiche fusionnée ({ source: 'lastfm' | 'musicbrainz'
 *   | 'discogs' | combos }), ou null si aucune source ne connaît la parution.
 */
function mergeResults(lf, mb, dg) {
  if (!lf && !mb && !dg) return null;

  // Genre : fusion Last.fm (tags d'album) + MusicBrainz + Discogs (genres +
  // styles des fiches complètes), dé-duplicés — c'est la garantie qu'un disque
  // porte ses tags musicaux même si une source est vide sur ce champ.
  const genreSet = new Set();
  [lf && lf.genres, mb && mb.genre, dg && dg.genre].forEach((v) => {
    String(v || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((g) => genreSet.add(g));
  });

  return {
    barcode: (dg && dg.barcode) || (mb && mb.barcode) || null,
    artist: (lf && lf.artist) || (mb && mb.artist) || (dg && dg.artist) || '',
    title: (lf && lf.album_name) || (mb && mb.title) || (dg && dg.title) || '',
    genre: [...genreSet].join(', '),
    // Label : Last.fm > MusicBrainz > Discogs (labels détaillés) — accumulé.
    label: mergeLabels(lf && lf.label, mb && mb.label, dg && dg.label),
    release_date:
      (lf && lf.release_date) || (mb && mb.release_date) || (dg && dg.release_date) || null,
    // Tracklist : Last.fm (toptracks ordonnées de l'album recherché) >
    // MusicBrainz (pistes de la RELEASE EXACTE) > Discogs (fiche complète).
    // Même format « A1 : Blackened (6:42) » / « Titre » que le reste de
    // l'application — les durées Last.fm sont dans l'ordre toptracks.
    tracklist: (lf && lf.tracklist) || (mb && mb.tracklist) || (dg && dg.tracklist) || '',
    track_count:
      Number(lf && lf.track_count) || Number(mb && mb.track_count) || Number(dg && dg.track_count) || 0,
    // Jaquette : LAST.FM (image extralarge de album.getInfo — prioritaire,
    // conformément à la nouvelle stratégie) > Cover Art Archive (MB) >
    // Discogs (cover_image HD). La URL retenue est téléchargée au stockage de
    // la ligne vinyle (resolveCover -> uploadDir/vinyls) puis associée au disque.
    cover_image:
      (lf && lf.cover_image) || (mb && mb.cover_image) || (dg && dg.cover_image) || null,
    // Identifiants persistés avec le disque (DTO / colonnes).
    mbid: (mb && mb.mbid) || null,
    discogs_release_id: (dg && dg.discogs_release_id) || null,
    discogs_url: (dg && dg.discogs_url) || null,
    // URL de la fiche Last.fm (lien « Fiche Last.fm ↗ » optionnel du formulaire).
    lastfm_url: (lf && lf.url) || null,
    // Source(s) ayant réellement alimenté la fiche : 'lastfm+musicbrainz+discogs'.
    source: [lf && 'lastfm', mb && 'musicbrainz', dg && 'discogs']
      .filter(Boolean)
      .join('+'),
  };
}

/**
 * Évalue l'état d'une source à partir de son résolu Promise.allSettled :
 *   "found" | "not-found" (404 = inconnu de la source, NON bloquant)
 *   | "unavailable" (tout autre échec : quota 429, 502, clé invalide…);
 * `settled` null = source non interrogée (non configurée) -> 'not-found'.
 * @param {PromiseSettledResult|null} settled résultat allSettled (ou null).
 * @param {Function|undefined} ErrorClass classe d'erreur du client concerné.
 */
function sourceState(settled, ErrorClass) {
  if (!settled) return 'not-found';
  if (settled.status === 'fulfilled') return settled.value ? 'found' : 'not-found';
  const err = settled.reason;
  if (err && ErrorClass && err instanceof ErrorClass && err.status === 404) return 'not-found';
  return 'unavailable';
}

// ------------------------------------------------------------
// Scan combiné par code-barres (EAN/UPC)
// ------------------------------------------------------------

/**
 * SCAN par code-barres — CASCADE avec PRIORITÉ LAST.FM :
 *   1. IDENTITÉ « artiste + album » de la parution par MusicBrainz + Discogs
 *      EN PARALLÈLE : ce sont les SEULES sources indexées par code-barres —
 *      l'API Last.fm n'expose AUCUN index EAN (`album.search` exige un
 *      paramètre `album` nominal : le code seul répond 400 « Invalid
 *      parameters », vérifié en local).
 *   2. PRIORITÉ 1 — LAST.FM : la porte d'entrée du scan est donc la fiche
 *      d'ALBUM résolue depuis cette identité (album.search&artist=…&album=… →
 *      album.getInfo : tracklist toptracks, tags/genres, label, date et
 *      jaquette d'ALBUM image extralarge). C'est LA source prioritaire des
 *      visuels et métadonnées : chaque champ de la fusion (mergeResults) est
 *      pris À LAST.FM en premier, MusicBrainz / Discogs ne complétant que
 *      ses champs vides (MBID, id release + URL Discogs, labels détaillés…).
 *   3. En l'absence de résultat Last.fm (ou sur son échec) : MusicBrainz puis
 *      Discogs FORNIRENT la fiche — repli propre, sans jamais mélanger les
 *      pistes d'un autre album homonyme (fetchAlbumInfo re-valide le couple
 *      artiste + titre strictement).
 * @param {string} code code-barres propre (8-14 chiffres).
 */
async function combinedBarcodeLookup(code) {
  const lastfmActive = isLastfmConfigured();
  const discogsActive = isDiscogsConfigured();

  // ------------------------------------------------------------------
  // 1) IDENTITÉ : MusicBrainz + Discogs en parallèle (seules bases indexées
  //    par code-barres — Last.fm n'a aucun index EAN). Leur « artiste +
  //    album » est la porte d'entrée de la recherche Last.fm ci-dessous ; le
  //    premier des deux à trouver sert l'identité à la cascade.
  // ------------------------------------------------------------------
  const [mbSettled, dgSettled] = await Promise.allSettled([
    searchByBarcode(code),
    discogsActive ? searchDiscogsByBarcode(code) : Promise.resolve(null),
  ]);
  const mbData = mbSettled.status === 'fulfilled' ? mbSettled.value : null;
  const dgData = dgSettled.status === 'fulfilled' ? dgSettled.value : null;
  const identityArtist = (mbData && mbData.artist) || (dgData && dgData.artist) || '';
  const identityTitle = (mbData && mbData.title) || (dgData && dgData.title) || '';

  // ------------------------------------------------------------------
  // 2) PRIORITÉ 1 — LAST.FM : fiche d'ALBUM complète via la porte d'entrée
  //    identifiée (searchAlbumByBarcode = album.search → album.getInfo,
  //    validation stricte du couple artiste + titre). Sans identité connue,
  //    Last.fm ne PEUT PAS deviner : elle n'est pas interrogée ('not-found'),
  //    ce qui n'est pas une panne — MusicBrainz / Discogs fournissent alors la
  //    fiche seule. Un échec d'infrastructure (429/502) devient 'unavailable'
  //    et est signalé dans warnings ; les deux sources restent disponibles.
  // ------------------------------------------------------------------
  let lfSettled = null;
  if (lastfmActive && identityArtist && identityTitle) {
    try {
      lfSettled = { status: 'fulfilled', value: await searchAlbumByBarcode(identityArtist, identityTitle) };
    } catch (err) {
      // Non bloquant : quota 429 / clé invalide / réseau — la fiche reste
      // fournie par MusicBrainz / Discogs ci-dessous.
      console.warn('[musicbrainz lookupBarcode] Recherche Last.fm impossible, repli :', err.message);
      lfSettled = { status: 'rejected', reason: err };
    }
  }

  return {
    mb: mbData,
    dg: dgData,
    lastfm: lfSettled && lfSettled.status === 'fulfilled' ? lfSettled.value : null,
    mbState: sourceState(mbSettled, MusicBrainzError),
    dgState: discogsActive ? sourceState(dgSettled, DiscogsError) : 'not-configured',
    // Non configuré -> 'not-configured' ; identité inconnue (ni MB ni Discogs
    // n'a trouvé) -> lfSettled null = 'not-found' (Last.fm non INTERROGÉE, pas
    // une panne) ; sinon l'état de la résolution Last.fm (source PRIORITAIRE
    // de la cascade).
    lfState: !lastfmActive ? 'not-configured' : sourceState(lfSettled, LastfmError),
    mbError: mbSettled.status === 'rejected' ? mbSettled.reason : null,
    dgError: dgSettled.status === 'rejected' ? dgSettled.reason : null,
    lfError: lfSettled && lfSettled.status === 'rejected' ? lfSettled.reason : null,
  };
}

/** Liste (dans l'ordre de la CASCADE) des sources configurées pour le message d'erreur. */
function activeSourcesList() {
  const names = [];
  if (isLastfmConfigured()) names.push('Last.fm');
  names.push('MusicBrainz');
  if (isDiscogsConfigured()) names.push('Discogs');
  return names.join(' ni ');
}

/**
 * GET /api/musicbrainz/barcode/:code
 *
 * Recherche par code-barres (EAN/UPC, 8 à 14 chiffres) — CASCADE PRIORITÉ
 * LAST.FM : l'identité « artiste + album » est identifiée par MusicBrainz +
 * Discogs en parallèle (les seules bases indexées par code-barres), puis la
 * fiche d'ALBUM Last.fm est résolue depuis cette identité (album.search →
 * album.getInfo : tracklist toptracks, tags/genres, label, date et jaquette
 * d'ALBUM). mergeResults applique la priorité LAST.FM au champ par champ
 * (jaquette d'album incluse) ; en l'absence de résultat Last.fm, MusicBrainz
 * puis Discogs fournissent la fiche en secours.
 *
 * Les trois sources sont interrogées avec REPLI MUTUEL :
 * - source non configurée (pas de clé/jeton) : non interrogée, aucune erreur
 *   (providers.<src> = "not-configured") ;
 * - source inconnue du disque (404) : non bloquante — les autres sources
 *   fournissent la fiche (tracklist + genres + visuel garantis par au moins
 *   une source active) ;
 * - échec d'infrastructure d'une source (429/502/401) : renvoyé dans
 *   "warnings" si la fiche reste disponible par ailleurs ; si TOUTES les
 *   sources actives échouent, le statut de la première erreur est renvoyé.
 *
 * Réponse 200 : { success, data, providers: { musicbrainz, discogs, lastfm },
 * warnings? }
 *   - data : { barcode, artist, title, label, genre, release_date, tracklist,
 *     track_count, cover_image, mbid, discogs_release_id, discogs_url,
 *     lastfm_url, source }
 *   - providers.<src> : "found" | "not-found" | "not-configured" | "unavailable"
 */
async function lookupBarcode(req, res, next) {
  try {
    const { code } = req.params;
    if (!code) {
      return res.status(400).json({ error: 'Le paramètre code-barres est requis.' });
    }

    const states = await combinedBarcodeLookup(code);
    const data = mergeResults(states.lastfm, states.mb, states.dg);

    // --- Aucune fiche trouvée : statut approprié ---
    if (!data) {
      const anyUnavailable =
        states.mbState === 'unavailable' ||
        states.dgState === 'unavailable' ||
        states.lfState === 'unavailable';
      if (anyUnavailable) {
        // Erreur PRIORITAIRE = celle du premier maillon de la cascade en échec
        // (Last.fm, interrogée EN TÊTE ici), puis les secours.
        const primary = states.lfError || states.mbError || states.dgError;
        const status = primary && primary.status === 429 ? 429 : 502;
        return res.status(status).json({
          error:
            (primary && primary.message) ||
            'Recherche indisponible : MusicBrainz, Last.fm et Discogs sont inaccessibles (connexion internet du serveur).',
        });
      }
      return res.status(404).json({
        error: `Aucun disque trouvé pour le code-barres ${code} (${activeSourcesList()}). Saisissez la fiche manuellement (artiste + titre).`,
      });
    }

    // --- Fiche trouvée : avertissements des sources en échec (non bloquant) ---
    const warnings = [];
    if (states.mbState === 'unavailable' && states.mbError) {
      warnings.push(`MusicBrainz indisponible : ${states.mbError.message}`);
    }
    if (states.dgState === 'unavailable' && states.dgError) {
      warnings.push(states.dgError.message || 'Erreur Discogs lors de la recherche.');
    }
    if (states.lfState === 'unavailable' && states.lfError) {
      warnings.push(states.lfError.message || 'Erreur Last.fm lors de la recherche.');
    }

    const payload = {
      success: true,
      data,
      providers: { musicbrainz: states.mbState, discogs: states.dgState, lastfm: states.lfState },
    };
    if (warnings.length > 0) payload.warnings = warnings;
    return res.json(payload);
  } catch (err) {
    // Safety-net : toute erreur non classée au-dessus est renvoyée en 502.
    console.error('[musicbrainz lookupBarcode]', err);
    return res.status(502).json({
      error:
        err.message ||
        "Recherche par code-barres indisponible. Vérifiez la connexion internet du serveur (et éventuellement le quota de 1 requête/seconde MusicBrainz).",
    });
  }
}

// ------------------------------------------------------------
// Import par ARTISTE + TITRE D'ALBUM (saisie manuelle, sans code-barres)
// ------------------------------------------------------------

/**
 * Recherche la fiche d'un disque SAISI MANUELLEMENT (artiste + titre) —
 * CASCADE PRIORITÉ LAST.FM :
 *   1. Last.fm D'ABORD : album.search + album.getInfo (tracklist toptracks,
 *      tags/genres, label, date et jaquette d'ALBUM) — source prioritaire
 *      des visuels et métadonnées ;
 *   2. MusicBrainz en SECOURS : Lucene `artist:"…" AND release:"…"` (release
 *      exacte si existante : MBID + tracklist fidèle au support + Cover Art
 *      Archive) ;
 *   3. Discogs en SECOURS : recherche release « Artiste Album » + fiche
 *      complète (id de la release + URL, image HD).
 * Les trois sont lancés en parallèle ; la fusion (mergeResults, priorité
 * Last.fm) part dès qu'UNE source fournit la fiche et comble les champs
 * manquants d'une source par les autres.
 * @returns {Promise<{data: object|null,
 *   lastfm: 'found'|'not-found'|'not-configured'|'unavailable',
 *   musicbrainz: string, discogs: string, warnings: Error[]}>}
 */
async function combinedReleaseSearch(artist, title) {
  const lastfmActive = isLastfmConfigured();
  const discogsActive = isDiscogsConfigured();

  // Les trois sources en parallèle — l'échec de l'une n'attend pas les autres.
  const [lfSettled, mbSettled, dgSettled] = await Promise.allSettled([
    (async () => {
      if (!lastfmActive) return null;
      const match = await searchAlbum(artist, title);
      // fetchAlbumInfo valide strictement le titre + artiste (null sinon :
      // jamais un album homonyme pré-rempli par erreur).
      return match ? await fetchAlbumInfo(match.artist || artist, match.name) : null;
    })(),
    searchByRelease(artist, title),
    discogsActive ? searchDiscogsByRelease(artist, title) : Promise.resolve(null),
  ]);

  const lfData = lfSettled.status === 'fulfilled' ? lfSettled.value : null;
  const mbData = mbSettled.status === 'fulfilled' ? mbSettled.value : null;
  const dgData = dgSettled.status === 'fulfilled' ? dgSettled.value : null;

  // Sources « en échec » pour les warnings (404 inconnu = non bloquant).
  const errors = [];
  if (lfSettled.status === 'rejected') {
    const err = lfSettled.reason;
    if (!(err instanceof LastfmError && err.status === 404)) errors.push({ name: 'Last.fm', err });
  }
  if (mbSettled.status === 'rejected') {
    const err = mbSettled.reason;
    if (!(err instanceof MusicBrainzError && err.status === 404)) errors.push({ name: 'MusicBrainz', err });
  }
  if (dgSettled.status === 'rejected' && discogsActive) {
    const err = dgSettled.reason;
    if (!(err instanceof DiscogsError && err.status === 404)) errors.push({ name: 'Discogs', err });
  }

  return {
    data: mergeResults(lfData, mbData, dgData),
    lastfm: !lastfmActive ? 'not-configured' : sourceState(lfSettled, LastfmError),
    musicbrainz: sourceState(mbSettled, MusicBrainzError),
    discogs: !discogsActive ? 'not-configured' : sourceState(dgSettled, DiscogsError),
    available: [
      ...(lastfmActive ? ['Last.fm'] : []),
      'MusicBrainz',
      ...(discogsActive ? ['Discogs'] : []),
    ],
    errors,
  };
}

/**
 * GET /api/musicbrainz/search?artist=<nom>&title=<album>
 *
 * Import d'un disque SAISI MANUELLEMENT (artiste + titre, sans code-barres) :
 * Last.fm (priorité — tracklist, tags/genres, jaquette d'album), MusicBrainz
 * (MBID + tracklist de la release exacte si existante) et Discogs (id + URL,
 * image HD) interrogés en PARALLÈLE avec repli mutuel dès qu'une source
 * fournit la fiche.
 *
 * Réponse 200 : { success, data, providers: { lastfm, musicbrainz, discogs },
 * warnings? } — data : { barcode:null, artist, title, label, genre,
 * release_date, tracklist, track_count, cover_image, mbid?, discogs_release_id?,
 * discogs_url?, lastfm_url?, source }.
 * Réponses erreurs : 400 (paramètres manquants), 404 (aucune source ne connaît
 * la parution — les sources indisponibles y sont signalées), 429/502 (toutes
 * les sources actives en échec d'infrastructure).
 */
async function searchRelease(req, res, next) {
  try {
    const artist = String(req.query.artist || '').trim();
    const title = String(req.query.title || '').trim();
    if (!artist || !title) {
      return res.status(400).json({
        error: "Les paramètres « artist » et « title » sont requis pour la recherche.",
      });
    }

    const states = await combinedReleaseSearch(artist, title);

    // --- Aucune fiche trouvée par aucune source configurée ---
    if (!states.data) {
      const anyUnavailable = [states.lastfm, states.musicbrainz, states.discogs].some(
        (s) => s === 'unavailable'
      );
      if (anyUnavailable) {
        const primary = states.errors[0];
        const status = primary && primary.err.status === 429 ? 429 : 502;
        return res.status(status).json({
          error: (primary && primary.err.message) || 'Recherche indisponible : les fournisseurs d\'album ne sont pas accessibles.',
        });
      }
      return res.status(404).json({
        error: `Aucun album « ${title} » de ${artist} trouvé sur ${states.available.join(' ni ')}. Vérifiez la saisie (nom exact de l'artiste, titre de l'album).`,
      });
    }

    // --- Fiche trouvée : avertissement des sources en échec (non bloquant) ---
    const warnings = states.errors.map((e) => `${e.name} indisponible : ${e.err.message}`);

    const payload = {
      success: true,
      data: states.data,
      providers: {
        lastfm: states.lastfm,
        musicbrainz: states.musicbrainz,
        discogs: states.discogs,
      },
    };
    if (warnings.length > 0) payload.warnings = warnings;
    return res.json(payload);
  } catch (err) {
    console.error('[musicbrainz searchRelease]', err);
    return res.status(err.status || 502).json({
      error: err.message || 'Recherche artiste + album indisponible.',
    });
  }
}

// ------------------------------------------------------------
// Import par MOTS-CLÉS (EAN/UPC ou « artiste titre ») — même cascade que le
// scan code-barres : 1. Last.fm (prioritaire, jaquettes) -> 2. Discogs ->
// 3. MusicBrainz. Sert la modale d'ajout de disque quand le scan échoue.
// ------------------------------------------------------------

/**
 * GET /api/musicbrainz/keyword?q=<mots-clés>
 *
 * Recherche TEXTUELLE d'un disque par MOTS-CLÉS : EAN/UPC (8-14 chiffres) ou
 * phrase libre « titre » / « artiste titre » — la même CASCADE PRIORITAIRE que
 * le scan par code-barres, appliquée en ordre SÉQUENTIEL STRICT :
 *   1. LAST.FM d'abord (prioritaire, notamment pour les VISUELS / jaquettes :
 *      album.search&album=<chaîne> puis album.getInfo — les fiches complète et
 *      validées priment champ par champ dans la fusion) ;
 *   2. DISCOGS en second recours ( seulement si Last.fm n'a rien fourni )
 *      — /database/search?q=<chaîne>&type=release : id de la release, URL, image HD ;
 *   3. MUSICBRAINZ en troisième et dernier recours (seulement si ni Last.fm ni
 *      Discogs n'a rien fourni) — Lucene + Cover Art Archive : MBID + tracklist
 *      fidèle à la release.
 * Chaque maillon n'est interrogé que si le précédent n'a TROUVÉ AUCUNE fiche —
 * jamais d'appels en parallèle ici (l'ordre d'interrogation EST la règle de
 * priorité, et dès qu'un maillon trouve les suivants sont ignorés : économie de
 * quota Last.fm / Discogs). Une panne d'un maillon « en amont » n'est PAS un
 * motif de blocage : la cascade enchaîne ; si une fiche existe alors quand même
 * (fournie par un maillon aval), son incident est signalé dans "warnings".
 *
 * Réponse 200 : { success, data, providers: { lastfm, discogs, musicbrainz },
 * warnings? } — data : { barcode?, artist, title, label, genre, release_date,
 * tracklist, track_count, cover_image, mbid?, discogs_release_id?, discogs_url?,
 * lastfm_url?, source }.
 * Réponses erreurs : 400 (requête vide / trop longue), 404 (aucune source ne
 * connaît la parution — les sources indisponibles y sont signalées), 429/502
 * (toutes les sources actives en échec d'infrastructure).
 */
async function searchKeyword(req, res) {
  try {
    const rawQ = String(req.query.q ?? '').replace(/\s+/g, ' ').trim();
    if (!rawQ) {
      return res.status(400).json({ error: "Paramètre « q » requis : n° EAN/UPC ou « artiste titre » du disque à retrouver." });
    }
    if (rawQ.length > 300) {
      return res.status(400).json({ error: 'Requête trop longue (300 caractères maximum).' });
    }

    console.log(`[musicbrainz searchKeyword] GET /api/musicbrainz/keyword?q=${encodeURIComponent(rawQ)} (cascade stricte 1. Last.fm -> 2. Discogs -> 3. MusicBrainz)`);

    const { lastfm: lf, discogs: dg, musicbrainz: mb, queried } = await runKeywordCascade(rawQ);
    const lastfmActive = isLastfmConfigured();
    const discogsActive = isDiscogsConfigured();

    // Fiche du PREMIER maillon de la cascade ayant trouvé (les suivants ne sont
    // pas interrogés — économie de quota Last.fm / Discogs) : Last.fm (première
    // fiche validée de la liste, classée par pertinence) sinon Discogs, sinon
    // MusicBrainz. mergeResults conserve la priorité LAST.FM champ par champ ;
    // une source non interrogée (null) n'apporte rien à la fusion.
    const lfData = lf && lf.status === 'fulfilled' ? (Array.isArray(lf.value) ? lf.value[0] || null : lf.value) : null;
    const dgData = dg && dg.status === 'fulfilled' ? dg.value : null;
    const mbData = mb && mb.status === 'fulfilled' ? mb.value : null;
    const data = mergeResults(lfData, mbData, dgData);

    // Pannes « non bloquantes » (429 quota / 502 / réseau) des maillons
    // INTERROGÉS, poussés dans l'ORDRE DE LA CASCADE : la première devient
    // l'erreur PRIORITAIRE quand aucune fiche n'existe (conformité de la règle
    // Last.fm > Discogs > MusicBrainz). Les 404 (« inconnu de la source ») ne
    // comptent PAS comme panne : repli silencieux sur le maillon suivant.
    const errors = [];
    if (queried.lastfm && lf && lf.status === 'rejected') {
      const err = lf.reason;
      if (!(err instanceof LastfmError && err.status === 404)) errors.push({ name: 'Last.fm', err });
    }
    if (queried.discogs) {
      // Le client Discogs CAPTURE ses pannes internes (quota 429, jeton expiré,
      // réseau) et renvoie null : DISCOGS_ERROR_LAST les distingue d'un simple
      // « inconnu » (null sans erreur). Toute erreur vraie = source indisponible.
      const hidden = discogsLastSearchError();
      if (hidden && !(hidden instanceof DiscogsError && hidden.status === 404)) {
        errors.push({ name: 'Discogs', err: hidden });
      } else if (dg && dg.status === 'rejected') {
        // Inattendu (le client ne lève normalement pas d'exception) : erreur
        // « brute » — même traitement qu'un rejet classé non 404.
        const err = dg.reason;
        if (!(err instanceof DiscogsError && err.status === 404)) errors.push({ name: 'Discogs', err });
      }
    }
    if (queried.musicbrainz && mb && mb.status === 'rejected') {
      const err = mb.reason;
      if (!(err instanceof MusicBrainzError && err.status === 404)) errors.push({ name: 'MusicBrainz', err });
    }

    // États des sources pour le client : 'found' / 'not-found' (absente de la
    // fiche ou non interrogée car un maillon amont a trouvé — NON bloquant) /
    // 'unavailable' (panne infrastructure) / 'not-configured'. Calculés SANS
    // dépendre du dénouement : le 404 final / les warnings traitent les pannes.
    const providers = {
      lastfm: !queried.lastfm
        ? (lastfmActive ? 'not-found' : 'not-configured')
        : sourceState(lf, LastfmError),
      discogs: !queried.discogs
        ? (discogsActive ? 'not-found' : 'not-configured')
        : (sourceState(dg, DiscogsError) === 'not-found' && discogsLastSearchError()
          ? 'unavailable'
          : sourceState(dg, DiscogsError)),
      // MusicBrainz = toujours « configuré » côté serveur (User-Agent seul).
      musicbrainz: !queried.musicbrainz
        ? (isConfigured() ? 'not-found' : 'not-configured')
        : sourceState(mb, MusicBrainzError),
    };

    // --- Aucune fiche trouvée : statut selon les pannes éventuelles ---
    if (!data) {
      if (errors.length > 0) {
        // Erreur PRIORITAIRE = celle du PREMIER maillon de la cascade en échec
        // (Last.fm d'abord, puis Discogs, enfin MusicBrainz) : 429 si quota,
        // sinon 502 — jamais de « pas trouvé » quand une source est en panne.
        const primary = errors[0];
        const httpStatus = primary.err.status === 429 ? 429 : 502;
        return res.status(httpStatus).json({
          error: primary.err.message ||
            `Recherche indisponible (${errors.map((e) => e.name).join(', ')} inaccessibles). Vérifiez la connexion internet du serveur.`,
        });
      }
      return res.status(404).json({
        error: `Aucun disque trouvé pour « ${rawQ} » sur Last.fm${discogsActive ? ' / Discogs' : ''} / MusicBrainz. Vérifiez la saisie (n° EAN exact, nom de l'artiste + titre de l'album) ou saisissez la fiche manuellement.`,
      });
    }

    // --- Fiche trouvée : avertissements non bloquants des sources en échec ---
    const warnings = errors.map((e) => `${e.name} indisponible : ${e.err.message}`);
    const payload = { success: true, data, providers };
    if (warnings.length > 0) payload.warnings = warnings;
    console.log(
      `[musicbrainz searchKeyword] Résultat final : « ${data.artist} — ${data.title} » (source=${data.source}, providers=${JSON.stringify(providers)}${warnings.length ? `, ${warnings.length} avertissement(s)` : ''}).`
    );
    return res.json(payload);
  } catch (err) {
    console.error('[musicbrainz searchKeyword]', err);
    return res.status(err.status || 502).json({
      error: err.message || 'Recherche par mots-clés indisponible. Vérifiez la connexion internet du serveur.',
    });
  }
}

module.exports = {
  status,
  lookupBarcode,
  searchRelease,
  searchKeyword,
  // Exportés pour les tests / scripts locaux (test-lastfm-priority.js) :
  combinedBarcodeLookup,
  combinedReleaseSearch,
  mergeResults,
};
