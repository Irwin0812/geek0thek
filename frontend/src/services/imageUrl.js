/*
 * Copyright (C) 2026 Irwin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */

/**
 * Résolution CENTRALISÉE des URL d'images pour l'affichage (<img src>).
 *
 * C'est le SEUL endroit du front-end qui décide comment une valeur « image »
 * (chemin local stocké en base OU URL distante tierce) devient une source
 * exploitable par le navigateur. Tous les composants d'aperçu (cartes, liste,
 * modales de détail, formulaires d'ajout/édition, tuiles de groupe) passent
 * par `toDisplayImageUrl` — plus aucune construction d'URL ad hoc, donc plus
 * aucun hôte codé en dur (localhost / 172.16.x.x) et plus de Mixed Content.
 *
 * Règles :
 *  - VIDE            -> null (le composant affiche son placeholder).
 *  - blob:           -> tel quel (aperçu d'un fichier choisi localement).
 *  - chemin LOCAL    (/uploads/…, /img/…) -> renvoyé RELATIF : le navigateur
 *    le résout contre l'origine courante (window.location), quel que soit le
 *    domaine ou le protocole. C'est la forme la plus robuste — elle fonctionne
 *    sur n'importe quelle URL publique (https://demothek.igerarts.be, IP VM…)
 *    sans jamais connaître le hôte.
 *  - URL DISTANTE    (http:// ou https://) -> routée via le proxy d'image du
 *    backend (MÊME origine : /api/image-proxy?url=…). Le navigateur charge
 *    l'image depuis CETTE origine ; le backend la récupère côté serveur. Cela
 *    supprime à la fois :
 *      • le Mixed Content (une image http:// affichée sur un site https:// est
 *        bloquée par le navigateur — le proxy la sert en https même origine) ;
 *      • les blocages CORS / hotlinking des CDN tiers (Discogs, Open Library,
 *        Last.fm, Google Books) qui refusent d'être chargés directement dans
 *        un <img> depuis une autre origine.
 */

// Chemin RELATIF du proxy d'image (résolu contre l'origine courante par le
// navigateur). nginx (prod) et vite (dev) proxient /api/ vers le backend.
const IMAGE_PROXY_PATH = '/api/image-proxy'

/**
 * Convertit une valeur « image » en source prête pour <img src>.
 * @param {string|null|undefined} url chemin local (/uploads/…, /img/…) ou URL
 *        distante (http/https) renvoyée par le backend ou saisie par l'utilisateur.
 * @returns {string|null} source exploitable (chemin relatif, proxy même origine,
 *        ou blob:), ou null si aucune valeur.
 */
export function toDisplayImageUrl(url) {
  const s = String(url || '').trim()
  if (!s) return null
  // Aperçu de fichier choisi localement : object URL du navigateur.
  if (/^blob:/i.test(s)) return s
  // URL distante (http:// ou https://) -> proxy même origine (anti Mixed Content
  // + anti CORS/hotlinking). Le paramètre `url` est encodé : l'URL source peut
  // porter des « & », « ? » propres aux CDN sans casser notre requête.
  if (/^https?:\/\//i.test(s)) {
    return `${IMAGE_PROXY_PATH}?url=${encodeURIComponent(s)}`
  }
  // Chemin local : on le renvoie RELATIF (jamais de hôte préfixé). Une valeur
  // déjà relative avec slash initial est conservée telle quelle ; une valeur
  // relative sans slash initial (rare) est normalisée.
  if (s.startsWith('/')) return s
  return `/${s}`
}
