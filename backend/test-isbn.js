/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/* Test du pré-remplissage ISBN sur de vrais ISBN de BD. */
const { searchByIsbn } = require('./src/utils/isbnClient');

// Vrais ISBN de BD (vérifiés sur Open Library) :
const SAMPLES = [
  // Astérix le Gaulois (Goscinny / Uderzo) — 2 auteurs
  '9788422677321',
  // Le Chat du Rabbin, tome 1 (Joann Sfar, Dargaud)
  '9782205052077',
  // Persepolis (Marjane Satrapi) — 1 seul auteur
  '9781417652655',
  // Lanfeust de Troy, tome 2 (Largadanne) — tome dans le titre
  '9782012008656',
];

(async () => {
  for (const isbn of SAMPLES) {
    process.stdout.write(`\n=== ISBN ${isbn} ===\n`);
    try {
      const r = await searchByIsbn(isbn);
      if (!r) {
        console.log('  -> INTROUVABLE');
        continue;
      }
      const show = (label, v) =>
        console.log(`  ${label.padEnd(14)}: ${JSON.stringify(v ?? '')} ${v && String(v).length > 100 ? '… (tronqué)' : ''}`);
      show('source', r.source);
      show('title', r.title);
      show('series', r.series);
      show('tome_number', r.tome_number);
      show('authors', r.authors);
      show('illustrators', r.illustrators);
      show('publisher', r.publisher);
      show('release_date', r.release_date);
      show('genre', r.genre);
      show('synopsis', r.synopsis ? r.synopsis.slice(0, 100) : r.synopsis);
      show('cover_image', r.cover_image ? String(r.cover_image).slice(0, 70) : r.cover_image);
    } catch (err) {
      console.log(`  -> ERREUR : ${err.message}`);
    }
  }
  process.exit(0);
})();
