/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
const env = require('../config/env');
const { query } = require('../config/db');
const { downloadCoverImageToDir } = require('./musicBrainzClient');
const googleBooks = require('./googleBooksClient');
// Service GÉNÉRIQUE de nettoyage des fichiers d'image uploadés (orphan check
// + suppression physique) — partagé par toutes les entités.
const { deleteOrphanedUpload } = require('./imageCleanupService');

// ------------------------------------------------------------
// ENTITÉ SÉRIE (table `series`, dédupliquée par nom normalisé)
//   « Ajouter / modifier une BD » déclenche la création ou le rattachement
//   de l'entité Série correspondante ; l'image / logo de série est porté par
//   la colonne comics.series_image (copie par BD — toutes les BD d'une même
//   série affichent LA MÊME image dans la grille « Mes BD ») et conservé ici,
//   sur l'entité elle-même, pour référence / réutilisation. Même pattern que
//   l'ENTITÉ ARTISTE (artistService.js) :
//     1. image MANUELLE (upload `seriesImage` ou URL distante) : priorité ;
//     2. série DÉJÀ RÉFÉRENCÉE : réutilisation de l'image existante ;
//     3. sinon : AUCUNE recherche automatique forcée — la colonne reste VIDE
//        (null) et l'affichage retombe sur l'emblème par défaut
//        img/no_title.jpg (la création de la BD n'est JAMAIS bloquée).
// autoFetchSeriesImage (cascade Open Library / Google Books) reste exposée
// pour un usage explicite, mais le contrôleur ne l'appelle plus à la création.
// La clé `norm_name` est calculée avec normalizeSeriesName() : IDENTIQUE au
// backfill SQL de la migration « series.table » (config/db.js / 009).
// ------------------------------------------------------------

/**
 * Chemin local de repli : image par défaut des séries sans image.
 * Chemin physique de référence : C:\Users\irwin\geek0thek\img\no_title.jpg
 * (servi comme statique par le frontend, cf. frontend/public/img) — même
 * pattern que l'image d'artiste img/no_group.jpg.
 */
const SERIES_NO_TITLE_URL = '/img/no_title.jpg';

/** Sous-dossier du volume de uploads où sont déposées les images de série. */
const SERIES_UPLOAD_SUBDIR = 'series';

// ------------------------------------------------------------
// Recherche automatique d'une image / logo de série (Open Library /
// Google Books) — aucune clé requise, User-Agent identifié exigé.
// ------------------------------------------------------------

// ------------------------------------------------------------
// Image de SÉRIE — recherche d'un VISUEL GLOBAL de la série (distinct des
// couvertures de tomes individuels).
//
// ⚠ INTENTIONNEL : les requêtes Google Books / Open Library sont lancées sur
// le NOM DE SÉRIE UNIQUEMENT (jamais sur « série + titre du tome ») : ces
// APIs cataloguent des ALBUMS — un résultat issu d'une recherche portée
// par le titre d'un album serait couvert de SA JAQUETTE, qui dupliquerait
// alors la couverture d'un tome dans la colonne series_image et brouillerait
// l'affichage de la tuile « page Séries ». Seul un visuel réellement global
// à la série (logo de série d'Open Library quand il existe, 1re position
// Google Books du nom de série sinon) est retenu ; à défaut, repli propre
// sur img/no_title.jpg (C:\Users\irwin\geek0thek\img\no_title.jpg).
// ------------------------------------------------------------

/**
 * Renvoie l'URL de la couverture du 1er résultat exploitable de Google Books
 * pour une requête texte (ici : le NOM DE SÉRIE seul — voir le bandeau au-
 * dessus : ajouter le titre d'un tome ferait revenir la JAQUETTE DE CE TOME,
 * à proscrire pour un visuel global).
 * Déléguée à `googleBooksClient.fetchBookByQuery` : clé GOOGLE_BOOKS_API_KEY
 * utilisée si définie dans .env (sinon requête publique), HTTPS forcé, et les
 * erreurs HTTP sont CONSIGNÉES sans jamais remonter (non bloquant) — la chaîne
 * de secours (Open Library puis repli img/no_title.jpg) prend le relais.
 * @returns {Promise<string|null>} URL https, ou null si aucun résultat
 *   utilisable (HTTP non ok compris — non bloquant).
 */
