/*
 * Copyright (C) 2026 Irwin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
// ------------------------------------------------------------
// SERVICE GÉNÉRIQUE DE NETTOYAGE DES FICHIERS D'IMAGE UPLOADÉS
// ------------------------------------------------------------
// Centralise la suppression PHYSIQUE des fichiers stockés dans le volume de
// uploads (env.uploadDir) quand une image est retirée dans l'interface et que
// le changement est enregistré. Couvre TOUS les entités actuelles — jaquette
// d'album (BD / vinyle), image de SÉRIE, photo d'ARTISTE, avatar — et sera
// réutilisé tel quel par les futures collections (Jeux Vidéo, Livres, JDR…) :
// chaque contrôleur / service délègue ici au lieu de dupliquer sa propre
// logique de « rmSync + candidats legacy + orphan check ».
//
// Deux sémantiques, strictement distinctes :
//  - deleteLocalUploadFile : image PROPRIÉTAIRE d'une ligne (jaquette, avatar)
//    — le fichier n'est partagé avec aucune autre ligne : suppression directe.
//  - deleteOrphanedUpload  : image PARTAGÉE entre plusieurs lignes (image de
//    série, photo d'artiste — dédupliquées par nom normalisé, tous users) :
//    le fichier n'est retiré du volume que s'il n'est plus référencé par
//    AUCUNE ligne de la table concernée (orphan check SQL complet).
//
// Toutes les fonctions sont NON BLOQUANTES : un échec (fichier absent, base
// non migrée…) est absorbé et consigné — la suppression d'une image dans
// l'interface ne doit JAMAIS faire échouer l'enregistrement.
const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const { query } = require('../config/db');

/**
 * Indique si une valeur stockée en base pointe vers un fichier LOCAL du
 * volume de uploads (chemin d'accès « /uploads/… »). Les URL distantes
 * (http/https) et les emblèmes statiques (« /img/… ») renvoient false : ils
 * ne vivent pas sur le volume et n'ont rien à supprimer.
 */
function isLocalUploadPath(value) {
  return typeof value === 'string' && value.trim().startsWith('/uploads/');
}

/**
 * Supprime PHYSIQUEMENT un fichier local du volume de uploads décrit par son
 * chemin d'accès stocké en base (« /uploads/<sous-dossier>/<fichier> »).
 * Gère les formats legacy écrits par d'anciennes versions (avant l'introduction
 * des sous-dossiers « comics/ », « vinyls/ », « artists/ », « series/ »,
 * « avatars/ ») en testant plusieurs candidats physiques :
 *   1. <uploadDir>/<rel>                 (chemin exact, cas courant) ;
 *   2. <uploadDir>/<subdir>/<rel>        (legacy : sous-dossier manquant) ;
 *   3. <uploadDir>/<basename>            (legacy : fichier en racine du volume).
 * Ignoré silencieusement si la valeur n'est pas un chemin local, si le fichier
 * est absent, ou en cas d'erreur (non bloquant).
 * @param {string} storedPath chemin d'accès stocké (« /uploads/… »)
 * @param {string} [legacySubdir] sous-dossier legacy à tester en 2e position
 *        (ex. « comics », « vinyls ») — optionnel.
 * @returns {boolean} true si un fichier a été supprimé.
 */
function deleteLocalUploadFile(storedPath, legacySubdir = null) {
  const raw = String(storedPath || '').trim();
  if (!isLocalUploadPath(raw)) return false;
  const rel = raw.slice('/uploads/'.length).split(/[\/\\]/).filter(Boolean).join('/');
  if (!rel) return false;
  const candidates = [path.join(env.uploadDir, rel)];
  if (legacySubdir) candidates.push(path.join(env.uploadDir, legacySubdir, rel));
  candidates.push(path.join(env.uploadDir, path.basename(rel)));
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        fs.rmSync(candidate, { force: true });
        return true;
      }
    } catch {}
  }
  return false;
}

/**
 * Supprime un fichier local d'image PARTAGÉE s'il est devenu ORPHELIN : plus
 * AUCUNE ligne de la table `table` ne référence ce chemin dans la colonne
 * `column`. Les images de série (comics.series_image) et les photos d'artiste
 * (vinyls.artist_image) sont dédupliquées par nom normalisé et partagées entre
 * TOUS les tomes / disques / utilisateurs — on ne retire donc du volume qu'un
 * chemin vraiment orphelin, jamais un fichier encore utilisé ailleurs.
 * Non bloquant : toute erreur (base non migrée, fichier absent…) est absorbée.
 * @param {string} storedPath chemin d'accès stocké (« /uploads/… »)
 * @param {string} table table à interroger pour l'orphan check (« comics », « vinyls »…)
 * @param {string} column colonne portant le chemin (« series_image », « artist_image »…)
 * @returns {Promise<boolean>} true si un fichier a été supprimé.
 */
async function deleteOrphanedUpload(storedPath, table, column) {
  const raw = String(storedPath || '').trim();
  if (!isLocalUploadPath(raw)) return false;
  try {
    // Garde-fou SQL : table / colonne attendues en identifiants simples.
    if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) return false;
    const stillRef = await query(
      `SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`,
      [raw]
    );
    if (stillRef.rows.length > 0) return false; // encore référencé : on conserve
    return deleteLocalUploadFile(raw);
  } catch (err) {
    console.warn(
      `[imageCleanup] Orphan check impossible (${table}.${column} = « ${raw} ») :`,
      err.message
    );
    return false;
  }
}

/**
 * Supprime un fichier d'AVATAR local, avec une garde stricte : seul un chemin
 * DIRECTEMENT dans le sous-dossier « avatars/ » (aucun séparateur dans le nom
 * de fichier) est accepté — jamais de chemin hors du dossier des avatars
 * (protection contre toute traversée de répertoire). Non bloquant.
 * @param {string} avatarUrl chemin d'accès stocké (« /uploads/avatars/<fichier> »)
 * @returns {boolean} true si un fichier a été supprimé.
 */
function deleteAvatarFile(avatarUrl) {
  if (!avatarUrl || typeof avatarUrl !== 'string') return false;
  const raw = avatarUrl.trim();
  if (!raw.startsWith('/uploads/avatars/')) return false;
  const base = raw.slice('/uploads/avatars/'.length);
  if (!base || /[/\\]/.test(base)) return false; // jamais de chemin imbriqué
  try {
    fs.rmSync(path.join(env.uploadDir, 'avatars', base), { force: true });
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  isLocalUploadPath,
  deleteLocalUploadFile,
  deleteOrphanedUpload,
  deleteAvatarFile,
};
