/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/* Test de la recherche TEXTUELLE par mots-clés (modale « Remplir via ISBN »,
   onglet « Recherche par mots-clés »).
   Parcours réel : contrôleur searchBooks (fake req/res) -> searchByQuery
   (isbnClient) -> googleBooks.searchVolumesMany — mêmes exigences que la
   route GET /api/isbn/search?q=… du frontend. */
const { searchBooks } = require('./src/controllers/isbnController');
const { searchByIsbn } = require('./src/utils/isbnClient');

/** Exécute un contrôleur async avec un fake res et renvoie { status, body }. */
function invoke(controller, req) {
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  return Promise.resolve(controller(req, res, (e) => res.status(500).json({ error: e.message }))).then(() => ({ status: res.statusCode, body: res.body }));
}

const show = (label, v) => console.log(`   ${label.padEnd(14)}: ${JSON.stringify(v ?? '')} ${v && String(v).length > 90 ? '… (tronqué)' : ''}`);

(async () => {
  // 1) Requête d'exemple du ticket (accents + tiret) : la BD ciblée.
  let r = await invoke(searchBooks, { query: { q: "Les Démons d'Alexia — Le sang de l'ange", maxResults: '5' } });
  console.log(`\n=== [1] q="Les Démons d'Alexia — Le sang de l'ange" -> HTTP ${r.status} ===`);
  if (Array.isArray(r.body?.data)) {
    r.body.data.slice(0, 3).forEach((it, i) => {
      console.log(`  --- résultat ${i + 1}/${r.body.data.length} ---`);
      show('title', it.title);
      show('series', it.series);
      show('tome_number', it.tome_number);
      show('authors', it.authors);
      show('publisher', it.publisher);
      show('release_date', it.release_date);
      show('genre', it.genre);
      show('isbn', it.isbn);
      show('cover_image', it.cover_image);
      show('condition', it.condition);
      show('synopsis', it.synopsis ? it.synopsis.slice(0, 80) : '');
    });
  } else console.log('  -> INATTENDU :', JSON.stringify(r.body).slice(0, 200));

  // 2) Requête multi-homonymes (la grille doit en lister plusieurs).
  r = await invoke(searchBooks, { query: { q: 'Astérix le Gaulois', maxResults: '6' } });
  console.log(`\n=== [2] q="Astérix le Gaulois" -> HTTP ${r.status} (${r.body?.data?.length ?? '?'} fiche(s)) ===`);
  (r.body?.data || []).slice(0, 4).forEach((it, i) => console.log(`   ${i + 1}. [${it.source}] « ${it.title} » — ${it.authors}${it.isbn ? ` — ISBN ${it.isbn}` : ''}`));

  // 3) Requete vide -> 400.
  r = await invoke(searchBooks, { query: { q: '   ' } });
  console.log(`\n=== [3] q="   " (vide) -> HTTP ${r.status} : ${r.body?.error}`);

  // 4) Nonsense -> 200 + data vide (réultat valide).
  r = await invoke(searchBooks, { query: { q: 'zzxqwwqwertyxkcd' } });
  console.log(`\n=== [4] q="zzxqwwqwertyxkcd" (nonsense) -> HTTP ${r.status}, data.length=${(r.body?.data || []).length}`);

  // 5) REGRESSION : parcours ISBN refactorisé (fetchFromGoogleBooks via toComicPrefillFromGoogle).
  console.log('\n=== [5] REGRESSION searchByIsbn("9782012008656") ===');
  try {
    const rec = await searchByIsbn('9782012008656');
    if (!rec) console.log('   -> INTROUVABLE (anomalie ? vérifier les logs [googleBooks]/[ISBN])');
    else {
      show('source', rec.source);
      show('title', rec.title);
      show('isbn', rec.isbn);
      show('series', rec.series);
      show('tome_number', rec.tome_number);
      show('authors', rec.authors);
      show('illustrators', rec.illustrators);
      show('release_date', rec.release_date);
    }
  } catch (err) {
    console.log(`   -> ERREUR : ${err.message}`);
  }

  process.exit(0);
})();
