/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/* Tests UNITAIRES de la stratégie de fusion Google Books + Open Library
   (helpers exposés par isbnClient.js). Aucun appel réseau : fixtures fixes. */
const { mergeQueryResults, dedupeKeyComicPrefill } = require('./src/utils/isbnClient');

let pass = 0;
let fail = 0;
function assert(label, cond) {
  if (cond) { pass += 1; console.log(`  ✔ ${label}`); }
  else { fail += 1; console.log(`  ✘ ÉCHEC : ${label}`); }
}

const gb = (over = {}) => ({
  isbn: '', title: 'Lanfeust de Troy — L\'Ivoire du Magohamoth', series: 'Lanfeust de Troy',
  tome_number: '1', authors: 'Didier Tarquin', illustrators: '', publisher: 'Hachette',
  release_date: '2002-06-19', genre: 'Bande dessinée', synopsis: '', cover_image: null,
  source: 'google_books', ...over,
});
const ol = (over = {}) => ({
  isbn: '9782302015906', title: 'Lanfeust de Troy, tome 1 — L\'Ivoire du Magohamoth', series: 'Lanfeust de TROY',
  tome_number: '1', authors: 'Didier Tarquin, Christophe Arleston', illustrators: 'Christophe Arleston',
  publisher: 'Hachette', release_date: '2001-01-01', genre: 'Bandes dessinées', synopsis: 'Résumé OL.',
  cover_image: 'https://covers.openlibrary.org/b/id/10693337-L.jpg', source: 'open_library', ...over,
});

console.log('--- dédoublonnage : clé de titre ---');
assert('accents/casse indifférents', dedupeKeyComicPrefill({ title: 'Lanfeust de Troy, tome 1' }) === dedupeKeyComicPrefill({ title: 'LANFEUST DE TROY, Tome  1' }));
assert('sous-titres distincts != mêmes clés', dedupeKeyComicPrefill({ title: 'Lanfeust — L\'Ivoire' }) !== dedupeKeyComicPrefill({ title: 'Lanfeust — Le Golem' }));

console.log('--- fusion 1 : GB sans ISBN + OL homonyme avec ISBN ---');
let r = mergeQueryResults([gb()], [ol()], 10);
assert('une seule fiche', r.length === 1);
assert('source = fusion', r[0].source === 'google_books+open_library');
assert('ISBN Open Library propagé', r[0].isbn === '9782302015906');
assert('synopsis OL complété', r[0].synopsis === 'Résumé OL.');
assert('couverture OL ajoutée', String(r[0].cover_image).startsWith('https://covers.openlibrary.org'));
assert('genre GB (défaut) remplacé par OL (« Bandes dessinées »)', r[0].genre === 'Bandes dessinées');
assert('title/publisher/date GOOGLE conservés', r[0].title.startsWith('Lanfeust de Troy —') && r[0].publisher === 'Hachette' && r[0].release_date === '2002-06-19');

console.log('--- fusion 2 : doublons stricts (mêmes titres, mêmes ISBN) ---');
r = mergeQueryResults([gb({ isbn: '9782302015906' })], [ol()], 10);
assert('pas de doublon', r.length === 1);
assert('fiche Google conservée (ordre + champs)', r[0].release_date === '2002-06-19');

console.log('--- fusion 3 : fiches OL uniques ajoutées après GB (ordre stable) ---');
r = mergeQueryResults([gb()], [ol({ isbn: '', title: "Astérix — Le Bouclier arverne", authors: 'René Goscinny, Albert Uderzo' })], 10);
assert('deux fiches', r.length === 2);
assert('GB d\'abord, OL ensuite', r[0].source === 'google_books+open_library' && r[1].source === 'open_library');
assert('fiche OL unique conservée telle quelle (ISBN vide non propagé = pas de conflit)', r[1].title.startsWith('Astérix'));

console.log('--- fusion 4 : plafonnement `limit` ---');
const manyOl = Array.from({ length: 8 }, (_, i) => ol({ isbn: '', title: `Tome ${i}`, series: '', source: 'open_library' }));
r = mergeQueryResults([gb()], manyOl, 3);
assert('plafonné à 3', r.length === 3);
assert('la fiche Google (prioritaire) est bien dans le quota', r.some((x) => String(x.title).includes('Lanfeust')));

console.log('--- fusion 5 : liste Google vide = cascade OL seule ---');
r = mergeQueryResults([], [ol()], 10);
assert('seule fiche OL', r.length === 1 && r[0].source === 'open_library');

console.log('--- fusion 6 : aucune fiche -> [] ---');
r = mergeQueryResults([], [], 10);
assert('liste vide', Array.isArray(r) && r.length === 0);
r = mergeQueryResults([gb({ title: '' })], [ol({ title: '' })], 10);
assert('fiches sans titre écartées', r.length === 0);

console.log(`\n${pass} réussi(s), ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
