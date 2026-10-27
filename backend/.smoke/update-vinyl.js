// Smoke test : PUT /api/vinyls/:id — vérifie que l'UPDATE bind $1…$19
// sans trou (en particulier id en $19, dont l'absence provoquait
// « column "acquired_date" does not exist ») et que la date d'ajout
// est mappée correctement ($12).
process.env.NODE_ENV = 'development';

const http = require('http');

let capturedUpdate = null;
let capturedUpdateParams = null;

const dbFile = require.resolve('../src/config/db');
require.cache[dbFile] = {
  id: dbFile, filename: dbFile, loaded: true,
  exports: {
    pool: { query: async () => ({ rows: [] }) },
    migrate: async () => {},
    query: async (sql, params) => {
      const p = params || [];
      if (/^SELECT \* FROM vinyls/i.test(sql)) {
        // « ligne existante » : elle doit exister pour passer les 404/403.
        return { rows: [{ id: '5', user_id: 1, cover_url: '/uploads/vinyls/c.jpg', acquired_date: new Date('2026-10-23') }] };
      }
      if (/^UPDATE vinyls/i.test(sql)) {
        capturedUpdate = sql;
        capturedUpdateParams = p;
        // node-postgres sérialise les colonnes DATE en string "AAAA-MM-JJ" :
        // on imite ce comportement (et non un objet Date vivant).
        return { rows: [{ id: '5', user_id: 1, cover_url: '/uploads/vinyls/c.jpg', artist: 'Pink Floyd', title: 'DSOTM', acquired_date: '2026-10-01', created_at: new Date() }] };
      }
      return { rows: [] };
    },
  },
};

const express = require('express');
const { updateVinyl } = require('../src/controllers/vinylController');
const { upload } = require('../src/middlewares/upload');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => { req.user = { id: 1 }; next(); });
app.put('/api/vinyls/:id', upload.array('cover'), updateVinyl);

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? ' :: ' + extra : '')); }
}

const put = (body) => new Promise((resolve, reject) => {
  const r = http.request('http://127.0.0.1:' + server.address().port + '/api/vinyls/5', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (rs) => {
    let b = ''; rs.on('data', (d) => (b += d)); rs.on('end', () => resolve({ status: rs.statusCode, text: b }));
  });
  r.on('error', reject);
  r.write(body); r.end();
});

const server = app.listen(0, async () => {
  // Cas 1 : payload complet avec date d'ajout.
  let res = await put(JSON.stringify({
    artist: 'Pink Floyd', title: 'The Dark Side of the Moon', track_count: 15,
    acquired_date: '2026-10-01', is_special_edition: true, is_picture_disc: false,
    discs_count: 2, color: 'Blanc', coverRemoteUrl: '/uploads/vinyls/c.jpg',
  }));
  check('PUT -> 200', res.status === 200, `status=${res.status} ${res.text}`);
  check('SQL capturé', !!capturedUpdate, 'null');

  if (capturedUpdate) {
    const used = [...capturedUpdate.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    const max = Math.max(...used);
    check('placeholders $1..$19 sans trou', used.length === 19 && new Set(used).size === 19, JSON.stringify(used.sort((a, b) => a - b)));
    check('WHERE id=$19', /WHERE id=\$19/i.test(capturedUpdate), capturedUpdate.slice(-60));
    check('19 paramètres bindés', capturedUpdateParams.length === max, `len=${capturedUpdateParams.length} (attendu ${max})`);
    const setClause = capturedUpdate.match(/SET ([\s\S]*?)WHERE/i)[1];
    // « acquired_date » apparaît ici dans un COALESCE ; les autres colonnes
    // sont « col=$N ». On accepte donc « = $N » ou « = COALESCE($N, ... ».
    const colIndex = (col) => {
      const m = setClause.match(new RegExp(col + '\\s*=\\s*(?:COALESCE\\(\\$(\\d+)|\\$(\\d+))'));
      return m && m[0] ? Number(m[1] ?? m[2]) : null;
    };
    check('$12 = acquired_date', colIndex('acquired_date') === 12, `acquired_date=$${colIndex('acquired_date')}`);
    check('COALESCE($12, acquired_date)', /acquired_date=COALESCE\(\$12,\s*acquired_date\)/.test(setClause));
    check('$19 = id (5)', capturedUpdateParams[18] === 5, JSON.stringify(capturedUpdateParams[18]));
    check('$12 = "2026-10-01"', capturedUpdateParams[11] === '2026-10-01', JSON.stringify(capturedUpdateParams[11]));
  }
  const json = JSON.parse(res.text);
  check('vinyl.addedDate = "2026-10-01"', json.vinyl && String(json.vinyl.addedDate).slice(0, 10) === '2026-10-01', res.text);

  // Cas 2 : date absente du payload -> $12 = null (COALESCE conserve l'existant).
  capturedUpdate = null; capturedUpdateParams = null;
  let r2 = await put(JSON.stringify({ artist: 'A', title: 'B', track_count: 0, coverRemoteUrl: '/uploads/vinyls/c.jpg' }));
  check('PUT sans date -> 200', r2.status === 200, `status=${r2.status} ${r2.text}`);
  check('$12 = null quand la date est absente', capturedUpdateParams && capturedUpdateParams[11] === null, JSON.stringify(capturedUpdateParams && capturedUpdateParams[11]));
  check('$19 = id toujours bindé', capturedUpdateParams && capturedUpdateParams[18] === 5, JSON.stringify(capturedUpdateParams && capturedUpdateParams[18]));

  // Cas 3 : date en camelCase (tolérance du contrôleur).
  capturedUpdateParams = null;
  let r3 = await put(JSON.stringify({ artist: 'A', title: 'B', acquiredDate: '2020-05-05', coverRemoteUrl: '/uploads/vinyls/c.jpg' }));
  check('PUT camelCase -> 200', r3.status === 200, `status=${r3.status}`);
  check('$12 = "2020-05-05" (camelCase toléré)', capturedUpdateParams && capturedUpdateParams[11] === '2020-05-05', JSON.stringify(capturedUpdateParams && capturedUpdateParams[11]));

  console.log(`\nPASS: ${passed}   FAIL: ${failed}`);
  server.close();
  process.exit(failed ? 1 : 0);
});
server.on('error', (e) => { console.error(e); process.exit(2); });
