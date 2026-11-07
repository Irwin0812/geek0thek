/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/* Test de la recherche TEXTUELLE combinée Google Books + Open Library.
   Parcours réel : contrôleur searchBooks (fake req/res) -> searchByQuery
   (isbnClient, cascade/fusion OL/GB) — mêmes exigences que GET /api/isbn/search. */
const { searchBooks } = require('./src/controllers/isbnController');

const invoke = (ctrl, req) => {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return Promise.resolve(ctrl(req, res, () => {})).then(() => ({ status: res.statusCode, body: res.body }));
};

const show = (l, v) => console.log(`   ${l.padEnd(14)}: ${JSON.stringify(v ?? '')}`);
const summary = (label, r) => {
  console.log(`\n=== ${label} -> HTTP ${r.status}`);
  const data = Array.isArray(r.body?.data) ? r.body.data : [];
  console.log(`   ${data.length} fiche(s)`);
  if (!Array.isArray(r.body?.data)) console.log('   INATTENDU :', JSON.stringify(r.body).slice(0, 250));
  data.slice(0, 8).forEach((it, i) => {
    const cover = it.cover_image ? 'oui' : 'NON';
    console.log(`   ${i + 1}. [${it.source}] « ${it.title} » — ${[it.series, it.tome_number && `t.${it.tome_number}`, it.authors].filter(Boolean).join(' · ')}`);
    show('      cover', `${cover}${it.cover_image ? ' ' + String(it.cover_image).slice(0, 70) : ''}`);
    if (it.isbn || it.publisher || it.release_date) show('      meta', `${[it.isbn && `ISBN ${it.isbn}`, it.publisher, it.release_date].filter(Boolean).join(' · ')} | genre=${it.genre}`);
  });
};

(async () => {
  // 1) Titre BD francophone (fusion attendue si les deux API le connaissent).
  let r = await invoke(searchBooks, { query: { q: "Les Démons d'Alexia", maxResults: '5' } });
  summary('[1] q="Les Démons d\'Alexia"', r);

  // 2) Série BD bien référencée sur Open Library (cascade attendue si GB vide).
  r = await invoke(searchBooks, { query: { q: 'lanfeust de troy tome 1', maxResults: '5' } });
  summary('[2] q="lanfeust de troy tome 1"', r);

  // 3) Requête vide -> 400.
  r = await invoke(searchBooks, { query: { q: '   ' } });
  console.log(`\n=== [3] q="   " (vide) -> HTTP ${r.status} : ${r.body?.error}`);

  // 4) Nonsense -> 200 + data vide.
  r = await invoke(searchBooks, { query: { q: 'zzxqwwqwertyxkcd', maxResults: '3' } });
  console.log(`\n=== [4] q="zzxqwwqwertyxkcd" (nonsense) -> HTTP ${r.status}, data.length=${(r.body?.data || []).length}`);

  const srcs = {};
  for (const it of [...(r?.body?.data || []), ...(await invoke(searchBooks, { query: { q: 'lanfeust de troy tome 1', maxResults: '5' } })).body?.data || []]) {
    srcs[it.source] = (srcs[it.source] || 0) + 1;
  }
  console.log('\nRépartition des sources (tests 2+4) :', JSON.stringify(srcs));
  process.exit(0);
})().catch((e) => { console.error('ERREUR SCRIPT :', e.message); process.exit(1); });
