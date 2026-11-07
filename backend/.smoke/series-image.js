/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
// Smoke test LOCAL (sans SSH / sans base) du visuel GLOBAL d'une SÉRIE.
// - mocke uniquement la couche db et fetch global ;
// - UPLOAD_DIR redirigé vers un dossier temporaire ;
// - vérifie : cascade Open Library (série) -> Google Books -> Open Library
//   (autoFetchSeriesImage, encore exposée), réutilisation de l'image existante
//   (y compris le repli déjà attribué -> aucun re-appel API) et ABSENCE de
//   recherche automatique forcée par le résolveur contrôleur : sans visuel
//   existant, la colonne series_image reste VIDE (null) — l'affichage retombe
//   sur l'emblème par défaut img/no_title.jpg.
process.env.NODE_ENV = 'development';

const path = require('path');
const fs = require('fs');
const os = require('os');

const UPLOAD_DIR = path.join(os.tmpdir(), 'geek0thek-smoke-series');
fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
process.env.UPLOAD_DIR = UPLOAD_DIR;

// ---- Mock db AVANT que les modules l'exigent (via require) ----
const dbFile = require.resolve('../src/config/db');
let seriesStore = [];
require.cache[dbFile] = {
  id: dbFile,
  filename: dbFile,
  loaded: true,
  exports: {
    pool: { query: async () => ({ rows: [] }) },
    migrate: async () => {},
    query: async (sql, params) => {
      const p = params || [];
      if (/FROM series WHERE norm_name/.test(sql)) {
        const row = seriesStore.find((s) => s.norm_name === p[0]);
        return { rows: row ? [{ ...row }] : [] };
      }
      if (/^INSERT INTO series \(/.test(sql)) {
        const row = { id: seriesStore.length + 1, name: p[0], norm_name: p[1], image_url: p[2] || null };
        seriesStore.push(row);
        return { rows: [row] };
      }
      if (/^UPDATE series SET image_url/.test(sql)) {
        const row = seriesStore.find((s) => s.id === p[1]);
        if (row) { row.image_url = p[0]; row.updated_at = new Date().toISOString(); }
        return { rows: row ? [row] : [] };
      }
      throw new Error('SQL non attendu dans le smoke test : ' + sql);
    },
  },
};

// ---- Mock fetch global : journalise les appels, sert une fausse PNG ----
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);
const calls = [];
let failAll = false;

global.fetch = async (url, opts) => {
  const u = String(url);
  calls.push(u);
  if (failAll) throw new Error('réseau coupé (simulé)');
  const imgResponse = () => ({
    ok: true,
    status: 200,
    headers: { get: (h) => (String(h).toLowerCase() === 'content-type' ? 'image/png' : null) },
    json: async () => ({}),
    arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
  });
  const olSeries = u.lastIndexOf('/series/');
  if (olSeries >= 0 && u.endsWith('.json')) {
    // logo global de série SEULEMENT pour « Blake et Mortimer »
    if (/Blake et Mortimer/i.test(u)) {
      return {
        ok: true, status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ docs: [{ illustration_id: 123456, cover_i: 999 }], title: 'Blake et Mortimer' }),
      };
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  }
  if (/googleapis\.com\/books/.test(u)) {
    // couverture Google Books seulement si la requête n'est PAS portée par un titre de tome
    if (/[?&]q=/.test(u) && /tintin et le lac des loups/i.test(u)) {
      calls.push('BUG: recherche portée par le titre du tome dans Google Books! ' + u);
    }
    return {
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ items: [{ volumeInfo: { imageLinks: { extraLarge: 'https://books.google.com/cover-x.jpg' } } }] }),
    };
  }
  if (/openlibrary\.org\/search\.json/.test(u)) {
    return {
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      json: async () => ({ docs: [{ cover_i: 777 }], title: 'x' }),
    };
  }
  if (/covers\.openlibrary\.org\/p\/id\//.test(u)) return imgResponse(); // logo série OL
  if (/covers\.openlibrary\.org\/b\/id\//.test(u)) return imgResponse();  // cover OL
  if (/google\.com\/cover-x/.test(u)) return imgResponse();               // cover GB
  return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
};

const seriesService = require('../src/utils/seriesService');

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
}

