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
 *  - URL absolue vers un hôte LOCAL/PRIVÉ (http://localhost:8080/…,
 *    http://172.16.x.x:…) -> le hôte brut est JAMAIS servi : on en extrait le
 *    CHEMIN RELATIF (/uploads/…) résolu contre l'origine courante. C'est la
 *    correction du « hôte brut » qui cassait l'image de profil en production
 *    derrière le reverse proxy (le navigateur ne peut pas joindre l'hôte local).
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

/** Hôte LOCAL / PRIVÉ : une URL d'image qui pointe vers l'un de ces hôtes
 *  (localhost, boucle locale, RFC1918, link-local, .local/.internal) est
 *  inutilisable en production derrière le reverse proxy — le navigateur ne
 *  peut pas joindre l'hôte brut depuis le domaine public. On ne la sert JAMAIS
 *  telle quelle : on en extrait le CHEMIN RELATIF pour le résoudre contre
 *  l'origine courante (window.location), comme un chemin local classique. */
function isLocalOrPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase()
  if (!host) return false
  if (host === 'localhost' || host === '0.0.0.0' || host === '[::1]' || host === '::1') return true
  if (host.endsWith('.local') || host.endsWith('.internal')) return true
  if (/^127\./.test(host)) return true
  if (/^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true // 172.16.0.0/12
  if (/^169\.254\./.test(host)) return true
  if (/^fe80:/i.test(host)) return true
  return false
}

/** Si `s` est une URL absolue pointant vers un hôte LOCAL/PRIVÉ (ex.
 *  http://localhost:8080/uploads/avatars/x.webp ou http://172.16.2.20:3000/…),
 *  renvoie son CHEMIN RELATIF (/uploads/avatars/x.webp) — résolu contre l'origine
 *  courante par le navigateur, JAMAIS vers l'hôte brut. Sinon renvoie `s` tel
 *  quel (URL publique distante ou chemin déjà relatif). */
function stripLocalHost(s) {
  const m = s.match(/^https?:\/\/([^\/?#]+)([^?#]*)/i)
  if (!m) return s
  // Le hôte peut porter un port (localhost:8080) : on ne teste que le nom.
  const host = m[1].split(':')[0]
  if (isLocalOrPrivateHost(host)) {
    return m[2] || '/'
  }
  return s
}

/**
 * Convertit une valeur « image » en source prête pour <img src>.
 * @param {string|null|undefined} url chemin local (/uploads/…, /img/…), URL
 *        distante (http/https) OU URL absolue vers un hôte local (localhost,
 *        IP VM…) renvoyée par le backend ou saisie par l'utilisateur.
 * @returns {string|null} source exploitable (chemin relatif, proxy même origine,
 *        ou blob:), ou null si aucune valeur.
 */
export function toDisplayImageUrl(url) {
  let s = String(url || '').trim()
  if (!s) return null
  // Aperçu de fichier choisi localement : object URL du navigateur.
  if (/^blob:/i.test(s)) return s
  // URL absolue vers un hôte LOCAL/PRIVÉ (localhost, IP VM…) : on ne la sert
  // jamais telle quelle — on en extrait le chemin relatif, résolu contre
  // l'origine courante (reverse proxy). C'est LA correction du « hôte brut »
  // qui cassait l'aperçu de l'image de profil en production.
  s = stripLocalHost(s)
  if (!s) return null
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
