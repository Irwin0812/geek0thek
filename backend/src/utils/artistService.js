/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
const { query } = require('../config/db');
const { normalizeArtistName } = require('./musicBrainzClient');
// Service GÉNÉRIQUE de nettoyage des fichiers d'image uploadés (orphan check
// + suppression physique) — partagé par toutes les entités.
const { deleteOrphanedUpload } = require('./imageCleanupService');

// ------------------------------------------------------------
// ENTITÉ ARTISTE (table `artists`, dédupliquee par nom normalisé)
//   « Ajouter un disque » déclenche la création / le rattachement de
//   l'entité Artiste correspondante ; la photo / logo d'artiste est portée
//   par la colonne vinyls.artist_image (copie par disque — tous les disques
//   d'un artiste affichent LA MÊME image dans la grille « Mes Disques ») et
//   conservée ici, sur l'entité elle-même, pour référence / réutilisation.
// La clé `norm_name` est calculée avec normalizeArtistName() (même algortihme
// que database/migrations/008 + le backfill « artists.table » de db.js).
// ------------------------------------------------------------

/**
 * Renvoie l'id d'une entité Artiste existante pour un nom donné
 * (Lecture seule — ne créée RIEN) : null si inconnue.
 * @param {string} artistName nom d'artiste tel qu'enregistré en base
 * @returns {Promise<number|null>}
 */
async function findArtistId(artistName) {
  const norm = normalizeArtistName(artistName);
  if (!norm) return null;
  const { rows } = await query('SELECT id FROM artists WHERE norm_name = $1', [norm]);
  return rows[0] ? Number(rows[0].id) : null;
}

/**
 * Garantit l'existence d'une ligne d'ARTISTE (table `artists`) pour un nom
 * donné et y associe éventuellement une nouvelle image (photo / logo).
 *  - ligne absente -> INSERT (nom, norm_name, image_url) ;
 *  - ligne présente + `imageUrl` différente de l'image courante -> UPDATE
 *    image_url (remplacement de la photo d'artiste sur l'entité) ;
 *  - ligne présente + `imageUrl` null/identique -> aucun écrit.
 * Le nom normalisé est calculé avec normalizeArtistName() : identique au
 * backfill SQL et au regroupement frontend (collection.js), donc UNE seule
 * entité par artiste, quel que soit le nombre de disques qui en portent le nom.
 * @param {string} artistName nom d'affichage tel qu'enregistré sur le disque
 * @param {string|null} imageUrl nouvelle image à associer (« /uploads/artists/… »)
 *        — null : ne pas toucher
 * @returns {Promise<{artistId: number, image: string|null}>} id de l'entité et
 *   son image courante (null si aucune).
 */
async function ensureArtist(artistName, imageUrl = null) {
  const name = String(artistName || '').trim();
  const norm = normalizeArtistName(name);
  if (!name || !norm) return { artistId: null, image: null };

  const { rows } = await query(
    'SELECT id, name, image_url FROM artists WHERE norm_name = $1',
    [norm]
  );
  let row = rows[0];

  if (!row) {
    const inserted = await query(
      `INSERT INTO artists (name, norm_name, image_url)
       VALUES ($1, $2, $3) RETURNING id, name, image_url`,
      [name, norm, imageUrl || null]
    );
    row = inserted.rows[0];
  } else if (imageUrl && imageUrl !== row.image_url) {
    // Remplacement de la photo / logo d'artiste sur l'ENTITÉ (un seul UPDATE :
    // les disques de cet artiste portent chacun leur copie dans artist_image).
    const updated = await query(
      `UPDATE artists SET image_url = $1, updated_at = now()
       WHERE id = $2 RETURNING id, name, image_url`,
      [imageUrl, row.id]
    );
    row = updated.rows[0];
  }

  return { artistId: Number(row.id), image: row.image_url || null };
}

/**
 * SUPPRESSION EXPLICITE de l'image d'ARTISTE (« Retirer le fichier » du
 * formulaire « Modifier le disque ») : la colonne `vinyls.artist_image` de
 * CETTE LIGNE est ÉCRASÉE par NULL (jamais l'ancienne photo, jamais la
 * jaquette d'un album) et l'image retirée ne doit plus être retenue ni
 * réexposée nulle part ensuite — pour que la colonne garde NULL définitivement
 * et ne reparte jamais sur l'ancienne valeur au prochain enregistrement :
 *  - TOUS les autres disques de cet artiste (tous users — lignes rattachées à
 *    l'entité PAR ID + lignes legacy sans entité par nom strict, mêmes cibles
 *    que syncArtistEntity du contrôleur) perdent leur copie : pas de
 *    réattribution ni de réutilisation via existingArtistWithImage ;
 *  - l'ENTITÉ Artiste repart sans photo (image_url -> NULL).
 * Les vieux fichiers LOCAUX d'images devenus orphelins sont retirés du volume
 * (orphan check complet). Non bloquant en cas d'échec : le contrôleur purge
 * ensuite explicitement la ligne courante (UPDATE ... WHERE id = $1).
 * @param {string} artistName nom d'affichage tel qu'enregistré sur le disque
 * @param {number|null} [artistId] id de l'entité Artiste (couvre les lignes
 *        rattachées ; en l'absence, la purge se fait par nom strict)
 */
async function removeArtistImageGlobally(artistName, artistId = null) {
  const name = String(artistName || '').trim();
  if (!name) return;

  try {
    // 1) Vieux fichiers LOCAUX devenus orphelins (avant la purge ci-dessous).
    let oldFiles = [];
    if (artistId != null) {
      try {
        const res = await query(
          `SELECT DISTINCT artist_image AS img FROM vinyls
           WHERE artist_image ~ '^/uploads/' AND
             ((artist_id = $1 AND artist_image IS NOT NULL) OR (artist_id IS NULL AND btrim(artist) = $2))`,
          [artistId, name]
        );
        oldFiles = res.rows;
      } catch {}
    }

    // 2) Purge GLOBALE : tous les disques de cet artiste (tous users, lignes
    //    legacy comprises) -> colonne artist_image NULL.
    await query(
      `UPDATE vinyls SET artist_image = NULL
       WHERE (artist_id = $1 AND artist_image IS NOT NULL) OR (artist_id IS NULL AND btrim(artist) = $2)`,
      [artistId, name]
    );

    // 3) ENTITÉ Artiste : plus de photo associée.
    try {
      let targetId = artistId;
      if (targetId == null) {
        const ent = await findArtistId(name);
        targetId = ent;
      }
      if (targetId != null) {
        await query('UPDATE artists SET image_url = NULL, updated_at = now() WHERE id = $1', [targetId]);
      }
    } catch {}

    // 4) Nettoyage : un ancien fichier local n'est supprimé que si plus AUCUN
    //    disque (tous utilisateurs) ne le référence — délégation au service
    //    GÉNÉRIQUE de nettoyage (orphan check + candidats legacy).
    for (const r of oldFiles) {
      if (!r.img) continue;
      const raw = String(r.img).trim();
      if (!raw.startsWith('/uploads/')) continue;
      await deleteOrphanedUpload(raw, 'vinyls', 'artist_image');
    }
  } catch (err) {
    console.warn(`[artistImage] Purge globale de l'image d'artiste impossible (« ${name} ») :`, err.message);
  }
}

module.exports = { findArtistId, ensureArtist, removeArtistImageGlobally };