async function fetchSeriesCoverFromGoogleBooks(searchQuery) {
  let parsed;
  try {
    parsed = await googleBooks.fetchBookByQuery(searchQuery);
  } catch (err) {
    // Sécurité défensive : le client ne lève normalement plus d'erreurs
    // (elles sont absorbées et consignées), mais on protège la chaîne de repli.
    console.warn('[serie] Google Books injoignable :', err.message);
    return null;
  }
  if (!parsed || !parsed.coverUrl) return null;
  const cover = String(parsed.coverUrl).trim();
  if (!cover || /^https?:\/\//i.test(cover) === false) return null; // chemin local de repli conservé ailleurs
  return cover.startsWith('http://') ? cover.replace('http://', 'https://') : cover;
}

/**
 * Renvoie l'URL de la couverture du 1er document d'Open Library (search.json)
 * pour une requête texte. L'identifiant de couverture `cover_i` pointe vers
 * covers.openlibrary.org (« -L » = grande résolution).
 * @returns {Promise<string|null>} URL https, ou null si aucun résultat.
 */
async function fetchSeriesCoverFromOpenLibrary(searchQuery) {
  const url =
    `https://openlibrary.org/search.json?q=${encodeURIComponent(searchQuery)}&limit=5`;
  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': env.books.userAgent },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.warn('[serie] Open Library injoignable :', err.message);
    return null;
  }
  if (!response.ok) {
    console.warn(`[serie] Open Library : HTTP ${response.status}`);
    return null;
  }
  const data = await response.json();
  const docs = Array.isArray(data.docs) ? data.docs : [];
  const withCover = docs.find((d) => d && Number(d.cover_i));
  if (withCover) {
    return `https://covers.openlibrary.org/b/id/${withCover.cover_i}-L.jpg`;
  }
  return null;
}

/**
 * Visuel GLOBAL d'une série via les METADONNÉES SÉRIE d'Open Library :
 * Open Library indexe les séries (works) et expose un propre « logo de
 * série » (illustration d'un document lié, sans couverture) via
 * /series/{key}.json — c'est le candidate le plus PUR du lot, nettement
 * distinct des couvertures d'albums. Aucun résultat exploitable -> null
 * (l'appelant continue sur la chaîne Google Books puis repli locale).
 * @param {string} seriesName nom de la série tel qu'enregistré sur la BD
 * @returns {Promise<string|null>} URL https, ou null.
 */
async function fetchSeriesLogoFromOpenLibrary(seriesName) {
  const q = String(seriesName || '').trim();
  if (!q) return null;
  const url = `https://openlibrary.org/series/${encodeURIComponent(q)}.json`;
  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': env.books.userAgent },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.warn('[serie] Open Library (séries) injoignable :', err.message);
    return null;
  }
  if (!response.ok) return null; // série inconnue -> on passe à l'étape suivante
  let data = null;
  try {
    data = await response.json();
  } catch {
    return null;
  }
  const docs = Array.isArray(data && data.docs) ? data.docs : [];
  for (const d of docs) {
    // « illustration » sans cover_i = logo / image de série propre à Open
    // Library ; une couverture d'album (cover_i) est écartée au titre même
    // du besoin (visuel GLOBAL, pas couverture de tome).
    const img = d && Number(d.illustration_id);
    if (img) return `https://covers.openlibrary.org/p/id/${img}-L.jpg`;
  }
  return null;
}

/**
 * Recherche automatique du VISUEL GLOBAL d'une SÉRIE, à la création / au
 * rattachement d'une BD (cascade) :
 *   1. métadonnées SÉRIE d'Open Library (/series/<nom>.json) : logo global
 *      quand les métadonnées en portent un — le plus propre, distinct par
 *      construction des couvertures de tomes ;
 *   2. Google Books sur le NOM DE SÉRIE seul (jamais « série + titre du
 *      tome » : ce serait la couverture d'un album qui retomberait ici) ;
 *   3. Open Library general (search.json, nom de série seul) en secours ;
 * la 1re URL trouvée est téléchargée dans <uploads>/series/ et son chemin
 * local renvoyé. EN CAS D'ABSENCE DE RÉSULTAT OU D'ÉCHEC total : repli
 * PROPRE sur l'image locale img/no_title.jpg — l'appelant n'est JAMAIS
 * bloqué (la création de la BD ne doit jamais échouer pour cause d'image).
 * @param {string} seriesName nom de la série tel qu'enregistré sur la BD
 * @returns {Promise<string>} "/uploads/series/<fichier>" ou "/img/no_title.jpg".
 */