(async () => {
  console.log('\n[1] Série AVEC logo OL (« Blake et Mortimer ») -> visuel GLOBAL téléchargé localement');
  calls.length = 0;
  let img = await seriesService.autoFetchSeriesImage('Blake et Mortimer');
  check('chemin local /uploads/series/…', typeof img === 'string' && img.startsWith('/uploads/series/'), img);
  const p1 = path.join(UPLOAD_DIR, img.replace(/^\/uploads\//, ''));
  check('fichier téléchargé présent dans <uploadDir>/series/', fs.existsSync(p1), p1);
  check('contenu identique à la PNG servie par le logo OL', fs.existsSync(p1) && Buffer.from(fs.readFileSync(p1)).equals(PNG));
  check('cascade partie par les métadonnées SÉRIE Open Library', calls.some((c) => c.includes('/series/blake') || /openlibrary.org\/series\/blake/i.test(c)), JSON.stringify(calls));
  check('couverture de TOME jamais utilisée (pas de /b/id/999 = cover_i)', !calls.some((c) => c.includes('/b/id/999')), JSON.stringify(calls));

  console.log("\n[2] SANS logo OL mais avec Google Books (« Tintin ») -> visuel GB sur nom de série seul");
  calls.length = 0;
  img = await seriesService.autoFetchSeriesImage('Tintin');
  check('chemin local /uploads/series/…', typeof img === 'string' && img.startsWith('/uploads/series/') && img !== p1, img);
  check('aucune recherche Google Books portée par le titre du tome', !calls.some((c) => c.startsWith('BUG')), JSON.stringify(calls.filter((c) => c.startsWith('BUG'))));

  console.log('\n[3] ABSENCE totale de résultat (réseau coupé) -> repli FORCÉ img/no_title.jpg');
  failAll = true; try {
    img = await seriesService.autoFetchSeriesImage('Série inconnue sans image');
    check('repli propre /img/no_title.jpg retourné', img === '/img/no_title.jpg', img);
    check('chemin physique de secours présent (C:\\Users\\irwin\\geek0thek\\img\\no_title.jpg)', fs.existsSync('C:/Users/irwin/geek0thek/img/no_title.jpg'));
  } finally { failAll = false; }

  console.log('\n[4] Résolveur contrôleur — série déjà référencée : réutilisation, ZERO appel API');
  calls.length = 0;
  seriesStore = [{ id: 1, name: 'Blake et Mortimer', norm_name: 'blake et mortimer', image_url: '/uploads/series/cover-aaa.png' }];
  const { autoResolveComicSeriesImage } = require('../src/controllers/comicController');
  let r = await autoResolveComicSeriesImage('Blake et Mortimer');
  check("from='existing'", r.from === 'existing', JSON.stringify(r));
  check('image existante réutilisée telle quelle', r.image === '/uploads/series/cover-aaa.png', r.image);
  check('aucun appel fetch (pas de re-recherche à chaque tome)', calls.length === 0, JSON.stringify(calls));

  console.log('\n[5] Résolveur contrôleur — série référencée avec le repli déjà attribué : réutilisation du repli');
  calls.length = 0;
  // ⚠ norme exacte de normalizeSeriesName() : minuscules, ACCENTS CONSERVÉS.
  seriesStore = [{ id: 2, name: 'Série sans image', norm_name: 'série sans image', image_url: '/img/no_title.jpg' }];
  r = await autoResolveComicSeriesImage('Série sans image');
  check("from='existing' (repli déjà attribué -> pas de re-recherche)", r.from === 'existing', JSON.stringify(r));
  check('image = /img/no_title.jpg conservée', r.image === '/img/no_title.jpg', r.image);
  check('aucun appel fetch', calls.length === 0, JSON.stringify(calls));

  console.log('\n[6] Résolveur contrôleur — série inconnue + APIs OK -> AUCUNE recherche auto forcée');
  calls.length = 0; seriesStore = [];
  r = await autoResolveComicSeriesImage('Blake et Mortimer');
  check("from='none' (plus de recherche automatique à la création)", r.from === 'none', JSON.stringify(r));
  check('image null (colonne laissée VIDE — repli img/no_title.jpg à l\'affichage)', r.image === null, JSON.stringify(r));
  check('aucun appel fetch (jamais de re-recherche à chaque tome)', calls.length === 0, JSON.stringify(calls));

  // L'appelant (createComic) ne crée l'entité SÉRIE que sans image ; un 2e
  // tome de la même série retombe sur « aucun visuel » tant qu'aucun visuel
  // n'a été fourni par l'utilisateur :
  const ent = await seriesService.ensureSeries('Blake et Mortimer', null);
  check("entité Série créée SANS image (comics.series_image restera NULL)", Number.isFinite(ent.seriesId) && ent.image === null, JSON.stringify(ent));
  const r2 = await autoResolveComicSeriesImage('blake et mortimer');
  check('2e tome : toujours aucun visuel (entité sans image)', r2.from === 'none' && r2.image === null, JSON.stringify(r2));

  console.log('\n[7] Résolveur contrôleur — série inconnue + APIs HS -> colonne VIDE (null)');
  calls.length = 0; seriesStore = []; failAll = true; try {
    r = await autoResolveComicSeriesImage('Série fantôme');
    // Plus AUCUNE recherche automatique : le résolveur ne fait jamais d'appel
    // réseau, la GARANTIE c'est l'image — null (l'affichage retombe sur
    // img/no_title.jpg), jamais une couverture de tome.
    check("from='none' et image null, réseau coupé", r.from === 'none' && r.image === null, JSON.stringify(r));
  } finally { failAll = false; }

  console.log('\n================ RESULTAT ================');
  console.log(`PASS: ${passed}   FAIL: ${failed}`);
  console.log('==========================================');
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error('UNCAUGHT', e);
  process.exit(3);
});
