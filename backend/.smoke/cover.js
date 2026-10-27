// Harness de reproduction du bug de persistance de jaquette (vinyles)
// - monte les VRAIES routes vinylRoutes (multer + auth JWT réels)
// - mocke uniquement la couche db (requête in-mémoire)
// - UPLOAD_DIR redirigée vers un dossier temporaire
process.env.NODE_ENV = 'development';

const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const UPLOAD_DIR = path.join(os.tmpdir(), 'geek0thek-smoke-uploads');
fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'vinyls'), { recursive: true });
process.env.UPLOAD_DIR = UPLOAD_DIR;

// ---- Mock PostgreSQL module BEFORE controllers require it ----
const dbFile = require.resolve('../src/config/db');
const VINYL_STORE = [
  {
    id: 1,
    user_id: 1,
    cover_url: null,
    artist: 'Test Artist',
    title: 'Test Album',
    track_count: 0,
    tracklist: null,
    genre: null,
    label: null,
    release_date: null,
    barcode: null,
    mbid: null,
    discogs_release_id: null,
    discogs_url: null,
    acquired_date: null,
    notes: null,
    created_at: new Date().toISOString(),
  },
];
require.cache[dbFile] = {
  id: dbFile,
  filename: dbFile,
  loaded: true,
  exports: {
    pool: { query: async () => ({ rows: [] }) },
    migrate: async () => {},
    query: async (sql, params) => {
      const p = params || [];
      if (/FROM users WHERE id/i.test(sql)) {
        return {
          rows: [
            {
              id: 1,
              login: 'smoke',
              role: 'user',
              first_name: 'Smoke',
              last_name: 'Test',
              email: 's@t.c',
              is_public: true,
              is_active: true,
              avatar_url: null,
            },
          ],
        };
      }
      if (/^INSERT INTO vinyls/i.test(sql)) {
        const row = {
          id: VINYL_STORE.length + 1,
          user_id: p[0],
          cover_url: p[1],
          artist: p[2],
          title: p[3],
          track_count: p[4],
          tracklist: p[5],
          genre: p[6],
          label: p[7],
          release_date: p[8],
          barcode: p[9],
          mbid: p[10],
          discogs_release_id: p[11],
          discogs_url: p[12],
          acquired_date: p[13] || new Date().toISOString().slice(0, 10),
          notes: p[14],
          created_at: new Date().toISOString(),
        };
        VINYL_STORE.push(row);
        return { rows: [row] };
      }
      if (/SELECT \* FROM vinyls WHERE id/i.test(sql)) {
        const rows = VINYL_STORE.filter((v) => Number(v.id) === Number(p[0]));
        return { rows: [...rows] };
      }
      if (/^UPDATE vinyls/i.test(sql)) {
        // $19 = id dans la requête du contrôleur (index 18 du tableau).
        // Mapping complet sur les 19 paramètres bindés.
        const v = VINYL_STORE.find((x) => Number(x.id) === Number(p[18]));
        if (!v) return { rows: [] };
        Object.assign(v, {
          artist: p[0],
          title: p[1],
          track_count: p[2],
          tracklist: p[3],
          genre: p[4],
          label: p[5],
          release_date: p[6],
          barcode: p[7],
          mbid: p[8],
          discogs_release_id: p[9],
          discogs_url: p[10],
          acquired_date: p[11] !== null && p[11] !== undefined ? p[11] : v.acquired_date,
          notes: p[12],
          cover_url: p[13],
          is_special_edition: p[14],
          is_picture_disc: p[15],
          discs_count: p[16],
          color: p[17],
        });
        return { rows: [{ ...v }] };
      }
      return { rows: [] };
    },
  },
};

const express = require('express');
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const vinylRoutes = require('../src/routes/vinylRoutes');

const TOKEN = jwt.sign({ sub: 1 }, env.jwt.secret, { expiresIn: '1h' });

// PNG 1x1 rouge
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

let passed = 0;
let failed = 0;
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log('  PASS  ' + name);
  } else {
    failed++;
    console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : ''));
  }
}

// Serveur "distant" de fausse image (simule Cover Art Archive / URL distante)
let remoteServer;
function startRemoteServer() {
  const s = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(PNG);
  });
  return new Promise((resolve) => s.listen(0, '127.0.0.1', () => resolve(s)));
}