async function autoFetchSeriesImage(seriesName) {
  const q = String(seriesName || '').trim();
  if (!q) return SERIES_NO_TITLE_URL;

  try {
    let coverUrl = await fetchSeriesLogoFromOpenLibrary(q);
    if (!coverUrl) coverUrl = await fetchSeriesCoverFromGoogleBooks(q);
    if (!coverUrl) coverUrl = await fetchSeriesCoverFromOpenLibrary(q);
    if (coverUrl) {
      return await downloadCoverImageToDir(coverUrl, SERIES_UPLOAD_SUBDIR);
    }
  } catch (err) {
    // Non bloquant : les APIs peuvent être en panne (sans internet sur la
    // VM cible) sans que la création de la BD doive échouer.
    console.warn(`[serie] Recherche du visuel global impossible (« ${q} ») :`, err.message);
  }
  return SERIES_NO_TITLE_URL;
}

// ------------------------------------------------------------
// Lecture / écriture de l'entité Série (table `series`)
// ------------------------------------------------------------

/**
 * Normalise un nom de série pour la comparaison / déduplication :
 * minuscules, espaces réduits, apostrophes typographiques harmonisées.
 * ⚠ Doit rester aligné avec le `norm_name` SQL de la table series
 * (migration « series.table » — database/migrations/009) : c'est cette
 * clé qui relie les BD à l'entité Série en base.
 */
function normalizeSeriesName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    // ’ et ‘ (U+2018 / U+2019) -> apostrophe droite simple « ' »
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ');
}

/**
 * Renvoie l'entité SÉRIE existante pour un nom donné (lecture seule — ne
 * créée RIEN) : { seriesId, image } ou null si inconnue.
 * @param {string} seriesName nom de la série tel qu'enregistré en base
 * @returns {Promise<{seriesId: number, image: string|null}|null>}
 */
async function findSeries(seriesName) {
  const norm = normalizeSeriesName(seriesName);
  if (!norm) return null;
  const { rows } = await query('SELECT id, name, image_url FROM series WHERE norm_name = $1', [
    norm,
  ]);
  return rows[0] ? { seriesId: Number(rows[0].id), image: rows[0].image_url || null } : null;
}

/**
 * Garantit l'existence d'une ligne de SÉRIE (table `series`) pour un nom
 * donné et y associe éventuellement une nouvelle image (photo / logo).
 *  - ligne absente -> INSERT (nom, norm_name, image_url) ;
 *  - ligne présente + `imageUrl` différente de l'image courante -> UPDATE
 *    image_url (remplacement de la photo / logo sur l'entité) ;
 *  - ligne présente + `imageUrl` null/identique -> aucun écrit.
 * Le nom normalisé est calculé avec normalizeSeriesName() : identique au
 * backfill SQL, donc UNE SEULE entité par série, quel que soit le nombre de
 * BD qui en portent le nom (tomes de différents tomes, users confondus).
 * @param {string} seriesName nom d'affichage tel qu'enregistré sur la BD
 * @param {string|null} imageUrl nouvelle image à associer (« /uploads/series/… »
 *        ou image locale par défaut « /img/no_title.jpg ») — null : ne pas toucher
 * @returns {Promise<{seriesId: number, image: string|null}>} id de l'entité et
 *   son image courante (null si aucune).
 */
async function ensureSeries(seriesName, imageUrl = null) {
  const name = String(seriesName || '').trim();
  const norm = normalizeSeriesName(name);
  if (!name || !norm) return { seriesId: null, image: null };

  const { rows } = await query('SELECT id, name, image_url FROM series WHERE norm_name = $1', [
    norm,
  ]);
  let row = rows[0];

  if (!row) {
    const inserted = await query(
      `INSERT INTO series (name, norm_name, image_url)
       VALUES ($1, $2, $3) RETURNING id, name, image_url`,
      [name, norm, imageUrl || null]
    );
    row = inserted.rows[0];
  } else if (imageUrl && imageUrl !== row.image_url) {
    // Remplacement de la photo / logo de série sur l'ENTITÉ (un seul UPDATE :
    // les BD de cette série portent chacune leur copie dans series_image).
    const updated = await query(
      `UPDATE series SET image_url = $1, updated_at = now()
       WHERE id = $2 RETURNING id, name, image_url`,
      [imageUrl, row.id]
    );
    row = updated.rows[0];
  }

  return { seriesId: Number(row.id), image: row.image_url || null };
}

