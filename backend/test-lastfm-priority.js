/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/* Test local de la NOUVELLE stratégie d'import disque (PRIORITÉ Last.fm) :
   1. combinedBarcodeLookup : Last.fm d'ABORD (album.search&query=<EAN> →
      album.getInfo), puis MusicBrainz + Discogs en parallèle en secours ;
   2. mergeResults : les champs (notamment cover_image) suivent la priorité
      Last.fm > MusicBrainz > Discogs ;
   3. combinedReleaseSearch : même cascade pour l'import artiste + titre. */
const {
  combinedBarcodeLookup,
  mergeResults,
} = require('./src/controllers/musicBrainzController');

(async () => {
  // Black Sabbath — Paranoid (EAN indexé sur MusicBrainz + Discogs ;
  // « Dark Side of the Moon » 0190295958361 n'est plus référencé dans les deux).
  const code = '5017615619720';
  console.log('=== SCAN EAN', code, '— cascade PRIORITÉ Last.fm ===');
  const states = await combinedBarcodeLookup(code);
  console.log('\nÉtats des sources :', {
    lastfm: states.lfState,
    musicbrainz: states.mbState,
    discogs: states.dgState,
    lfError: states.lfError && states.lfError.message,
  });
  const data = mergeResults(states.lastfm, states.mb, states.dg);
  if (!data) {
    console.log('AUCUNE SOURCE N\'A TROUVÉ :', states.lfError || '—');
    process.exit(1);
  }
  console.log('\nFiche fusionnée (priorité Last.fm champ par champ) :');
  for (const k of ['source', 'artist', 'title', 'label', 'genre', 'release_date', 'track_count', 'cover_image', 'mbid', 'discogs_release_id', 'lastfm_url']) {
    const v = data[k];
    console.log(`   ${k.padEnd(20)}: ${v ? String(v).slice(0, 100) : 'null'}`);
  }
  console.log('\n   tracklist (1re ligne) :', String(data.tracklist || '').split('\n')[0].slice(0, 80));
  const prioLf = data.source && data.source.startsWith('lastfm');
  // CDN des images Last.fm : lastfm-img.freetls.fastly.net (domaines legacy
  // userserve-ak.last.fm / e-images… conservés en repli).
  const coverLf = data.cover_image && /(lastfm|freetls\.fastly)/.test(data.cover_image);
  console.log(`\nPRIORITY_LASTFM=${prioLf ? 'OK' : 'ECART'}  COVER_FROM_LASTFM=${coverLf ? 'OK' : 'AUTRE_SOURCE: ' + (data.cover_image || 'null').slice(0, 60)}`);

  // --- Import artiste + titre : même cascade Last.fm d'abord ---
  console.log('\n=== IMPORT ARTISTE + TITRE — même priorité ===');
  const { combinedReleaseSearch } = require('./src/controllers/musicBrainzController');
  const rel = await combinedReleaseSearch('Pink Floyd', 'The Dark Side of the Moon');
  const rd = rel.data;
  console.log('   source      :', rd && rd.source);
  console.log('   track_count :', rd && rd.track_count);
  console.log('   cover_image :', rd ? String(rd.cover_image || 'null').slice(0, 100) : 'null');
  console.log('   états       :', { lastfm: rel.lastfm, musicbrainz: rel.musicbrainz, discogs: rel.discogs });
  process.exit(0);
})().catch((e) => { console.error('ERREUR SCRIPT :', e.message); process.exit(1); });
