/*
 * Copyright (C) 2026 Irwin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
const { query, pool } = require('../config/db');
const { toVinylDto } = require('./vinylController');
const { toComicDto } = require('./comicController');
const { normalizeArtistName } = require('../utils/musicBrainzClient');
const { normalizeSeriesName } = require('../utils/seriesService');

// ------------------------------------------------------------
// EXPORT / IMPORT de la collection de l'utilisateur connecté :
//   - JSON : sauvegarde COMPLÈTE ET RELATIONNELLE (disques + BD + entités
//     Artistes/Séries + métadonnées) — restauration fidèle ou migration vers
//     une autre instance. L'import re-rattache les entités par NOM NORMALISÉ
//     (jamais par id : les ids d'entités ne sont portables qu'entre bases qui
//     se sont synchronisées — le nom normalisé est la clé stable).
//   - CSV  : un fichier par bibliothèque (vinyls / comics), lisible par
//     Excel / Google Sheets / LibreOffice. L'IMPORT CSV reçoit des lignes
//     DÉJÀ MAPPÉES côté frontend (l'UI de correspondance des colonnes y est
//     faite) : le backend ne fait que valider + insérer.
// Les deux imports sont TRANSACTIONNELS (BEGIN/COMMIT, rollback complet en
// cas d'échec) et bornés à la collection de l'utilisateur courant.
// ------------------------------------------------------------

/** Date « YYYY-MM-DD » depuis une valeur DATE (objet JS Date de node-postgres)
 *  ou une chaîne ISO / « AAAA-MM-JJ » — null si absente / invalide. */
function toIsoDate(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`;
}

/** Tolère une date ISO complète, « AAAA-MM-JJ » ou une année seule (légacy,
 *  remontée au 1er janvier) — null si absente / invalide. */
function parseDate(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1000 || year > 9999) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${m[1]}-${m[2] ? pad(Number(m[2])) : '01'}-${m[3] ? pad(Number(m[3])) : '01'}`;
}

/** Entier fini ou fallback (jamais NaN vers Postgres). */
function toInteger(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = parseInt(String(value).trim(), 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Booléen strict depuis JSON / CSV (« true », « 1 », « oui », « yes »…). */
function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|oui|yes)$/i.test(String(value).trim());
}

/** Couleurs de galette (multi-select, colonne TEXT) : liste séparée par des
 *  virgules — jamais vide, défaut « Noir » (même règle que vinylController). */