/**
 * SUPPRESSION EXPLICITE de l'image de SÉRIE (« Retirer le fichier » du
 * formulaire « Modifier la BD ») : la colonne `comics.series_image` de CETTE
 * LIGNE est ÉCRASÉE par NULL (jamais l'ancienne image, jamais la couverture du
 * TOME — dissociation totale) et l'image retirée ne doit plus être retenue ni
 * réexposée nulle part ensuite :
 *  - TOUS les autres tomes de cette série (tous users — lignes rattachées à
 *    l'entité PAR ID + lignes legacy sans entité par nom strict, mêmes cibles
 *    que syncSeriesEntity du contrôleur) perdent leur copie : plus aucune image
 *    n'est réutilisable au prochain enregistrement (autoResolveComicSeriesImage
 *    / findSeries reviennent à l'absence -> repli propre img/no_title.jpg) ;
 *  - l'ENTITÉ Série repart sans image (image_url -> NULL).
 * Les vieux fichiers LOCAUX d'images devenus orphelins sont retirés du volume
 * (orphan check complet). Non bloquant en cas d'échec : le contrôleur purge
 * ensuite explicitement la ligne courante (UPDATE ... WHERE id = $1).
 * @param {string} seriesName nom d'affichage tel qu'enregistré sur la BD
 * @param {number|null} [seriesId] id de l'entité Série (couvre les lignes
 *        rattachées ; en l'absence, la purge se fait par nom strict)
 */
async function removeSeriesImageGlobally(seriesName, seriesId = null) {
  const name = String(seriesName || '').trim();
  if (!name) return;

  try {
    // 1) Vieux fichiers LOCAUX devenus orphelins (avant la purge ci-dessous).
    let oldFiles = [];
    if (seriesId != null) {
      try {
        const res = await query(
          `SELECT DISTINCT series_image AS img FROM comics
           WHERE series_image LIKE '/uploads/series/%' AND
             ((series_id = $1 AND series_image IS NOT NULL) OR (series_id IS NULL AND btrim(series) = $2))`,
          [seriesId, name]
        );
        oldFiles = res.rows;
      } catch {}
    }

    // 2) Purge GLOBALE : tous les tomes de cette série (tous users, lignes
    //    legacy comprises) -> colonne series_image NULL.
    await query(
      `UPDATE comics SET series_image = NULL
       WHERE (series_id = $1 AND series_image IS NOT NULL) OR (series_id IS NULL AND btrim(series) = $2)`,
      [seriesId, name]
    );

    // 3) ENTITÉ Série : plus d'image associée.
    try {
      let targetId = seriesId;
      if (targetId == null) {
        const ent = await findSeries(name);
        targetId = ent ? ent.seriesId : null;
      }
      if (targetId != null) {
        await query('UPDATE series SET image_url = NULL, updated_at = now() WHERE id = $1', [targetId]);
      }
    } catch {}

    // 4) Nettoyage : un ancien fichier local n'est supprimé que si plus AUCUN
    //    tome (tous utilisateurs) ne le référence — délégation au service
    //    GÉNÉRIQUE de nettoyage (orphan check + candidats legacy).
    for (const r of oldFiles) {
      if (!r.img) continue;
      const raw = String(r.img).trim();
      if (!raw.startsWith(`/uploads/${SERIES_UPLOAD_SUBDIR}/`)) continue;
      await deleteOrphanedUpload(raw, 'comics', 'series_image');
    }
  } catch (err) {
    console.warn(`[serie] Purge globale de l'image de série impossible (« ${name} ») :`, err.message);
  }
}

module.exports = {
  SERIES_NO_TITLE_URL,
  SERIES_UPLOAD_SUBDIR,
  normalizeSeriesName,
  findSeries,
  ensureSeries,
  autoFetchSeriesImage,
  removeSeriesImageGlobally,
};
