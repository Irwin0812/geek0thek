/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
// Test local (sans SSH, sans réseau) — SUPPRESSION EXPLICITE d'images
// (« Retirer le fichier ») + DISSOCIATION série/tome et artiste/jaquette.
// Exécute updateComic / createVinyl / updateVinyl avec la couche DB stubbée ET
// le service de série stubbé (aucun appel API Open Library / Google Books —
// déterministe hors ligne). Lancer depuis backend/ : `node smoke-removal.js`.
const assert = require('assert');

function stubDb(state) {
  const calls = [];
  async function query(text, params) {
    calls.push({ text: String(text).replace(/\s+/g, ' ').trim(), params });
    const t = String(text);

    // ---- lecture (lignes courantes des scénarios) -----
    // COPIES PROFONDES (fidelité à une vraie base : le contrôleur ne retient
    // jamais de référence vivante vers les objets du store — sinon un UPDATE
    // qui écrit `series = NULL` muterait aussi l'objet « existing » local du
    // contrôleur, ce qui n'arrive jamais avec row Postgres distinctes).
    if (/^SELECT \* FROM comics WHERE id/.test(t)) {
      return { rows: state.comicId && state.comics[state.comicId] ? [structuredClone(state.comics[state.comicId])] : [] };
    }
    if (/^SELECT \* FROM vinyls WHERE id/.test(t)) {
      return { rows: state.vinylId && state.vinyls[state.vinylId] ? [structuredClone(state.vinyls[state.vinylId])] : [] };
    }

    // ---- orphan checks (fichiers locaux plus référencés) -----
    if (/^SELECT 1 FROM comics WHERE series_image = \$1/.test(t)) {
      return { rows: [] };
    }
    if (/^SELECT 1 FROM vinyls WHERE artist_image = \$1/.test(t)) {
      return { rows: [] };
    }
    // isStoredAlbumCover : une image locale est-elle la jaquette d'un disque
    // contaminé (artist_image = cover_url) ? — non dans tous nos scénarios.
    if (/^SELECT 1 FROM vinyls WHERE btrim\(artist_image\) = \$1/.test(t)) {
      return { rows: [] };
    }

    // ---- image de série GLOBALE (entité + tous les tomes du même nom) -----
    if (/SELECT DISTINCT series_image AS img FROM comics/.test(t)) {
      const imgs = Object.values(state.comics).map((c) => c.series_image).filter(Boolean);
      return { rows: [...new Set(imgs)].map((img) => ({ img })) };
    }
    if (/^UPDATE comics SET series_image = \$3\s+WHERE \(series_id = \$1/s.test(t)) {
      // syncSeriesEntity : propagation globale (params[2] = nouvelle image)
      for (const c of Object.values(state.comics)) {
        if (!c.series || String(c.series).trim() !== params[1]) continue;
        c.series_image = params[2];
        c.series_id = params[0];
      }
      return { rows: [] };
    }

    // ---- purge explicite série (comics) : NULL forcé -----
    if (/^UPDATE comics SET series_id = NULL, series_image = NULL WHERE id/.test(t)) {
      const c = state.comics[state.comicId];
      c.series_id = null;
      c.series_image = null;
      return { rows: [c] };
    }
    // ---- purge EXPLICITE de l'image de série seule (« Retirer le fichier »,
    //      image retirée, série encore déclarée) : series_image -> NULL,
    //      rattachement à l'entité conservé -----
    if (/^UPDATE comics SET series_image = NULL WHERE id/.test(t)) {
      const c = state.comics[state.comicId];
      c.series_image = null;
      return { rows: [c] };
    }
    // ---- UPDATE principal comics (17 paramètres, 0-based) -----
    if (/^UPDATE comics SET/.test(t)) {
      const c = state.comics[state.comicId];
      c.cover_url = params[0];
      c.title = params[1];
      c.series = params[2];
      c.authors = params[4];
      c.publisher = params[6];
      if (params[14] != null) c.series_id = params[14];
      if (params[15] != null) c.series_image = params[15];
      return { rows: [c] };
    }

    // ---- image d'ARTISTE GLOBALE (entité + tous les disques du même artiste) -----
    if (/SELECT DISTINCT artist_image AS img FROM vinyls/.test(t)) {
      const imgs = Object.values(state.vinyls).map((v) => v.artist_image).filter(Boolean);
      return { rows: [...new Set(imgs)].map((img) => ({ img })) };
    }
    // ---- suppression explicite de l'image d'ARTISTE : purge NULL globale -----
    if (/^UPDATE vinyls SET artist_image = NULL\s+WHERE \(artist_id/.test(t)) {
      for (const v of Object.values(state.vinyls)) {
        const attachedByEntity = params[0] != null && v.artist_id === params[0];
        const legacyByName = v.artist_id == null && String(v.artist || '').trim() === String(params[1]).trim();
        if (attachedByEntity || legacyByName) {
          v.artist_image = null; // colonne ÉCRASÉE par NULL sur tous les disques
        }
      }
      return { rows: [] };
    }
    if (/^UPDATE vinyls SET artist_image = \$3\s+WHERE/.test(t)) {
      // syncArtistEntity : propagation globale (params[2] = nouvelle image)
      for (const v of Object.values(state.vinyls)) {
        if (!v.artist || String(v.artist).trim() !== params[1]) continue;
        v.artist_image = params[2];
        v.artist_id = params[0];
      }
      return { rows: [] };
    }
    // ---- auto-réparation artiste : purge NULL de la colonne contaminée -----
    if (/^UPDATE vinyls SET artist_image = NULL WHERE id/.test(t)) {
      const v = state.vinyls[state.vinylId];
      v.artist_image = null;
      return { rows: [v] };
    }
    // ---- réutilisation d'image artiste (nom d'artiste normalisé) -----
    if (/^SELECT artist, artist_image/.test(t)) {
      const rows = Object.entries(state.vinyls)
        .filter(([, v]) => v.artist_image && String(v.artist_image).trim())
        .map(([, v]) => ({ artist: v.artist, artist_image: v.artist_image, artist_id: v.artist_id }));
      return { rows };
    }
    // ---- entité ARTISTE (artistService.ensureArtist / findArtistId) -----
    if (/^SELECT id, name, image_url FROM artists WHERE norm_name/.test(t)) {
      return { rows: state.artistId ? [{ id: state.artistId, name: 'A', image_url: state.artistImage || null }] : [] };
    }
    if (/^SELECT id FROM artists WHERE norm_name/.test(t)) {
      return { rows: state.artistId ? [{ id: state.artistId }] : [] };
    }
    if (/^UPDATE artists SET image_url = \$1/.test(t)) {
      // ensureArtist (remplacement) : image_url = $1 (les autres paramètres : id…)
      state.artistImage = params[0];
      return { rows: [{ id: 7, name: 'A', image_url: params[0] }] };
    }
    if (/^UPDATE artists SET image_url = NULL/.test(t)) {
      // removeArtistImageGlobally (purge) : image_url -> NULL, $1 = id de l'entité
      state.artistImage = null;
      return { rows: [] };
    }
    // ---- UPDATE principal vinyls (21 paramètres, 0-based) -----
    if (/^UPDATE vinyls SET/.test(t)) {
      const v = state.vinyls[state.vinylId];
      v.title = params[1];
      v.artist = params[0];
      v.cover_url = params[13];
      if (params[18] != null) v.artist_id = params[18];
      // « conserver » au COALESCE : colonne inchangée si paramètre nul
      if (params[19] != null) v.artist_image = params[19];
      return { rows: [v] };
    }

    throw new Error(`[smoke] SQL non prévu : ${t} :: ${JSON.stringify(params)}`);
  }
  return { calls, query };
}

function install(state) {
  const path = require('path');
  const fs = require('fs');
  const removed = [];
  // --- stub de la couche DB (avant tout require des contrôleurs) ---
  const dbPath = path.join(__dirname, 'src', 'config', 'db.js');
  const dbStub = stubDb(state);
  require.cache[require.resolve(dbPath)] = {
    id: dbPath, filename: dbPath, loaded: true, exports: { query: dbStub.query },
  };
  // --- stub du service SÉRIE : aucun appel réseau (Open Library / Google
  // Books) — autoFetch renvoie directement le repli propre img/no_title.jpg ;
  // findSeries / ensureSeries opèrent sur l'état mémoire des scénarios. ---
  const seriesPath = path.join(__dirname, 'src', 'utils', 'seriesService.js');
  require.cache[require.resolve(seriesPath)] = {
    id: seriesPath, filename: seriesPath, loaded: true,
    exports: {
      SERIES_NO_TITLE_URL: '/img/no_title.jpg',
      SERIES_UPLOAD_SUBDIR: 'series',
      findSeries: async () =>
        state.seriesId ? { seriesId: state.seriesId, image: state.seriesImage || null } : null,
      ensureSeries: async (name, imageUrl = null) => {
        if (!state.seriesId) {
          state.seriesId = 9;
          state.seriesImage = imageUrl || null;
        } else if (imageUrl != null && imageUrl !== state.seriesImage) {
          state.seriesImage = imageUrl;
        }
        return { seriesId: state.seriesId, image: state.seriesImage || null };
      },
      autoFetchSeriesImage: async () => '/img/no_title.jpg', // échec APIs simulé -> repli propre
      // Purge EXPLICITE de l'image de série (« Retirer le fichier ») : colonne
      // NULL sur tous les tomes du même NOM STRICT (params[1]), entité -> null.
      // (Les fichiers orphelins sont nettoyés par removeSeriesImageGlobally —
      // non simulé ici, stub léger volontaire.)
      removeSeriesImageGlobally: async (name, seriesId = null) => {
        const wanted = String(name || '').trim();
        for (const c of Object.values(state.comics)) {
          if (!c.series || String(c.series).trim() !== wanted) continue;
          const attachedByEntity = seriesId != null && c.series_id === seriesId;
          const legacyByName = c.series_id == null;
          if (attachedByEntity || legacyByName) c.series_image = null;
        }
        state.seriesImage = null;
      },
    },
  };
  // fs.rmSync / fs.existsSync épiés (fichiers virtuels)
  const realRm = fs.rmSync;
  fs.rmSync = (p) => { removed.push(String(p)); return true; };
  fs.existsSync = () => false;
  return () => {
    fs.rmSync = realRm;
    delete require.cache[require.resolve(dbPath)];
    delete require.cache[require.resolve(seriesPath)];
  };
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.send = () => res;
  return res;
}

async function main() {
  const state = {
    comics: {}, vinyls: {}, comicId: null, vinylId: null,
    seriesId: null, seriesImage: null, artistId: null, artistImage: null,
  };
  const restore = install(state);
  const cc = require('./src/controllers/comicController');
  const vc = require('./src/controllers/vinylController');
  let fail = 0;
  try {
    // ================================================================
    // Scénario 1 — PUT /comics/1 : remove_cover + remove_series_image
    //   -> cover_url NULL ; series_image ÉCRASÉE par NULL (jamais l'ancienne
    //      image, jamais la couverture du TOME), purge GLOBALE : TOUS les tomes
    //      du même nom + entité Série perdent leur image — l'affichage retombe
    //      sur le repli propre local img/no_title.jpg côté tuile / formulaire.
    // ================================================================
    const comic = {
      id: 1, user_id: 5, title: 'Tome 1', series: 'Astérix',
      cover_url: '/uploads/comics/old-cover.jpg',
      series_image: '/uploads/series/old-logo.jpg', series_id: 9,
      authors: 'Goscinny', publisher: 'Casterman', isbn: null,
      tome_number: '1', illustrators: null, release_date: null, genre: null,
      synopsis: null, is_special_edition: false, is_signed: false,
      added_date: null, created_at: new Date(),
    };
    const otherComic = { ...comic, id: 2, series_id: 9, series_image: '/uploads/series/old-logo.jpg', cover_url: '/uploads/comics/t2.jpg' };
    state.comics = { 1: comic, 2: otherComic };
    state.comicId = 1;
    state.seriesId = 9;
    state.seriesImage = '/uploads/series/old-logo.jpg';

    const req1 = {
      user: { id: 5, role: 'user' }, params: { id: '1' }, files: [],
      body: {
        title: 'Tome 1', authors: 'Goscinny', publisher: 'Casterman', series: 'Astérix',
        remove_cover: 'true', remove_series_image: 'true',
      },
    };
    const res1 = await cc.updateComic(req1, makeRes(), (e) => { throw e; });
    assert.strictEqual(comic.cover_url, null, 'couverture -> NULL');
    assert.strictEqual(comic.series_image, null, `série 1 ÉCRASÉE par NULL (got ${comic.series_image})`);
    assert.strictEqual(otherComic.series_image, null, 'série 2 (autre tome) -> NULL : purge globale (entité + tous tomes du nom)');
    assert.strictEqual(state.seriesImage, null, 'entité série -> NULL (plus de photo associée)');
    assert.strictEqual(res1.body.comic.seriesImageUrl, null, 'DTO : seriesImageUrl null -> repli img/no_title.jpg côté tuile');
    console.log('S1 OK : remove_cover + remove_series_image (BD) — colonnes ÉCRASÉES par NULL, aucune valeur conservée ni réexposée');

    // ================================================================
    // Scénario 2 — PUT /comics/3 SANS drapeau : coverRemoteUrl local identique
    //   -> on conserve la jaquette existante (comportement conservatoire).
    // ================================================================
    const c3 = { ...comic, id: 3, cover_url: '/uploads/comics/c3.jpg', series_image: null, series: null, series_id: null };
    state.comics = { 3: c3 }; state.comicId = 3; state.seriesId = null;
    const req2 = {
      user: { id: 5, role: 'user' }, params: { id: '3' }, files: [],
      body: { title: 'T3', authors: 'A', publisher: 'P', series: '', coverRemoteUrl: '/uploads/comics/c3.jpg' },
    };
    await cc.updateComic(req2, makeRes(), (e) => { throw e; });
    assert.strictEqual(c3.cover_url, '/uploads/comics/c3.jpg', 'conserve la jaquette sans drapeau');
    console.log('S2 OK : sans drapeau, coverRemoteUrl local conserve la jaquette existante');

    // ================================================================
    // Scénario 3 — PUT /comics/4 : remove_cover + série retirée
    //   -> purge NULL (série_id / series_image) après l'UPDATE.
    // ================================================================
    const c4 = { ...comic, id: 4, cover_url: null, series_image: '/uploads/comics/c4.jpg', series: 'Astérix', series_id: 9 };
    state.comics = { 4: c4 }; state.comicId = 4; state.seriesId = 9;
    state.seriesImage = '/uploads/series/old-logo.jpg';
    const req3 = {
      user: { id: 5, role: 'user' }, params: { id: '4' }, files: [],
      body: { title: 'T4', authors: 'A', publisher: 'P', series: '', remove_cover: 'true' },
    };
    await cc.updateComic(req3, makeRes(), (e) => { throw e; });
    assert.strictEqual(c4.cover_url, null, 'cover null');
    assert.strictEqual(c4.series_image, null, 'series purgée à NULL (série retirée)');
    console.log('S3 OK : remove_cover + série vide -> purge NULL des colonnes série');

    // ================================================================
    // Scénario 4 — PUT /comics/5 : image DÉDIÉE propre déjà en base,
    //   AUCUN changement demandé -> elle est CONSERVÉE (jamais remplacée par la
    //   jaquette ni purgée). Avant le correctif de la variable
    //   `existingConservableImage` manquante, cette branche levait une
    //   ReferenceError et l'enregistrement échouait silencieusement.
    // ================================================================
    const c5 = { ...comic, id: 5, cover_url: '/uploads/comics/c5.jpg', series_image: '/uploads/series/logo-propre.jpg', series_id: 9 };
    state.comics = { 5: c5 }; state.comicId = 5; state.seriesId = 9;
    state.seriesImage = '/uploads/series/logo-propre.jpg';
    const req4 = {
      user: { id: 5, role: 'user' }, params: { id: '5' }, files: [],
      body: { title: 'T5', authors: 'A', publisher: 'P', series: 'Astérix', coverRemoteUrl: '/uploads/comics/c5.jpg' },
    };
    const res4 = await cc.updateComic(req4, makeRes(), (e) => { throw e; });
    assert.strictEqual(c5.series_image, '/uploads/series/logo-propre.jpg', `image dédiée conservée (got ${c5.series_image})`);
    assert.strictEqual(state.seriesImage, '/uploads/series/logo-propre.jpg', 'entité inchangée');
    assert.strictEqual(res4.body.comic.seriesImageUrl, '/uploads/series/logo-propre.jpg', 'DTO renvoie l\'image dédiée');
    console.log('S4 OK : sans changement, l\'image de série dédiée est conservée (pas de repli, pas de purge)');

    // ================================================================
    // Scénario 5 — PUT /comics/6 : contamination LEGACY en base
    //   (series_image = couverture du TOME) + aucun changement d'image demandé
    //   -> recalcul auto ; la jaquette est REJETEE (repli propre no_title.jpg,
    //   propagé à la série) — jamais recopiée dans series_image.
    // ================================================================
    const c6 = { ...comic, id: 6, cover_url: '/uploads/comics/c6.jpg', series_image: '/uploads/comics/c6.jpg', series_id: 9 };
    state.comics = { 6: c6, 7: { ...comic, id: 7, series: 'Astérix', series_id: 9, series_image: '/uploads/comics/c6.jpg', cover_url: '/uploads/comics/c7.jpg' } };
    state.comicId = 6; state.seriesId = 9;
    state.seriesImage = '/uploads/comics/c6.jpg'; // entité contaminée aussi
    const req5 = {
      user: { id: 5, role: 'user' }, params: { id: '6' }, files: [],
      body: { title: 'T6', authors: 'A', publisher: 'P', series: 'Astérix', coverRemoteUrl: '/uploads/comics/c6.jpg' },
    };
    await cc.updateComic(req5, makeRes(), (e) => { throw e; });
    assert.strictEqual(c6.series_image, '/img/no_title.jpg', `contamination corrigée -> no_title (got ${c6.series_image})`);
    assert.strictEqual(state.comics[7].series_image, '/img/no_title.jpg', 'autre tome de la série -> no_title (propagation)');
    assert.strictEqual(c6.cover_url, '/uploads/comics/c6.jpg', 'couverture du TOME inchangée (jamais touchée)');
    console.log('S5 OK : contamination legacy série=tome corrigée au save (repli propre, couverture préservée)');

    // ================================================================
    // Scénario 6 — PUT /comics/8 : remove_series_image SEUL (série encore
    //   déclarée) -> colonne série ÉCRASÉE par NULL sur ce tome, purge
    //   GLOBALE de l'image (entité + autres tomes du nom) ; jamais la jaquette
    //   du tome qui ne remplit jamais la colonne : l'affichage retombe sur le
    //   repli propre local img/no_title.jpg.
    // ================================================================
    const c7 = { ...comic, id: 8, cover_url: '/uploads/comics/c8.jpg', series_image: '/uploads/series/old-logo.jpg', series_id: 9 };
    const otherComic8 = { ...comic, id: 18, series: 'Astérix', series_id: 9, series_image: '/uploads/series/old-logo.jpg', cover_url: '/uploads/comics/c18.jpg' };
    state.comics = { 8: c7, 18: otherComic8 }; state.comicId = 8; state.seriesId = 9;
    state.seriesImage = '/uploads/series/old-logo.jpg';
    const req6 = {
      user: { id: 5, role: 'user' }, params: { id: '8' }, files: [],
      body: {
        title: 'T8', authors: 'A', publisher: 'P', series: 'Astérix',
        remove_series_image: 'true', coverRemoteUrl: '/uploads/comics/c8.jpg',
      },
    };
    const res6 = await cc.updateComic(req6, makeRes(), (e) => { throw e; });
    assert.strictEqual(c7.series_image, null, `suppression -> colonne ÉCRASÉE par NULL (got ${c7.series_image})`);
    assert.strictEqual(otherComic8.series_image, null, 'autre tome du même nom -> NULL : purge globale de l\'image retirée');
    assert.strictEqual(state.seriesImage, null, 'entité série -> NULL (plus de photo associée)');
    assert.strictEqual(c7.cover_url, '/uploads/comics/c8.jpg', 'la jaquette du TOME est préservée (seule series_image est touchée)');
    assert.strictEqual(res6.body.comic.seriesImageUrl, null, 'DTO : null -> repli img/no_title.jpg côté tuile');
    console.log('S6 OK : remove_series_image seul -> colonnes ÉCRASÉES par NULL, purge globale (jaquette du tome intacte)');

    // ================================================================
    // Scénario 7 — PUT /vinyls/10 : remove_cover + remove_artist_image
    //   -> cover_url NULL ; artist_image ÉCRASÉE par NULL (jamais l'ancienne
    //      photo, JAMAIS la jaquette d'album) : purge GLOBALE de TOUS les
    //      disques du même artiste + entité Artiste — tuiles « Mes Disques »
    //      sur le repli propre local img/no_group.jpg.
    // ================================================================
    const v = {
      id: 10, user_id: 5, title: 'OK Computer', artist: 'Radiohead',
      cover_url: '/uploads/vinyls/old-jacket.jpg',
      artist_image: '/uploads/artists/rh-old.jpg', artist_id: 7,
      track_count: 1, tracklist: null, genre: null, label: null, release_date: null,
      barcode: null, mbid: null, discogs_release_id: null, discogs_url: null,
      acquired_date: null, notes: null, is_special_edition: false,
      is_picture_disc: false, discs_count: 1, color: 'Noir', created_at: new Date(),
    };
    const v2 = { ...v, id: 11, artist_image: '/uploads/artists/rh-old.jpg' };
    state.vinyls = { 10: v, 11: v2 };
    state.vinylId = 10;
    state.artistId = 7;
    state.artistImage = '/uploads/artists/rh-old.jpg';
    const rv = {
      user: { id: 5, role: 'user' }, params: { id: '10' }, files: [],
      body: { title: 'OK', artist: 'Radiohead', remove_cover: 'true', remove_artist_image: 'true' },
    };
    const res7 = await vc.updateVinyl(rv, makeRes(), (e) => { throw e; });
    assert.strictEqual(v.cover_url, null, 'jaquette -> NULL');
    assert.strictEqual(v.artist_image, null, `artiste ÉCRASÉ par NULL (got ${v.artist_image})`);
    assert.strictEqual(v2.artist_image, null, 'autre disque du même artiste -> NULL : purge globale (jamais la jaquette ni l\'ancienne photo)');
    assert.strictEqual(state.artistImage, null, 'entité Artiste -> NULL (plus de photo associée)');
    assert.strictEqual(res7.body.vinyl.artistImage, null, 'DTO : artistImage null -> repli img/no_group.jpg côté tuile');
    console.log('S7 OK : remove_cover + remove_artist_image (vinyle) — colonnes ÉCRASÉES par NULL, purge globale');

    // ================================================================
    // Scénario 8 — PUT /vinyls/12 SANS drapeau, image d'artiste PROPRE en base
    //   -> jaquette ET photo conservées (rien de nouveau fourni).
    // ================================================================
    const v3 = { ...v, id: 12, artist_id: 7, cover_url: '/uploads/vinyls/v12.jpg', artist_image: '/uploads/artists/rh-propre.jpg' };
    state.vinyls = { 12: v3 }; state.vinylId = 12; state.artistId = null; state.artistImage = null;
    const rv2 = {
      user: { id: 5, role: 'user' }, params: { id: '12' }, files: [],
      body: { title: 'V12', artist: 'Radiohead', coverRemoteUrl: '/uploads/vinyls/v12.jpg' },
    };
    await vc.updateVinyl(rv2, makeRes(), (e) => { throw e; });
    assert.strictEqual(v3.cover_url, '/uploads/vinyls/v12.jpg', 'conserve la jaquette sans drapeau');
    assert.strictEqual(v3.artist_image, '/uploads/artists/rh-propre.jpg', 'conserve l\'image d\'artiste propre');
    console.log('S8 OK : sans drapeau, jaquette ET image d\'artiste conservées');

    // ================================================================
    // Scénario 9 — PUT /vinyls/13 : contamination LEGACY en base
    //   (artist_image = jaquette du DISQUE lui-même) + aucun changement
    //   demandé -> le COALESCE la conserve puis la PURGE explicite : colonne
    //   NULL, DTO artistImage = null (repli propre no_group côté tuiles).
    //   Jamais propagée à l'entité ni aux autres disques de l'artiste.
    // ================================================================
    const v13 = { ...v, id: 13, cover_url: '/uploads/vinyls/j13.jpg', artist_image: '/uploads/vinyls/j13.jpg' };
    state.vinyls = { 13: v13 }; state.vinylId = 13;
    const rv3 = {
      user: { id: 5, role: 'user' }, params: { id: '13' }, files: [],
      body: { title: 'V13', artist: 'Radiohead', coverRemoteUrl: '/uploads/vinyls/j13.jpg' },
    };
    const res9 = await vc.updateVinyl(rv3, makeRes(), (e) => { throw e; });
    assert.strictEqual(v13.cover_url, '/uploads/vinyls/j13.jpg', 'jaquette inchangée');
    assert.strictEqual(v13.artist_image, null, `contamination purgée à NULL (got ${v13.artist_image})`);
    assert.strictEqual(res9.body.vinyl.artistImage, null, 'DTO : jamais la jaquette en image d\'artiste');
    console.log('S9 OK : contamination legacy artiste=jaquette auto-réparée au save (colonne NULL, DTO null, jaquette préservée)');

    // ================================================================
    // Scénario 10 — DTO toVinylDto : filtres dissociation (lecture seule).
    // ================================================================
    const dtoContaminated = vc.toVinylDto({
      id: 99, user_id: 5, cover_url: '/uploads/vinyls/x.jpg', artist_image: 'https://site.local/uploads/vinyls/x.jpg',
      artist: 'A', title: 'T', track_count: 1, release_date: null, acquired_date: null,
      is_picture_disc: false, discs_count: 1, color: 'Noir',
    });
    assert.strictEqual(dtoContaminated.artistImage, null, 'DTO : contamine legacy (avec origine) -> null');
    const dtoEmblem = vc.toVinylDto({
      id: 98, user_id: 5, cover_url: '/uploads/vinyls/y.jpg', artist_image: '/img/no_group.jpg',
      artist: 'A', title: 'T', track_count: 1, release_date: null, acquired_date: null,
      is_picture_disc: false, discs_count: 1, color: 'Noir',
    });
    assert.strictEqual(dtoEmblem.artistImage, null, 'DTO : emblème par défaut -> null (absence)');
    const dtoProper = vc.toVinylDto({
      id: 97, user_id: 5, cover_url: '/uploads/vinyls/z.jpg', artist_image: '/uploads/artists/photo.jpg',
      artist: 'A', title: 'T', track_count: 1, release_date: null, acquired_date: null,
      is_picture_disc: false, discs_count: 1, color: 'Noir',
    });
    assert.strictEqual(dtoProper.artistImage, '/uploads/artists/photo.jpg', 'DTO : vraie photo conservée');
    console.log('S10 OK : toVinylDto filtre contamination / emblème par défaut, conserve la vraie photo');

    console.log('\nTous les scénarios de suppression explicite / dissociation passent.');
  } catch (err) {
    fail = 1;
    console.error('ÉCHEC :', err.message);
  } finally {
    restore();
  }
  process.exit(fail);
}
main();