const DEFAULT_DISC_COLOR = 'Noir';
function normalizeDiscColors(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const out = [];
  for (const part of raw) {
    const s = String(part || '').trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out.length ? out.join(', ') : DEFAULT_DISC_COLOR;
}

/** MBID MusicBrainz valide (32+ hex sans tirets, 36 avec) — sinon null. */
function cleanMbid(value) {
  const raw = String(value || '').trim();
  const clean = raw.replace(/[^0-9a-f-]/gi, '');
  return raw && clean.length >= 32 && clean.length <= 36 ? clean.toUpperCase() : null;
}

/** Champ texte ou null (vide -> null). */
function textOrNull(value) {
  const s = String(value || '').trim();
  return s || null;
}

// ------------------------------------------------------------
// EXPORT JSON — GET /api/export-import/export/json
// ------------------------------------------------------------

/**
 * Sauvegarde complète et relationnelle de la collection de l'utilisateur
 * courant : disques + BD (DTO complets, mêmes champs que l'API) + entités
 * Artistes / Séries référencées (nom, image, genre) — dédupliquées par nom.
 * Les ids d'entités ne sont PAS exportés : l'import re-rattache par nom
 * normalisé (clé stable entre instances).
 */
async function exportJson(req, res, next) {
  try {
    const userId = req.user.id;
    const { rows: vinylRows } = await query(
      'SELECT * FROM vinyls WHERE user_id = $1 ORDER BY id',
      [userId]
    );
    const { rows: comicRows } = await query(
      'SELECT * FROM comics WHERE user_id = $1 ORDER BY id',
      [userId]
    );

    // Entités ARTISTES référencées par les disques de l'utilisateur (une par
    // nom distinct — lecture seule, non bloquante : base non migrée -> null).
    const artists = {};
    for (const row of vinylRows) {
      const name = String(row.artist || '').trim();
      if (!name || artists[name]) continue;
      let entity = null;
      try {
        const id = await findArtistIdSafe(name);
        if (id != null) {
          const r = await query('SELECT name, image_url, genre FROM artists WHERE id = $1', [id]);
          if (r.rows[0]) entity = r.rows[0];
        }
      } catch { /* table `artists` absente : entité sans métadonnées */ }
      artists[name] = {
        name,
        imageUrl: entity ? entity.image_url || null : null,
        genre: entity ? entity.genre || null : null,
      };
    }

    // Entités SÉRIES référencées par les BD de l'utilisateur (même pattern).
    const series = {};
    for (const row of comicRows) {
      const name = String(row.series || '').trim();
      if (!name || series[name]) continue;
      let entity = null;
      try {
        const found = await findSeriesSafe(name);
        if (found) {
          const r = await query('SELECT name, image_url FROM series WHERE id = $1', [found.seriesId]);
          if (r.rows[0]) entity = r.rows[0];
        }
      } catch { /* table `series` absente : entité sans métadonnées */ }
      series[name] = {
        name,
        imageUrl: entity ? entity.image_url || null : null,
      };
    }

    const payload = {
      app: 'geek0thek',
      version: 1,
      exportedAt: new Date().toISOString(),
      vinyls: vinylRows.map(toVinylDto),
      comics: comicRows.map(toComicDto),
      artists: Object.values(artists),
      series: Object.values(series),
    };
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="geek0thek-export-${stamp()}.json"`
    );
    return res.json(payload);
  } catch (err) {
    return next(err);
  }
}

/** findArtistId sans lever (table `artists` absente sur une base non migrée). */
async function findArtistIdSafe(name) {
  const norm = normalizeArtistName(name);
  if (!norm) return null;
  try {
    const { rows } = await query('SELECT id FROM artists WHERE norm_name = $1', [norm]);
    return rows[0] ? Number(rows[0].id) : null;
  } catch {
    return null;
  }
}

/** findSeries sans lever (table `series` absente sur une base non migrée). */
async function findSeriesSafe(name) {
  const norm = normalizeSeriesName(name);
  if (!norm) return null;
  try {
    const { rows } = await query('SELECT id, name, image_url FROM series WHERE norm_name = $1', [norm]);
    return rows[0] ? { seriesId: Number(rows[0].id), image: rows[0].image_url || null } : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// IMPORT JSON — POST /api/export-import/import/json
//   body : { mode?: 'merge' | 'replace', vinyls: [...], comics: [...] }
//   « replace » : efface d'abord la collection de l'utilisateur (disques + BD)
//   puis insère ; « merge » (défaut) : ajoute sans toucher aux lignes existantes.
// ------------------------------------------------------------

async function importJson(req, res, next) {
  try {
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'Corps de requête invalide (objet JSON attendu).' });
    }
    const mode = payload.mode === 'replace' ? 'replace' : 'merge';
    const vinyls = Array.isArray(payload.vinyls) ? payload.vinyls : [];
    const comics = Array.isArray(payload.comics) ? payload.comics : [];
    if (!vinyls.length && !comics.length) {
      return res.status(400).json({ error: 'Aucune donnée à importer (vinyls / comics vides).' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (mode === 'replace') {
        await client.query('DELETE FROM vinyls WHERE user_id = $1', [req.user.id]);
        await client.query('DELETE FROM comics WHERE user_id = $1', [req.user.id]);
      }
      const vRes = await importVinylRows(client, req.user.id, vinyls);
      const cRes = await importComicRows(client, req.user.id, comics);
      await client.query('COMMIT');
      return res.json({
        imported: { vinyls: vRes.imported, comics: cRes.imported },
        skipped: { vinyls: vRes.skipped, comics: cRes.skipped },
      });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* déjà annulé */ }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return next(err);
  }
}

// ------------------------------------------------------------
// IMPORT CSV — POST /api/export-import/import/csv
//   body : { collection: 'vinyls' | 'comics', mode?: 'merge' | 'replace',
//            rows: [ { champ_canonique: valeur, … }, … ] }
// Les lignes sont DÉJÀ MAPPÉES côté frontend (correspondance des colonnes) :
// chaque objet porte les noms de champs canoniques snake_case de l'export CSV.
// ------------------------------------------------------------

async function importCsv(req, res, next) {
  try {
    const body = req.body || {};
    const collection = String(body.collection || '');
    if (!['vinyls', 'comics'].includes(collection)) {
      return res.status(400).json({ error: "Bibliothèque inconnue (« vinyls » ou « comics » attendus)." });
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) {
      return res.status(400).json({ error: 'Aucune ligne à importer.' });
    }
    const mode = body.mode === 'replace' ? 'replace' : 'merge';

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (mode === 'replace') {
        // `collection` est borné à la liste blanche ci-dessus (jamais d'injection).
        await client.query(`DELETE FROM ${collection} WHERE user_id = $1`, [req.user.id]);
      }
      const result =
        collection === 'vinyls'
          ? await importVinylRows(client, req.user.id, rows)
          : await importComicRows(client, req.user.id, rows);
      await client.query('COMMIT');
      return res.json({ collection, imported: result.imported, skipped: result.skipped });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* déjà annulé */ }
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    return next(err);
  }
}

// ------------------------------------------------------------
// INSERTION des lignes (partagée JSON / CSV) — dans la transaction appelante
// ------------------------------------------------------------

/**
 * Rattache (ou crée, sans image) l'ENTITÉ ARTISTE d'un nom donné, dans la
 * transaction courante : re-rattachement par NOM NORMALISÉ — jamais par id
 * exporté (non portable entre instances). Non bloquant : table `artists`
 * absente -> null (la ligne du disque est insérée sans entité, comme les
 * lignes legacy).
 */
async function resolveArtistId(client, artistName) {
  const name = String(artistName || '').trim();
  const norm = normalizeArtistName(name);
  if (!name || !norm) return null;
  try {
    const found = await client.query('SELECT id FROM artists WHERE norm_name = $1', [norm]);
    if (found.rows[0]) return Number(found.rows[0].id);
    const inserted = await client.query(
      `INSERT INTO artists (name, norm_name) VALUES ($1, $2)
       ON CONFLICT (norm_name) DO NOTHING RETURNING id`,
      [name, norm]
    );
    return inserted.rows[0] ? Number(inserted.rows[0].id) : null;
  } catch {
    return null;
  }
}

/** Même pattern pour l'ENTITÉ SÉRIE (table `series`). */
async function resolveSeriesId(client, seriesName) {
  const name = String(seriesName || '').trim();
  const norm = normalizeSeriesName(name);
  if (!name || !norm) return null;
  try {
    const found = await client.query('SELECT id FROM series WHERE norm_name = $1', [norm]);
    if (found.rows[0]) return Number(found.rows[0].id);
    const inserted = await client.query(
      `INSERT INTO series (name, norm_name) VALUES ($1, $2)
       ON CONFLICT (norm_name) DO NOTHING RETURNING id`,
      [name, norm]
    );
    return inserted.rows[0] ? Number(inserted.rows[0].id) : null;
  } catch {
    return null;
  }
}

/**
 * Normalise un objet importé (DTO camelCase de l'export JSON OU ligne snake_case
 * du CSV mappé) en valeurs prêtes pour l'INSERT vinyls. null si les champs
 * obligatoires (artiste + titre) sont absents — la ligne est alors ignorée.
 */
function buildVinylValues(item) {
  const artist = String(item.artist || '').trim();
  const title = String(item.title || '').trim();
  if (!artist || !title) return null;

  // Jaquette : colonne NOT NULL — valeur vide -> repli local img/no_group.jpg
  // (servi statiquement par le frontend ; jamais de blanc stocké en base).
  const coverUrl = textOrNull(item.cover_url ?? item.coverUrl) || '/img/no_group.jpg';

  return {
    artist,
    title,
    coverUrl,
    trackCount: Math.max(0, toInteger(item.track_count ?? item.trackCount, 0)),
    tracklist: textOrNull(item.tracklist),
    genre: textOrNull(item.genre),
    label: textOrNull(item.label),
    releaseDate: parseDate(item.release_date ?? item.releaseDate),
    barcode: textOrNull(item.barcode),
    mbid: cleanMbid(item.mbid),
    discogsReleaseId: /^\d{1,10}$/.test(String(item.discogs_release_id ?? item.discogsReleaseId ?? '').trim())
      ? parseInt(String(item.discogs_release_id ?? item.discogsReleaseId).trim(), 10)
      : null,
    discogsUrl: /^https:\/\/(www\.)?discogs\.com\/releases\/\d+/i.test(String(item.discogs_url ?? item.discogsUrl ?? '').trim())
      ? String(item.discogs_url ?? item.discogsUrl).trim()
      : null,
    lastfmUrl: /^https:\/\/(www\.)?last\.fm\/music\/.+$/i.test(String(item.lastfm_url ?? item.lastfmUrl ?? '').trim())
      ? String(item.lastfm_url ?? item.lastfmUrl).trim()
      : null,
    artistImage: textOrNull(item.artist_image ?? item.artistImage),
    acquiredDate: parseDate(item.acquired_date ?? item.addedDate ?? item.acquiredDate),
    notes: textOrNull(item.notes),
    discType: /^\s*(vinyle|compact)\s*$/i.test(String(item.disc_type ?? item.discType ?? ''))
      ? (/^vinyle$/i.test(String(item.disc_type ?? item.discType).trim()) ? 'Vinyle' : 'Compact')
      : 'Vinyle',
    isSpecialEdition: asBoolean(item.is_special_edition ?? item.isSpecialEdition, false),
    pictureDisc: asBoolean(item.is_picture_disc ?? item.pictureDisc, false),
    discsCount: Math.min(5, Math.max(1, toInteger(item.discs_count ?? item.discsCount, 1))),
    color: normalizeDiscColors(item.color),
  };
}

/**
 * Normalise un objet importé en valeurs prêtes pour l'INSERT comics. null si
 * les champs obligatoires (titre + auteurs + éditeur) sont absents.
 */
function buildComicValues(item) {
  const title = String(item.title || '').trim();
  const authors = String(item.authors || '').trim();
  const publisher = String(item.publisher || '').trim();
  if (!title || !authors || !publisher) return null;

  return {
    title,
    series: textOrNull(item.series),
    tomeNumber: textOrNull(item.tome_number ?? item.tomeNumber),
    authors,
    illustrators: textOrNull(item.illustrators),
    publisher,
    // comics.release_date est VARCHAR(50) : valeur texte conservée telle quelle.
    releaseDate: textOrNull(item.release_date ?? item.releaseDate),
    genre: textOrNull(item.genre),
    isbn: (() => {
      const s = String(item.isbn || '').replace(/[^0-9Xx]/g, '').trim();
      return s || null;
    })(),
    synopsis: textOrNull(item.synopsis),
    condition: textOrNull(item.condition) || 'Bon état',
    isSpecialEdition: asBoolean(item.is_special_edition ?? item.isSpecialEdition, false),
    isSigned: asBoolean(item.is_signed ?? item.isSigned, false),
    addedDate: parseDate(item.added_date ?? item.addedDate),
    coverUrl: textOrNull(item.cover_url ?? item.coverUrl),
    seriesImage: textOrNull(item.series_image ?? item.seriesImageUrl ?? item.seriesImage),
  };
}

/** Insère les disques (dans la transaction) — renvoie { imported, skipped }. */
async function importVinylRows(client, userId, items) {
  let imported = 0;
  let skipped = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') { skipped++; continue; }
    const values = buildVinylValues(item);
    if (!values) { skipped++; continue; }
    try {
      const artistId = await resolveArtistId(client, values.artist);
      await client.query(
        `INSERT INTO vinyls (user_id, cover_url, artist, title, track_count, tracklist,
                              genre, label, release_date, barcode, mbid, discogs_release_id,
                              discogs_url, lastfm_url, artist_id, artist_image, acquired_date,
                              notes, disc_type, is_special_edition, is_picture_disc, discs_count, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 COALESCE($17, CURRENT_DATE), $18, $19, $20, $21, $22, $23)`,
        [
          userId, values.coverUrl, values.artist, values.title, values.trackCount,
          values.tracklist, values.genre, values.label, values.releaseDate, values.barcode,
          values.mbid, values.discogsReleaseId, values.discogsUrl, values.lastfmUrl,
          artistId, values.artistImage, values.acquiredDate, values.notes, values.discType,
          values.isSpecialEdition, values.pictureDisc, values.discsCount, values.color,
        ]
      );
      imported++;
    } catch {
      // Ligne rejetée (ex. code-barres / doublon UNIQUE, valeur hors contrainte) :
      // on l'ignore et on continue — jamais un échec partiel de la collection.
      skipped++;
    }
  }
  return { imported, skipped };
}

/** Insère les BD (dans la transaction) — renvoie { imported, skipped }. */
async function importComicRows(client, userId, items) {
  let imported = 0;
  let skipped = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') { skipped++; continue; }
    const values = buildComicValues(item);
    if (!values) { skipped++; continue; }
    try {
      const seriesId = values.series ? await resolveSeriesId(client, values.series) : null;
      await client.query(
        `INSERT INTO comics (user_id, cover_url, title, series, tome_number, authors,
                             illustrators, publisher, release_date, genre, isbn, synopsis,
                             series_id, series_image, condition, is_special_edition, is_signed, added_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                 COALESCE($18, CURRENT_DATE))`,
        [
          userId, values.coverUrl, values.title, values.series, values.tomeNumber,
          values.authors, values.illustrators, values.publisher, values.releaseDate,
          values.genre, values.isbn, values.synopsis, seriesId, values.seriesImage,
          values.condition, values.isSpecialEdition, values.isSigned, values.addedDate,
        ]
      );
      imported++;
    } catch {
      // Ligne rejetée (ex. ISBN en doublon UNIQUE) : ignorée, on continue.
      skipped++;
    }
  }
  return { imported, skipped };
}

// ------------------------------------------------------------
// EXPORT CSV — GET /api/export-import/export/csv?collection=vinyls|comics
//   Un fichier par bibliothèque ; en-têtes = noms de champs CANONIQUES
//   snake_case (mêmes clés que l'import CSV mappé : un export réimportable
//   tel quel, auto-associé par le frontend). BOM UTF-8 pour Excel.
// ------------------------------------------------------------

const VINYL_CSV_FIELDS = [
  'artist', 'title', 'track_count', 'tracklist', 'genre', 'label', 'release_date',
  'barcode', 'mbid', 'discogs_release_id', 'discogs_url', 'lastfm_url',
  'cover_url', 'artist_image', 'acquired_date', 'notes',
  'disc_type', 'is_special_edition', 'is_picture_disc', 'disks_count', 'color',
];

const COMIC_CSV_FIELDS = [
  'title', 'series', 'tome_number', 'authors', 'illustrators', 'publisher',
  'release_date', 'genre', 'isbn', 'synopsis', 'condition',
  'is_special_edition', 'is_signed', 'added_date', 'cover_url', 'series_image',
];

/** DTO disque -> ligne CSV (clés canoniques snake_case). */
function vinylToCsvRow(dto) {
  return {
    artist: dto.artist,
    title: dto.title,
    track_count: dto.trackCount,
    tracklist: dto.tracklist,
    genre: dto.genre,
    label: dto.label,
    release_date: toIsoDate(dto.releaseDate),
    barcode: dto.barcode,
    mbid: dto.mbid,
    discogs_release_id: dto.discogsReleaseId,
    discogs_url: dto.discogsUrl,
    lastfm_url: dto.lastfmUrl,
    cover_url: dto.coverUrl,
    artist_image: dto.artistImage,
    acquired_date: toIsoDate(dto.addedDate),
    notes: dto.notes,
    disc_type: dto.discType,
    is_special_edition: dto.isSpecialEdition,
    is_picture_disc: dto.pictureDisc,
    disks_count: dto.discsCount,
    color: dto.color,
  };
}

/** DTO BD -> ligne CSV (clés canoniques snake_case). */
function comicToCsvRow(dto) {
  return {
    title: dto.title,
    series: dto.series,
    tome_number: dto.tomeNumber,
    authors: dto.authors,
    illustrators: dto.illustrators,
    publisher: dto.publisher,
    release_date: toIsoDate(dto.releaseDate) || dto.releaseDate,
    genre: dto.genre,
    isbn: dto.isbn,
    synopsis: dto.synopsis,
    condition: dto.condition,
    is_special_edition: dto.isSpecialEdition,
    is_signed: dto.isSigned,
    added_date: toIsoDate(dto.addedDate),
    cover_url: dto.coverUrl,
    series_image: dto.seriesImageUrl,
  };
}

/** Échappe une valeur CSV (guillemets doublés, champs cités si virgule /
 *  guillemet / retour à la ligne). null/undefined -> chaîne vide. */
function csvEscape(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Sérialise une table (en-têtes + lignes d'objets) en CSV CRLF. */
function toCsv(fields, rows) {
  const lines = [fields.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(fields.map((f) => csvEscape(row[f])).join(','));
  }
  return lines.join('\r\n');
}

/** Horodatage court pour les noms de fichiers (AAAA-MM-JJ). */
function stamp() {
  return new Date().toISOString().slice(0, 10);
}

async function exportCsv(req, res, next) {
  try {
    const collection = String(req.query.collection || '');
    if (!['vinyls', 'comics'].includes(collection)) {
      return res.status(400).json({ error: "Paramètre « collection » manquant (« vinyls » ou « comics »)." });
    }
    const userId = req.user.id;
    let csv;
    if (collection === 'vinyls') {
      const { rows } = await query('SELECT * FROM vinyls WHERE user_id = $1 ORDER BY id', [userId]);
      csv = toCsv(VINYL_CSV_FIELDS, rows.map((r) => vinylToCsvRow(toVinylDto(r))));
    } else {
      const { rows } = await query('SELECT * FROM comics WHERE user_id = $1 ORDER BY id', [userId]);
      csv = toCsv(COMIC_CSV_FIELDS, rows.map((r) => comicToCsvRow(toComicDto(r))));
    }
    // BOM UTF-8 : Excel / LibreOffice détectent alors l'encodage correctement.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="geek0thek-${collection}-${stamp()}.csv"`
    );
    return res.send('\uFEFF' + csv);
  } catch (err) {
    return next(err);
  }
}

module.exports = { exportJson, importJson, exportCsv, importCsv };
