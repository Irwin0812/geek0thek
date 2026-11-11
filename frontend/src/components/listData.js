/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/**
 * Helpers de déduction de badges / méta-données partagés par la vue liste
 * (ItemList) et les toggles de la vue grille.
 *
 * Les DTO backend ne portent ni note, ni sous-titres, ni durée :
 * on se base donc sur les champs réellement disponibles, avec des
 * heuristiques transparentes (sous-titres mentionnés dans les notes,
 * « validé » = identifiant vérifié présent, etc.).
 */
import { toDisplayImageUrl } from '../services/imageUrl.js'

/** Année (4 chiffres) extraite d'une date de sortie de n'importe quel format. */
export function releaseYear(item) {
  const ds = String(item?.releaseDate || '').trim()
  const m = ds.match(/(19|20)\d{2}/)
  if (m) return m[0]
  if (ds.length >= 4) {
    const head = ds.slice(0, 4)
    if (/^\d{4}$/.test(head)) return head
  }
  return null
}

/** Sous-titres mentionnés quelque part dans les notes / synopsis ? */
export function hasSubtitles(type, item) {
  const text = [item?.notes, item?.synopsis, item?.tracklist]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  if (!text) return false
  return /sous[-\s]?titre|sous[-\s]?titr|\bcc\b/.test(text)
}

/**
 * Statut « validé » (✓) : l'élément porte un identifiant de référence
 * vérifié (barcode / MBID pour un disque, ISBN ou édition spéciale pour une BD).
 */
export function isVerified(type, item) {
  if (!item) return false
  return type === 'vinyl'
    ? Boolean(item.barcode || item.mbid || item.discogsReleaseId)
    : Boolean(item.isbn)
}

/**
 * Badges d'information de la ligne (alignés à droite).
 * Retourne [{ label, tone }] où tone ∈ 'gold' | 'muted' | 'check'.
 * `t` (react-i18next) est requis pour les libellés traduits.
 */
export function itemBadges(type, item, t) {
  if (!item) return []
  if (type === 'vinyl') {
    const badges = []
    if (item.trackCount > 0) badges.push({ label: t('collection.tracksBadge', { count: item.trackCount }), tone: 'muted' })
    if (item.genre) badges.push({ label: String(item.genre).split('/')[0].trim(), tone: 'gold' })
    if (isVerified('vinyl', item)) badges.push({ label: t('collection.verifiedBadge'), tone: 'check' })
    if (item.owner) badges.push({ label: t('collection.collectionOwner', { name: item.owner.lastName }), tone: 'gold' })
    return badges.slice(0, 3)
  }
  const badges = []
  if (item.tomeNumber) badges.push({ label: t('collection.volumeBadge', { number: item.tomeNumber }), tone: 'muted' })
  // L'ancien badge « état » a été retiré (champ remplacé par la date d'ajout) ;
  // on y substitue le badge « Dédicacé » (is_signed) du formulaire BD.
  if (item.isSigned) badges.push({ label: t('collection.signedBadge'), tone: 'check' })
  if (item.isSpecialEdition) badges.push({ label: t('collection.specialEditionBadge'), tone: 'check' })
  if (item.owner) badges.push({ label: t('collection.collectionOwner', { name: item.owner.lastName }), tone: 'gold' })
  return badges.slice(0, 3)
}

/**
 * Résout l'URL de mini-visuel pour l'affichage (<img src>).
 *
 * Centralisé dans services/imageUrl.js : chemins LOCAUX renvoyés RELATIFS
 * (résolus contre l'origine courante — jamais de hôte codé en dur) et URL
 * DISTANTES routées via le proxy d'image du backend (même origine) pour éviter
 * le Mixed Content et les blocages CORS / hotlinking. Le paramètre `type` est
 * conservé pour la compatibilité des appels mais n'influence plus la résolution.
 */
export function resolveImageUrl(type, coverUrl) {
  return toDisplayImageUrl(coverUrl)
}
