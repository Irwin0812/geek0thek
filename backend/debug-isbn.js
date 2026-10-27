/* Test ciblé : un seul ISBN via searchByIsbn (pipeline complet). */
const { searchByIsbn } = require('./src/utils/isbnClient');

(async () => {
  const isbn = process.argv[2];
  const show = (label, v) =>
    console.log(`  ${label.padEnd(14)}: ${JSON.stringify(v ?? '')} ${v && String(v).length > 90 ? '… (tronqué)' : ''}`);
  try {
    const r = await searchByIsbn(isbn);
    if (!r) return console.log('  -> INTROUVABLE');
    show('source', r.source);
    show('title', r.title);
    show('series', r.series);
    show('tome_number', r.tome_number);
    show('authors', r.authors);
    show('illustrators', r.illustrators);
    show('publisher', r.publisher);
    show('release_date', r.release_date);
    show('genre', r.genre);
    show('synopsis', r.synopsis ? r.synopsis.slice(0, 120) : r.synopsis);
    show('cover_image', r.cover_image ? String(r.cover_image).slice(0, 70) : r.cover_image);
  } catch (err) {
    console.log('  -> ERREUR :', err.message);
  }
  process.exit(0);
})();
