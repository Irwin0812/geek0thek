const {
  searchByBarcode,
  searchByRelease,
  MusicBrainzError,
  isConfigured,
} = require('../utils/musicBrainzClient');
const {
  searchByBarcode: searchDiscogsByBarcode,
  searchArtistAlbum: searchDiscogsByRelease,
  DiscogsError,
  isConfigured: isDiscogsConfigured,
} = require('../utils/discogsClient');
// Last.fm — COMPLEMENT (et source PRIORITAIRE de l'import par artiste + titre)
// de MusicBrainz / Discogs lors du rapportage des disques : la fiche d'album
// (tracklist toptracks, tags/genres, label si présent, jaquette d'ALBUM, URL)
// assure l'intégrité des données quand les deux autres sources sont absentes,
// vides ou injoignables.
const {
  searchAlbum,
  fetchAlbumInfo,
  LastfmError,
  isConfigured: isLastfmConfigured,
} = require('../utils/lastfmClient');

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
    // Photo d'artiste PRIORITÉ 1 + fiche d'album : actif si LASTFM_API_KEY valide.
    lastfm: { configured: isLastfmConfigured() },
    // Complément optionnel : active seulement si DISCOGS_TOKEN est renseigné.
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
 * (cascade / repli) :
 *   - MUSICBRAINZ : fiche de RÉFÉRENCE au scan EAN (MBID, tracklist exacte,
 *     date, genres agrégés, jaquette Cover Art Archive) ;
 *   - LAST.FM : complément « artiste + album » — tracklist toptracks, tags /
 *     genres, label et date de sortie quand les deux autres n'apportent rien,
 *     ET jaquette d'ALBUM (image extralarge) si aucune autre source n'en a ;
 *   - DISCOGS : complément (image HD, labels détaillés, id release + URL).
 * Chaque champ est pris à la PREMIÈRE source (ordre ci-dessus) qui le porte ;
 * genre ET label accumulent les libellés des sources sans doublon.
 * @returns {object|null} fiche fusionnée ({ source: 'musicbrainz' | 'lastfm'
 *   | 'discogs' | combos }), ou null si aucune source ne connaît la parution.
 */
