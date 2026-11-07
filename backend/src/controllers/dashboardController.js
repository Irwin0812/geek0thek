/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
const { query } = require('../config/db');
const { toVinylDto } = require('./vinylController');
const { toComicDto } = require('./comicController');

/**
 * AGGREGATION DASHBOARD — « Dernier ajout » GLOBAL (tous médias confondus).
 *
 * ARCHITECTURE ÉVOLUTIVE : chaque type de médias est décrit par une simple
 * ENTRÉE DU REGISTRE MEDIA_SOURCES ci-dessous (table source, alias SQL,
 * colonne DATE D'AJOUT métier et fabrique du DTO normalisé). Les
 * bibliothèques livrées sont `vinyls` (Disques) et `comics` (BD) ; les
 * futures — `books` (Livres), `board_games` (Jeux de Rôle / Plateaux) et
 * `video_games` (Jeux vidéo) — se brancheront en DÉCOMMENTANT une ligne
 * chacune : l'UNION du dernier ajout global et les compteurs les intègrent
 * automatiquement, sans toucher au reste du contrôleur.
 *
 * Garanties d'intégrité :
 *  - une source dont la TABLE N'EXISTE PAS ENCORE est écartée de l'UNION
 *    (contrôle via information_schema.tables — aucune vue dépendante à créer)
 *    : le dashboard ne doit JAMAIS échouer à cause d'une bibliothèque future
 *    non migrée ;
 *  - tri strict sur l'HORODATAGE D'INSERTION `created_at` — posé par le
 *    DEFAULT now() de la table au INSERT, immuable ensuite (le trigger
 *    met à jour updated_at, jamais created_at) : il reflète le TOUT DERNIER
 *    média INSÉRÉ en base de données, indépendamment des dates de parution
 *    (release_date) ET des dates d'ajout métier éditables via formulaire
 *    (acquired_date / added_date — une édition peut ré-écrire ces dernières,
 *    d'où l'ancien blocage de la tuile sur un élément historique) ; les
 *    égalités sont départagées par `id DESC` pour un rendu DÉTERMINISTE ;
 *  - chaque branche de l'UNION est bornée `user_id = $1` (paramètre SQL —
 *    JAMAIS d'interpolation) : le dashboard reflète la collection PERSO du
 *    connectataire, comme les routes /vinyls et /comics ;
 *  - toute panne classifiée 5xx est NON BLOQUANTE : `lastAdd = null` et
 *    compteurs à zéro (tuile « Dernier Ajout » -> état vide propre).
 */
const MEDIA_SOURCES = [
  {
    key: 'vinyls',
    label: 'Disques',
    table: 'vinyls',
    alias: 'v',
    // Date D'AJOUT métier des disques : colonne `acquired_date` (migration
    // 004 / auto « vinyls.added-date ») — jamais l'horodatage technique.
    addedDateColumn: 'acquired_date',
    // Image d'ARTISTE nulle dans le DTO du dashboard : la tuile est un
    // « dernier ajout », pas une vignette de groupe — et ça évite toute
    // contamination legacy `artist_image = cover_url` sur les lignes
    // historiques jamais repassées par syncArtistEntity.
    toDto: (row) => toVinylDto({ ...row, artist_image: null }),
  },
  {
    key: 'comics',
    label: 'BD',
    table: 'comics',
    alias: 'c',
    addedDateColumn: 'added_date',
    toDto: (row) => toComicDto(row),
  },
  // ------------------------------------------------------------
  // FUTURES BIBLIOTHÈQUES : tables à créer par migration (+ flag de partage
  // `users.share_books` / `share_board_games` / `share_video_games` pour la
  // vue publique + module CRUD équivalent à vinyls/comics) — décommenter TEL
  // QUEL dès que la table existe. Convention attendue, identique partout :
  //   user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  //   title      VARCHAR(255) NOT NULL,                   -- champ « Titre »
  //   added_date DATE NOT NULL DEFAULT CURRENT_DATE,      -- DATE D'AJOUT
  //   + le champ « Nom » de la tuile, selon le type :
  //     books       -> author     (Auteur)
  //     board_games -> publisher  (Maison d'édition / éditeur)
  //     video_games -> platform   (Plateforme)
  // Les sources sont écartées automatiquement tant que la table est absente.
  // ------------------------------------------------------------
  // { key: 'books', label: 'Livres', table: 'books', alias: 'b', addedDateColumn: 'added_date', toDto: toBookDto },
  // { key: 'boardGames', label: 'Jeux de Rôle/Plateaux', table: 'board_games', alias: 'g', addedDateColumn: 'added_date', toDto: toBoardGameDto },
  // { key: 'videoGames', label: 'Jeux vidéo', table: 'video_games', alias: 'vg', addedDateColumn: 'added_date', toDto: toVideoGameDto },
];

