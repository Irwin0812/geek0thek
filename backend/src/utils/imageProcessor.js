/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/**
 * imageProcessor.js — Conversion WebP des jaquettes / images + cache in-memory TTL
 * ================================================================
 * Centralise :
 *   1. La conversion des images (jaquettes, couvertures BD, photos d'artistes,
 *      logos de séries, avatars) en WebP via `sharp` :
 *        - qualité 82 % (compromis taille / fidélité) ;
 *        - redimensionnement max 1000×1000 px (seulement si l'image est plus
 *          grande — jamais d'upscaling) ;
 *        - fermeture propre du flux sharp (pas de fuite mémoire).
 *   2. Un cache in-memory à TTL (Time-To-Live) pour limiter les appels API
 *      répétés vers MusicBrainz, Discogs, Last.fm, Google Books et Open Library.
 *
 * Le cache est volontairement SIMPLE (Map + horodatage) : pas de LRU complexe,
 * pas de persistance — un redémarrage du conteneur le vide naturellement.
 * La taille maximale est bornée pour éviter une croissance illimitée en RAM.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

// ------------------------------------------------------------
// Conversion WebP
// ------------------------------------------------------------

/** Qualité WebP cible (80-85 % demandé ; 82 au milieu). */
const WEBP_QUALITY = 82;

/** Taille maximale (côté le plus long) en pixels. */
const MAX_DIMENSION = 1000;

/**
 * Convertit un Buffer d'image en WebP (qualité 82, max 1000×1000 px).
 * Si l'image est déjà WebP et ≤ 1000 px, elle est renvoyée telle quelle
 * (pas de re-compression inutile).
 * @param {Buffer} buffer image source (JPG, PNG, WebP, GIF)
 * @returns {Promise<Buffer>} image WebP encodée
 * @throws {Error} si l'image est illisible par sharp.
 */
async function convertToWebP(buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('imageProcessor : buffer vide ou absent.');
  }

  // Détection rapide : si c'est déjà du WebP de petite taille, on évite
  // la re-compression (gain de CPU, zéro perte de qualité).
  try {
    const meta = await sharp(buffer, { animated: false }).metadata();
    if (meta.format === 'webp' && meta.width <= MAX_DIMENSION && meta.height <= MAX_DIMENSION) {
      return buffer;
    }
  } catch {
    // metadata() peut échouer sur des images exotiques : on continue
    // avec la conversion complète ci-dessous.
  }

  try {
    const pipeline = sharp(buffer, { animated: false })
      .resize(MAX_DIMENSION, MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({ quality: WEBP_QUALITY });

    const output = await pipeline.toBuffer();
    // sharp() est un objet stream-like : on s'assure qu'il est bien clos.
    // (toBuffer() consomme le flux ; close() est idempotent.)
    try { await pipeline.close(); } catch {}
    return output;
  } catch (err) {
    throw new Error(`imageProcessor : conversion WebP impossible (${err.message}).`);
  }
}

/**
 * Convertit un FICHIER sur disque en WebP, supprime l'original et renvoie
 * le nouveau chemin (extension .webp). Utilisé pour les uploads multer.
 * @param {string} filePath chemin absolu du fichier source (déposé par multer)
 * @returns {Promise<string>} nouveau chemin absolu (…​.webp), ou le chemin
 *   d'origine si la conversion échoue (repli : on garde l'image source).
 */
async function convertFileToWebP(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    const webpBuffer = await convertToWebP(buffer);
    const webpPath = filePath.replace(/\.[^.]+$/, '.webp');
    fs.writeFileSync(webpPath, webpBuffer);
    // Supprime l'original (seul le format compressé est conservé).
    if (webpPath !== filePath) {
      try { fs.unlinkSync(filePath); } catch {}
    }
    return webpPath;
  } catch (err) {
    // Repli : la conversion a échoué (image corrompue, format exotique…) —
    // on conserve l'original pour ne pas perdre l'image de l'utilisateur.
    console.warn(`[imageProcessor] Conversion WebP échouée pour ${path.basename(filePath)} : ${err.message}`);
    return filePath;
  }
}

// ------------------------------------------------------------
// Cache in-memory à TTL (Time-To-Live)
// ------------------------------------------------------------

/**
 * Fabrique un cache in-memory simple avec expiration par TTL.
 * - `ttlMs` : durée de vie d'une entrée (par défaut 10 min).
 * - `maxSize` : nombre maximal d'entrées (par défaut 500) — au-delà, les
 *   entrées les plus anciennes sont évacuées (évite la croissance illimitée).
 *
 * @returns {{get: Function, set: Function, delete: Function, clear: Function}}
 */
function createTtlCache({ ttlMs = 10 * 60 * 1000, maxSize = 500 } = {}) {
  const store = new Map();

  /** Évacue les entrées expirées (appelé paresseusement à chaque get/set). */
  function purgeExpired() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now >= entry.expires) {
        store.delete(key);
      }
    }
  }

  return {
    /**
     * Récupère une valeur du cache.
     * @returns {*} la valeur en cache, ou undefined si absente / expirée.
     */
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (Date.now() >= entry.expires) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },

    /**
     * Stocke une valeur dans le cache.
     * @param {string} key clé (généralement l'URL de la requête API).
     * @param {*} value valeur à mémoriser (JSON parsé, etc.).
     */
    set(key, value) {
      // Purge paresseuse : on nettoie les entrées expirées avant d'insérer.
      if (store.size >= maxSize) purgeExpired();
      // Si le cache est toujours plein après purge, on retire la plus ancienne.
      if (store.size >= maxSize) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      store.set(key, { value, expires: Date.now() + ttlMs });
    },

    /** Supprime une entrée spécifique. */
    delete(key) {
      store.delete(key);
    },

    /** Vide entièrement le cache (utile en cas de changement de config). */
    clear() {
      store.clear();
    },
  };
}

module.exports = {
  convertToWebP,
  convertFileToWebP,
  createTtlCache,
  WEBP_QUALITY,
  MAX_DIMENSION,
};