function mergeResults(lf, mb, dg) {
  if (!lf && !mb && !dg) return null;

  // Genre : fusion MusicBrainz + Last.fm (tags d'album) + Discogs (genres +
  // styles des fiches complètes), dé-duplicés — c'est la garantie qu'un disque
  // porte ses tags musicaux même si une source est vide sur ce champ.
  const genreSet = new Set();
  [mb && mb.genre, lf && lf.genres, dg && dg.genre].forEach((v) => {
    String(v || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((g) => genreSet.add(g));
  });

  return {
    barcode: (mb && mb.barcode) || (dg && dg.barcode) || null,
    artist: (mb && mb.artist) || (lf && lf.artist) || (dg && dg.artist) || '',
    title: (mb && mb.title) || (lf && lf.album_name) || (dg && dg.title) || '',
    genre: [...genreSet].join(', '),
    // Label : MusicBrainz > Discogs (labels détaillés) > Last.fm — accumulé.
    label: mergeLabels(mb && mb.label, dg && dg.label, lf && lf.label),
    release_date:
      (mb && mb.release_date) || (lf && lf.release_date) || (dg && dg.release_date) || null,
    // Tracklist : MusicBrainz (pistes de la RELEASE EXACTE) > Last.fm
    // (toptracks ordonnées) > Discogs (fiche complète). Même format
    // « A1 : Blackened (6:42) » / « Titre » que le reste de l'application.
    tracklist: (mb && mb.tracklist) || (lf && lf.tracklist) || (dg && dg.tracklist) || '',
    track_count:
      Number(mb && mb.track_count) || Number(lf && lf.track_count) || Number(dg && dg.track_count) || 0,
    // Jaquette : Cover Art Archive (MB) > Last.fm (image extralarge de
    // album.getInfo) > Discogs (cover_image HD — reprise dans la recherche
    // mais rarement sur les fiches complètes) : toujours un visuel d'album.
    cover_image:
      (mb && mb.cover_image) || (lf && lf.cover_image) || (dg && dg.cover_image) || null,
    // Identifiants persistés avec le disque (DTO / colonnes).
    mbid: (mb && mb.mbid) || null,
    discogs_release_id: (dg && dg.discogs_release_id) || null,
    discogs_url: (dg && dg.discogs_url) || null,
    // URL de la fiche Last.fm (lien « Fiche Last.fm ↗ » optionnel du formulaire).
    lastfm_url: (lf && lf.url) || null,
    // Source(s) ayant réellement alimenté la fiche : 'musicbrainz+lastfm+discogs'.
    source: [mb && 'musicbrainz', lf && 'lastfm', dg && 'discogs']
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
 * SCAN COMBINÉ des trois sources pour un code-barres (parallèle, repli mutuel) :
 *   - MusicBrainz (fiche de référence) + Discogs en parallèle d'abord :
 *     leur résultat « artiste + album » sert d'IDENTITÉ à la recherche Last.fm ;
 *   - Last.fm ensuite : album.search positionne la parution, album.getInfo
 *     apporte tracklist, tags/genres, label, date et jaquette d'album — les
 *     champs que MusicBrainz / Discogs ne fournissent PAS toujours (notamment
 *     les visuels et les tags). Coste total : 1 à 2 requêtes Last.fm.
 * @param {string} code code-barres propre (8-14 chiffres).
 */
async function combinedBarcodeLookup(code) {
  const lastfmActive = isLastfmConfigured();
  const discogsActive = isDiscogsConfigured();

  // 1) Identité de la parution : MusicBrainz ET Discogs en parallèle.
  const [mbSettled, dgSettled] = await Promise.allSettled([
    searchByBarcode(code),
    discogsActive ? searchDiscogsByBarcode(code) : Promise.resolve(null),
  ]);
  const mbData = mbSettled.status === 'fulfilled' ? mbSettled.value : null;
  const dgData = dgSettled.status === 'fulfilled' ? dgSettled.value : null;

  // 2) Fiche Last.fm uniquement si l'identité « artiste + album » est connue
  //    (aucune des deux sources n'a trouvé -> Last.fm ne peut pas deviner ; la
  //    saisie manuelle artiste + titre reste disponible côté frontend).
  const identityArtist = (mbData && mbData.artist) || (dgData && dgData.artist) || '';
  const identityTitle = (mbData && mbData.title) || (dgData && dgData.title) || '';
  let lfSettled = null;
  if (lastfmActive && identityArtist && identityTitle) {
    try {
      const match = await searchAlbum(identityArtist, identityTitle);
      // fetchAlbumInfo VALIDe strictement le titre + artiste (null sinon).
      const data = match ? await fetchAlbumInfo(match.artist || identityArtist, match.name) : null;
      lfSettled = { status: 'fulfilled', value: data };
    } catch (err) {
      lfSettled = { status: 'rejected', reason: err };
    }
  }

  return {
    mb: mbData,
    dg: dgData,
    lastfm: lfSettled && lfSettled.status === 'fulfilled' ? lfSettled.value : null,
    mbState: sourceState(mbSettled, MusicBrainzError),
    dgState: discogsActive ? sourceState(dgSettled, DiscogsError) : 'not-configured',
    // Non configuré / identité inconnue (sources absentes) -> 'not-found' :
    // Last.fm n'a simplement PAS ÉTÉ INTERROGÉE, ce qui n'est pas une panne.
    lfState: !lastfmActive ? 'not-configured' : sourceState(lfSettled, LastfmError),
    mbError: mbSettled.status === 'rejected' ? mbSettled.reason : null,
    dgError: dgSettled.status === 'rejected' ? dgSettled.reason : null,
    lfError: lfSettled && lfSettled.status === 'rejected' ? lfSettled.reason : null,
  };
}

/** Liste (separée par « , ») des sources configurées pour le message d'erreur. */
function activeSourcesList() {
  const names = ['MusicBrainz'];
  if (isLastfmConfigured()) names.push('Last.fm');
  if (isDiscogsConfigured()) names.push('Discogs');
  return names.join(' ni ');
}

/**
 * GET /api/musicbrainz/barcode/:code
 *
 * Recherche par code-barres (EAN/UPC, 8 à 14 chiffres) : MusicBrainz (fiche de
 * référence : titre, artiste, date, label, genre, tracklist + noms de
 * chansons, MBID, jaquette Cover Art Archive), Last.fm en complément (tracklist
 * toptracks, tags/genres, jaquette d'albume) ET Discogs en complément (date,
 * label, genre, miniature HD, id + URL de la fiche).
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
        const primary = states.mbError || states.dgError || states.lfError;
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
 * Recherche la fiche d'un disque SAISI MANUELLEMENT (artiste + titre) sur les
 * trois sources avec REPLI MUTUEL :
 *   1. Last.fm : album.search + album.getInfo (tracklist toptracks, tags,
 *      label, date, jaquette) — PRIORITAIRE ici (la plus large couverture) ;
 *   2. MusicBrainz : Lucene `artist:"…" AND release:"…"` (release exacte si
 *      existante : MBID + tracklist fidèle au support + Cover Art Archive) ;
 *   3. Discogs : recherche release « Artiste Album » + fiche complète
 *      (id de la release + URL, image HD).
 * La réponse part dès qu'UNE source fournit la fiche (garantie d'intégrité
 * des données) ; les champs manquants d'une source sont comblés par les autres.
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

module.exports = { status, lookupBarcode, searchRelease };