/** Convertit une valeur DATE métier (Date local de pg, chaîne ISO…) en « YYYY-MM-DD ». */
function dateText(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  const m = s.match(/^\d{4}-\d{1,2}-\d{1,2}/);
  if (m) {
    const p = m[0].split('-');
    return `${p[0]}-${p[1].padStart(2, '0')}-${p[2].padStart(2, '0')}`;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : dateText(d);
}

/**
 * Existence effective d'une table du schéma courant (catalog
 * `information_schema.tables`). Tolérant aux pannes : en cas d'ERREUR, la
 * source est CONSERVÉE (statu quo — les bibliothèques actuelles existent).
 */
async function tableExists(tableName) {
  try {
    const { rows } = await query(
      'SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1',
      [tableName]
    );
    return rows.length > 0;
  } catch (err) {
    console.warn("[dashboard] contrôle d'existence impossible — source conservée :", err.message);
    return true;
  }
}

/**
 * UNION ALL des bibliothèques PRÉSENTES EN BASE : une LIGNE PAR ÉLÉMENT de la
 * collection de l'utilisateur avec `media_type` (clé du registre), `id`,
 * `title` et l'HORODATAGE D'INSERTION `${alias}.created_at` castée ::TEXT en
 * ISO UTC (comparaison lexicographique = comparaison temporelle). Le tri
 * « dernier inséré » repose donc STRICTEMENT sur la base (`created_at`,
 * départage `id DESC`) : jamais sur la date de parution (`release_date`) ni
 * sur la date d'ajout métier éditée via formulaire (`acquired_date` /
 * `added_date`). Le même paramètre `user_id = $1` borne TOUS les types de
 * médias : le `$1` des N sous-requêtes d'une UNION est unique et partage
 * l'id utilisateur passé une seule fois dans `query(sql, [userId])`.
 */
function buildUnionSql(sources) {
  return sources
    .map(
      (s) => `SELECT '${s.key}' AS media_type,
         ${s.alias}.id,
         ${s.alias}.title,
         (${s.alias}.created_at)::TEXT AS created_at
       FROM ${s.table} ${s.alias}
       WHERE ${s.alias}.user_id = $1`
    )
    .join('\nUNION ALL\n');
}

/** Compteurs initialisés à zéro pour TOUTES les clés du registre. */
function emptyCounts() {
  return Object.fromEntries(MEDIA_SOURCES.map((s) => [s.key, 0]));
}

/**
 * GET /api/dashboard — agrégat du tableau de bord.
 *
 * Réponse : `{ counts: { vinyls, comics }, lastAdd }` où `lastAdd` est le
 * TOUT DERNIER élément ajouté (TOUS TYPES DE MÉDIAS CONFOONDUS) avec ses
 * métadonnées normalisées :
 * ```
 * lastAdd = {
 *   id,          // id dans sa table d'origine
 *   mediaType,   // clé du registre : 'vinyls' | 'comics' | … (futures clés
 *                //                  books / boardGames / videoGames)
 *   title,       // titre de l'album / du livre / du jeu
 *   addedDate,   // DATE D'AJOUT métier YYYY-MM-DD (acquired_date / added_date)
 *   item         // DTO NORMALISÉ (toVinylDto / toComicDto / …) : coverUrl,
 *                // artist (Groupe/Artiste), series, authors, …
 * }
 * ```
 * Le champ « NOM » de la tuile s'en déduit côté frontend : `item.artist`
 * (disque), série/auteurs (BD) — et correspondra à `author`, `publisher` ou
 * `platform` pour les bibliothèques futures (cf. conventions du registre).
 */
async function getDashboard(req, res, next) {
  try {
    const userId = req.user.id;

    // N°1 : registres réellement existants en base — une bibliothèque future
    // non migrée ne doit JAMAIS faire échouer le dashboard.
    const present = await Promise.all(MEDIA_SOURCES.map((s) => tableExists(s.table)));
    const sources = MEDIA_SOURCES.filter((_, i) => present[i]);
    if (sources.length === 0) return res.json({ counts: emptyCounts(), lastAdd: null });

    const unionSql = buildUnionSql(sources);
    const params = [userId]; // $1 partagé par TOUTES les branches de l'union

    // N°2 : le TOUT DERNIER MÉDIA INSÉRÉ en base, TOUTES bibliothèques
    // confondues — tri DESC strict sur l'horodatage d'insertion created_at
    // (immuable, posé par DEFAULT now() au INSERT — jamais lisible dans les
    // formulaires), départage id DESC (séquence BIGSERIAL par table : le plus
    // grand id = le plus récent à timestamp égal) puis LIMIT 1. Jamais la
    // date de parution (release_date) ni la date d'ajout métier éditée
    // (acquired_date / added_date — celles-ci pouvaient faire bloquer la
    // tuile sur un élément historique ré-édité).
    const { rows: topRows } = await query(
      `SELECT * FROM (${unionSql}) _u
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      params
    );

    // N°3 : compteurs par bibliothèque — mêmes tables que l'UNION, donc la
    // création des futures bibliothèques les intègrera automatiquement.
    const { rows: countRows } = await query(
      `SELECT media_type, COUNT(*)::INT AS n FROM (${unionSql}) _u GROUP BY media_type`,
      params
    );
    const counts = emptyCounts();
    for (const row of countRows) {
      if (row.media_type in counts) counts[row.media_type] = Number(row.n) || 0;
    }

    // N°4 : le dernier ajout et son DTO normalisé.
    let lastAdd = null;
    const top = topRows[0];
    if (top && MEDIA_SOURCES.some((s) => s.key === top.media_type)) {
      const source = MEDIA_SOURCES.find((s) => s.key === top.media_type);
      // Ligne complète de l'ÉLÉMENT GAGNANT (toutes colonnes du type) : le DTO
      // est fabriqué avec les champs d'ORIGINE par la fabrique du registre.
      const { rows: full } = await query(`SELECT * FROM ${source.table} WHERE id = $1`, [Number(top.id)]);
      if (full[0]) {
        lastAdd = {
          id: Number(full[0].id),
          mediaType: source.key,
          title: String(full[0].title || '').trim(),
          addedDate: dateText(full[0][source.addedDateColumn]),
          item: source.toDto(full[0]),
        };
      }
    }

    return res.json({ counts, lastAdd });
  } catch (err) {
    // NON BLOQUANT : le dashboard reste affiché (état vide « Dernier ajout »),
    // l'erreur est journalisée ; on ne remonte PAS au gestionnaire central car
    // une tuile désactivée suffit — la liste « Derniers ajouts » utilise les
    // routes /vinyls et /comics déjà propres.
    console.warn('[dashboard] agrégat impossible — état vide renvoyé :', err.message);
    return res.json({ counts: emptyCounts(), lastAdd: null });
  }
}

module.exports = { getDashboard, MEDIA_SOURCES };