(async () => {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use(
    '/uploads',
    express.static(UPLOAD_DIR, { index: false })
  );
  app.use('/api/vinyls', vinylRoutes);
  app.use((req, res) => res.status(404).json({ error: '404 ' + req.url }));

  const server = app.listen(0);
  const PORT = server.address().port;
  const BASE = `http://127.0.0.1:${PORT}`;
  const remote = await startRemoteServer();
  const REMOTE_URL = `http://127.0.0.1:${remote.address().port}/cover.png`;

  const call = async (method, urlPath, { form, json, rawUrl } = {}) => {
    const pathUrl = rawUrl ? rawUrl : BASE + urlPath;
    const options = { method };
    if (TOKEN) options.headers = { Authorization: `Bearer ${TOKEN}` };
    if (json) {
      options.headers = { ...options.headers, 'Content-Type': 'application/json' };
      options.body = JSON.stringify(json);
    } else if (form) options.body = form;
    const res = await fetch(pathUrl, options);
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {}
    return { status: res.status, data, text };
  };

  try {
    console.log('\n[1] Création — upload multipart d’un fichier local (champ cover)');
    const fd = new FormData();
    fd.append('cover', new Blob([PNG], { type: 'image/png' }), 'jaquette.png');
    fd.append('artist', 'Pink Floyd');
    fd.append('title', 'The Dark Side of the Moon');
    fd.append('track_count', '15');
    fd.append('tracklist', 'Speak to Me');
    fd.append('genre', 'Progressive Rock');
    fd.append('label', 'Harvest');
    fd.append('release_date', '1973-03-01');
    fd.append('barcode', '0190295958361');
    fd.append('mbid', '');
    fd.append('discogs_release_id', '');
    fd.append('discogs_url', '');
    fd.append('acquired_date', '2026-10-23');
    fd.append('notes', '');
    const r1 = await call('POST', '/api/vinyls', { form: fd });
    check('POST /vinyls (fichier) -> 201', r1.status === 201, r1.text);
    const c1 = r1.data && r1.data.vinyl && r1.data.vinyl.coverUrl;
    check('coverUrl persisté (non nul)', Boolean(c1), r1.text);
    check(
      'coverUrl pointe vers /uploads/vinyls/<fichier>',
      typeof c1 === 'string' && /^\/uploads\/vinyls\/[A-Za-z0-9._-]+$/.test(c1),
      JSON.stringify(c1)
    );
    const vinylId = r1.data && r1.data.vinyl ? r1.data.vinyl.id : null;

    // Le fichier doit EXISTER physiquement sur le volume
    const diskPath = c1
      ? path.join(UPLOAD_DIR, c1.replace(/^\/uploads\//, ''))
      : null;
    check(
      'fichier présent dans <uploadDir>/vinyls/',
      diskPath ? fs.existsSync(diskPath) : false,
      diskPath || 'chemin absent'
    );
    check('contenu du fichier identique au png envoyé', diskPath ? fs.readFileSync(diskPath).equals(PNG) : false);

    // La « Date d'ajout » (remplace l'année d'acquisition) est persistée telle quelle.
    const added = r1.data && r1.data.vinyl ? r1.data.vinyl.addedDate : null;
    check('addedDate persisté (YYYY-MM-DD)', added === '2026-10-23', JSON.stringify(added));

    // GET /uploads/... (comme le fait le browser sur l'origine du site)
    if (c1) {
      const imgRes = await fetch(BASE + c1);
      const imgBuf = Buffer.from(await imgRes.arrayBuffer());
      check('GET <origine>' + c1 + ' -> 200 image/png', imgRes.status === 200 && String(imgRes.headers.get('content-type') || '').includes('image/png'), imgRes.status + ' ' + imgRes.headers.get('content-type'));
      check('bytes servis identiques', imgBuf.equals(PNG));
    }

    console.log('\n[2] Édition — même jaquette, aucun nouveau fichier (body JSON, coverRemoteUrl = chemin existant)');
    const r2 = await call('PUT', `/api/vinyls/${vinylId}`, {
      json: {
        artist: 'Pink Floyd',
        title: 'The Dark Side of the Moon (Réédition)',
        track_count: 15,
        tracklist: null,
        genre: null,
        label: null,
        release_date: null,
        barcode: null,
        mbid: null,
        discogsReleaseId: null,
        discogsUrl: null,
        acquired_date: '2026-10-23',
        notes: null,
        coverRemoteUrl: c1,
      },
    });
    check('PUT /vinyls/:id (sans nouvelle jaquette) -> 200', r2.status === 200, r2.text);
    const c2 = r2.data && r2.data.vinyl && r2.data.vinyl.coverUrl;
    check('jaquette conservée après édition (aucune erreur 400)', c2 === c1, JSON.stringify({ avant: c1, apres: c2 }, null, 2));

    console.log('\n[3] Édition — remplacement par une autre URL distante');
    const before3 = fs.readdirSync(path.join(UPLOAD_DIR, 'vinyls'));
    const r3 = await call('PUT', `/api/vinyls/${vinylId}`, {
      json: {
        artist: 'Pink Floyd',
        title: 'The Dark Side of the Moon',
        track_count: 15,
        coverRemoteUrl: REMOTE_URL,
      },
    });
    check('PUT /vinyls/:id (URL distante) -> 200', r3.status === 200, r3.text);
    const c3 = r3.data && r3.data.vinyl && r3.data.vinyl.coverUrl;
    check('nouvelle coverUrl locale /uploads/vinyls/…', typeof c3 === 'string' && c3.startsWith('/uploads/vinyls/') && c3 !== c2, JSON.stringify(c3));
    if (c3) {
      const p3 = path.join(UPLOAD_DIR, c3.replace(/^\/uploads\//, ''));
      check('nouveau fichier téléchargé présent', fs.existsSync(p3), p3);
      check('fichier téléchargé identique au PNG distant', fs.existsSync(p3) && fs.readFileSync(p3).equals(PNG));
      const oldPath = path.join(UPLOAD_DIR, String(c2).replace(/^\/uploads\//, ''));
      check('ancienne jaquette retirée du disque', !fs.existsSync(oldPath), oldPath);
    }

    console.log('\n[4] Édition — remplacement par un FICHIER multipart (mode édition, preview -> submit)');
    const fd4 = new FormData();
    fd4.append('cover', new Blob([PNG], { type: 'image/png' }), 'nouveaudejaquette.png');
    fd4.append('artist', 'Pink Floyd');
    fd4.append('title', 'The Dark Side of the Moon');
    fd4.append('track_count', '15');
    const r4 = await call('PUT', `/api/vinyls/${vinylId}`, { form: fd4 });
    check('PUT /vinyls/:id (fichier multipart) -> 200', r4.status === 200, r4.text);
    const c4 = r4.data && r4.data.vinyl && r4.data.vinyl.coverUrl;
    check('coverUrl mis à jour après upload en édition', typeof c4 === 'string' && c4.startsWith('/uploads/vinyls/') && c4 !== c3, JSON.stringify({ avant: c3, apres: c4 }));
    if (c4) {
      const p4 = path.join(UPLOAD_DIR, c4.replace(/^\/uploads\//, ''));
      check('fichier multipart écrit sur disque', fs.existsSync(p4) && fs.readFileSync(p4).equals(PNG), p4);
    }

    console.log('\n[5] Création — sans aucune jaquette (ni fichier ni URL) -> 400 clair');
    const r5 = await call('POST', '/api/vinyls', {
      json: { artist: 'X', title: 'Y', track_count: 0, coverRemoteUrl: null },
    });
    check('POST sans jaquette -> 400', r5.status === 400, r5.text);

    console.log('\n[6] GET /uploads/chemin-absent -> 404 (fichier orphelin)');
    const r6 = await fetch(BASE + '/uploads/vinyls/cover-pas-ici.png');
    check('GET /uploads manquant -> 404', r6.status === 404, String(r6.status));
    void before3;
  } finally {
    server.close();
    remote.close();
  }

  console.log(`\n================ RESULTAT ================`);
  console.log(`PASS: ${passed}   FAIL: ${failed}`);
  console.log('==========================================');
  process.exit(failed > 0 ? 1 : 0);
})().catch((e) => {
  console.error('UNCAUGHT', e);
  process.exit(3);
});
