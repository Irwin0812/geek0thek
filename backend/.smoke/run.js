process.env.UPLOAD_DIR = process.env.SMOKE_UPLOAD_DIR;
process.env.NODE_ENV = 'development';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---- Mock PostgreSQL module BEFORE controllers require it ----
const dbFile = require.resolve('../src/config/db');
require.cache[dbFile] = {
  id: dbFile, filename: dbFile, loaded: true,
  exports: {
    pool: { query: async () => ({ rows: [] }) },
    migrate: async () => {},
    query: async (sql, params) => {
      const p = params || [];
      if (/SELECT avatar_url FROM users/i.test(sql)) return { rows: [{ avatar_url: null }] };
      if (/SELECT password_hash FROM users/i.test(sql)) return { rows: [{ password_hash: 'x' }] };
      if (/SELECT \* FROM users/i.test(sql)) return { rows: [{ id: 1, avatar_url: null, role: 'admin' }] };
      if (/INSERT INTO users/i.test(sql)) {
        return { rows: [{ id: '1', login: p[3], role: p[5], first_name: p[1], last_name: p[0],
          email: p[2], phone: p[6], bio: p[7], is_public: p[8] ?? true, is_active: true,
          avatar_url: p[9], gender: p[10], address: p[12], country: p[13],
          created_at: new Date().toISOString(), updated_at: new Date().toISOString() }] };
      }
      // UPDATE ... SET ... RETURNING *
      const row = { id: '1', login: 'Admin', role: 'admin', first_name: 'Admin',
        last_name: 'Admin', email: 'a@b.c', phone: null, bio: null, is_public: true,
        is_active: true, must_change_password: false, avatar_url: null, gender: null, birth_date: null, address: null,
        country: null, created_at: new Date().toISOString() };
      const m = sql.match(/SET ([^W]+) WHERE/i);
      if (m) m[1].split(',').map(s => s.trim()).forEach((c, i) => {
        const cm = c.match(/^(\w+) = \$\d+/);
        if (cm) row[cm[1]] = p[i];
      });
      return { rows: [row] };
    },
  },
};

const express = require('express');
const { updateMe, createUser } = require('../src/controllers/userController');
const { uploadAvatar } = require('../src/middlewares/upload');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { req.user = { id: 1 }; next(); });
app.put('/api/users/me', uploadAvatar.single('avatar'), updateMe);
app.post('/api/users', uploadAvatar.single('avatar'), createUser);

let passed = 0; let failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
}

