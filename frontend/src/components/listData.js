/**
 * Helpers de déduction de badges / méta-données partagés par la vue liste
 * (ItemList) et les toggles de la vue grille.
 *
 * Les DTO backend ne portent ni note, ni sous-titres, ni durée :
 * on se base donc sur les champs réellement disponibles, avec des
 * heuristiques transparentes (sous-titres mentionnés dans les notes,
 * « validé » = identifiant vérifié présent, etc.).
 */

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
 */
export function itemBadges(type, item) {
  if (!item) return []
  if (type === 'vinyl') {
    const badges = []
    if (item.trackCount > 0) badges.push({ label: `${item.trackCount} titre${item.trackCount > 1 ? 's' : ''}`, tone: 'muted' })
    if (item.genre) badges.push({ label: String(item.genre).split('/')[0].trim(), tone: 'gold' })
    if (isVerified('vinyl', item)) badges.push({ label: 'Validé', tone: 'check' })
    if (item.owner) badges.push({ label: `Coll. ${item.owner.lastName}`, tone: 'gold' })
    return badges.slice(0, 3)
  }
  const badges = []
  if (item.tomeNumber) badges.push({ label: `Tome ${item.tomeNumber}`, tone: 'muted' })
  // L'ancien badge « état » a été retiré (champ remplacé par la date d'ajout) ;
  // on y substitue le badge « Dédicacé » (is_signed) du formulaire BD.
  if (item.isSigned) badges.push({ label: 'Dédicacé', tone: 'check' })
  if (item.isSpecialEdition) badges.push({ label: 'Éd. spéciale', tone: 'check' })
  if (item.owner) badges.push({ label: `Coll. ${item.owner.lastName}`, tone: 'gold' })
  return badges.slice(0, 3)
}

/**
 * Résout l'URL de mini-visuel selon les règles de chaque collection :
 * BD locales → préfixer l'origine ; disques / URLs distantes → tel quel.
 */
export function resolveImageUrl(type, coverUrl) {
  if (!coverUrl || typeof coverUrl !== 'string' || !coverUrl) return null
  if (coverUrl.startsWith('http')) return coverUrl
  if (type === 'comic') return `${window.location.origin}${coverUrl}`
  return coverUrl
}