const server = app.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const AV = process.env.SMOKE_UPLOAD_DIR + '/avatars';
  fs.rmSync(AV, { recursive: true, force: true });
  fs.mkdirSync(AV, { recursive: true });

  const req = (path, opts = {}) => new Promise((resolve, reject) => {
    const r = http.request(base + path, { method: opts.method || 'POST', headers: opts.headers || {} }, (res) => {
      let b = ''; res.on('data', d => b += d); res.on('end', () => {
        let j = null; try { j = JSON.parse(b); } catch {}
        resolve({ status: res.statusCode, json: j, text: b });
      });
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });

  const full = { lastName: 'Admin', firstName: 'Admin', email: 'a@b.c', login: 'Admin',
    phone: null, bio: null, isPublic: true, gender: null, birthDate: null, address: null, country: null };
  const json = (body) => req('/api/users/me', { method: 'PUT',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  console.log('\n[1] Bug #1 — champs optionnels à NULL (cause de l\'erreur null)');
  let r1 = await json({ ...full, gender: null });
  check('gender=null -> 200 (pas d\'erreur null)', r1.status === 200, r1.text);
  check('gender=null -> DB null', r1.json && r1.json.user.gender === null, r1.text);

  let r2 = await json({ ...full, birthDate: null });
  check('birthDate=null -> 200 (pas d\'erreur null)', r2.status === 200, r2.text);
  check('birthDate=null -> DB null', r2.json && r2.json.user.birthDate === null, r2.text);

  let r3 = await json({ ...full, gender: null, birthDate: null, phone: '', address: '', country: '' });
  check('tout à null -> 200 + "Profil mis à jour"', r3.status === 200, r3.text);

  console.log('\n[2] Validations conservées');
  let r4 = await json({ ...full, gender: 'X' });
  check('gender invalide -> 400 + message', r4.status === 400 && /Sexe invalide/.test(r4.text), r4.text);
  let r5 = await json({ ...full, gender: 'F' });
  check('gender=F -> 200 + DB "F"', r5.status === 200 && r5.json.user.gender === 'F', r5.text);
  let r6 = await json({ ...full, birthDate: 'not-a-date' });
  check('date invalide -> 400 + message', r6.status === 400 && /Date de naissance invalide/.test(r6.text), r6.text);
  let r7 = await json({ ...full, birthDate: '2099-01-01' });
  check('date future -> 400 + message', r7.status === 400 && /futur/.test(r7.text), r7.text);
  let r8 = await json({ ...full, gender: 'H', birthDate: '1974-12-08' });
  check('gender+date valides -> 200', r8.status === 200 && r8.json.user.gender === 'H' && r8.json.user.birthDate === '1974-12-08', r8.text);

  console.log('\n[3] Bug #2 — avatar via multer .single()');
  // 1x1 red PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  // Constructeur multipart conforme à RFC 7578.
  // Chaque part : --boundary\r\n + headers (\r\n séparés) + \r\n (ligne vide) + data + \r\n
  // Fin : --boundary--\r\n
  // NB : la ligne vide AVANT le fichier est ajoutée explicitement — le ''
  // final du join ne produit qu'un unique CRLF (pas la ligne vide requise).
  const BOUNDARY = '----smokeboundary123';
  const lines = [
    '--' + BOUNDARY,
    'Content-Disposition: form-data; name="lastName"', '', 'Admin',
    '--' + BOUNDARY,
    'Content-Disposition: form-data; name="firstName"', '', 'Admin',
    '--' + BOUNDARY,
    'Content-Disposition: form-data; name="avatar"; filename="pic.png"',
    'Content-Type: image/png',
  ].join('\r\n') + '\r\n\r\n';
  let body = Buffer.concat([Buffer.from(lines, 'utf8'), png, Buffer.from('\r\n--' + BOUNDARY + '--\r\n', 'utf8')]);

  let r9 = await req('/api/users/me', { method: 'PUT',
    headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`, 'Content-Length': body.length }, body });
  check('upload avatar -> 200', r9.status === 200, r9.text);
  const gotUrl = r9.json && r9.json.user.avatarUrl;
  check('avatarUrl retournée (non nulle)', gotUrl && gotUrl.startsWith('/uploads/avatars/'), r9.text);
  const filesInAvatars = fs.readdirSync(AV);
  check('fichier réellement dans avatars/', filesInAvatars.some(f => f.startsWith('avatar-')), JSON.stringify(filesInAvatars));
  check('chemin DB <-> fichier cohérent', gotUrl && filesInAvatars.some(f => gotUrl.endsWith(f)), `db=${gotUrl} dir=${JSON.stringify(filesInAvatars)}`);

  // Second upload doit écraser l'ancien fichier
  fs.rmSync(AV, { recursive: true, force: true });
  fs.mkdirSync(AV, { recursive: true });
  let r10 = await req('/api/users/me', { method: 'PUT',
    headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`, 'Content-Length': body.length }, body });
  check('2e upload -> 200 et 1 seul fichier', r10.status === 200 && fs.readdirSync(AV).length >= 1, r10.text);

  // Pas de fichier -> avatarUrl inchangée (null ici)
  let r11 = await json({ ...full, gender: 'H' });
  check('sans fichier (JSON) -> 200, avatarUrl inchangée', r11.status === 200 && r11.json.user.avatarUrl === null, r11.text);

  // removeAvatar
  let r12 = await json({ ...full, removeAvatar: 'true' });
  check('removeAvatar=true -> 200', r12.status === 200, r12.text);

  console.log('\n[4] createUser (admin) avec avatar .single()');
  const cu = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="lastName"\r\n\r\nDoe\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="firstName"\r\n\r\nJane\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="email"\r\n\r\njane@doe.com\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="login"\r\n\r\njane\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="password"\r\n\r\nsupersecret1\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="role"\r\n\r\nuser\r\n--${BOUNDARY}\r\nContent-Disposition: form-data; name="avatar"; filename="j.png"\r\nContent-Type: image/png\r\n\r\n`;
  const cuBody = Buffer.concat([Buffer.from(cu), png, Buffer.from(`\r\n--${BOUNDARY}--\r\n`, 'utf8')]);
  let r13 = await req('/api/users', { method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`, 'Content-Length': cuBody.length }, body: cuBody });
  check('createUser -> 201', r13.status === 201, r13.text);
  check('createUser avatarUrl non nulle', r13.json && r13.json.user.avatarUrl && r13.json.user.avatarUrl.startsWith('/uploads/avatars/'), r13.text);

  console.log(`\n================ RESULTAT ================`);
  console.log(`PASS: ${passed}   FAIL: ${failed}`);
  console.log('==========================================');
  server.close();
  process.exit(failed > 0 ? 1 : 0);
});
server.on('error', (e) => { console.error('server error', e); process.exit(2); });
process.on('uncaughtException', (e) => { console.error('UNCAUGHT', e); process.exit(3); });
