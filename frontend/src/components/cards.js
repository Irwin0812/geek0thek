/**
 * Configuration partagée des cartes (vue grille) : dimensions, ratio
 * d'image et typographie selon la taille demandée.
 *
 *  - `md` : pages de collections (carré commun aux jaquettes de disques et
 *    aux vignettes BD ; le ratio 2:3 d'une BD y est préservé par
 *    `object-contain`, cf. coverFit)
 *  - `sm` : dashboard (« Derniers ajouts ») — cadre d'image plafonné à ~14rem
 *    de HAUTEUR sur grille Full HD (1920×1080, max-w-7xl : largeur de colonne
 *    ≈ 315px → hauteur imposée 14rem ≈ 224px) : la vignette respecte donc
 *    STRICTEMENT la taille de sa TUILE — jamais plus grande (plus large ni plus
 *    haut que le slot de grille), et sur mobile la largeur reste le maître tout
 *    en plafonnant la hauteur. L'image intérieure remplit ce cadre en
 *    object-cover (jaquette)
 *    ou object-contain (couverture 2:3 sur fond sombre), sans déborder.
 */
export const GRID_SIZES = {
  md: {
    vinylAspect: 'aspect-square',
    // Même cadre que les disques : carré. La couverture 2:3 reste intégrale
    // (object-contain) avec des marges sombres de part et d'autre.
    comicAspect: 'aspect-square',
    body: 'p-4 gap-1.5',
    title: 'text-base line-clamp-2',
    subtitle: 'text-sm line-clamp-2',
    badge: 'text-xs',
    chip: 'px-2 py-0.5',
  },
  sm: {
    // Derniers ajouts : la vignette ne dépasse JAMAIS sa tuile. Règles en jeu :
    //  - `overflow-hidden` sur le FRAME (et la carte) : tout débordement est
    //    rogné, strict ;
    //  - `max-h-56` (14rem ≈ 224px) plafonne la HAUTEUR du cadre en grille
    //    desktop (Full HD / max-w-7xl : colonne ≈ 315px de large) — avant, le
    //    ratio complet (≈ 1.25 × la largeur ≈ 345px+ de haut) surdéterminait
    //    la boîte et faisait déborder les rangées ;
    //  - `min-h-44` (11rem ≈ 176px) garantit un cadre toujours lisible sur les
    //    écrans intermédiaires sans écraser le contenu de pied de carte ;
    //  - mobile : la LARGUEUR de la colonne reste le maître, la hauteur suit le
    //    ratio 4:5 tant qu'elle n'atteint pas le plafond max-h-56.
    //   L'image intérieure remplit ensuite ce cadre : object-cover (jaquettes
    //   disques, léger recadrage toléré) ou object-contain (couvertures BD 2:3
    //   sur fond sombre, cf. coverFit).
    vinylAspect: 'aspect-[4/5] min-h-44 max-h-56',
    comicAspect: 'aspect-[4/5] min-h-44 max-h-56',
    body: 'p-3 gap-1',
    title: 'text-sm line-clamp-1',
    subtitle: 'text-[11px] line-clamp-1',
    badge: 'text-[10px]',
    chip: 'px-1.5 py-px',
  },
}

/** Ratio du cadre d'image d'une carte selon le type et la taille. */
export function coverAspect(type, size = 'md') {
  const s = GRID_SIZES[size] || GRID_SIZES.md
  return type === 'comic' ? s.comicAspect : s.vinylAspect
}

/**
 * Mode de remplissage de la couverture :
 *  - vinyl : `object-cover` — la jaquette carrée remplit tout le cadre ;
 *  - comic : `object-contain` — la couverture verticale (2:3) conserve ses
 *    proportions d'origine sans être déformée ni tronquée, le solde du
 *    cadre étant assuré par le fond sombre du conteneur (night).
 */
export function coverFit(type) {
  return type === 'comic' ? 'object-contain' : 'object-cover'
}

/**
 * Résout l'URL d'image d'un élément selon le type :
 *  - vinyl : chaîne /uploads/... servie par le proxy nginx → telle quelle
 *  - comic : chaîne /uploads/comics/... → préfixée par l'origine
 * Les URL distantes (http/https) sont conservées telles quelles.
 */
export function resolveCoverUrl(type, coverUrl) {
  if (!coverUrl || typeof coverUrl !== 'string' || !coverUrl) return null
  if (coverUrl.startsWith('http')) return coverUrl
  if (type === 'comic') return `${window.location.origin}${coverUrl}`
  return coverUrl
}

/**
 * « Date d'ajout » (YYYY-MM-DD) → timestamp local en millisecondes ;
 * -1 si la valeur est absente ou invalide (tri stable, les éléments sans
 * date tombent tout à gauche du dernier page si aucun autre tri ne s'applique).
 */
export function addedDateValue(value) {
  if (!value) return -1
  const s = String(value).trim().slice(0, 10)
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(value)
  const t = d.getTime()
  return Number.isNaN(t) ? -1 : t
}
/**
 * Formate une « date d'ajout » (YYYY-MM-DD de vinyls/comics.acquired_date,
 * éventuellement horodatée) en jj/mm/aaaa — temps local. Renvoie null si la
 * valeur est absente ou invalide.
 */
export function addedDateFr(value) {
  if (!value) return null
  const s = String(value).trim()
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s.split(' ')[0])
    ? new Date(`${s.slice(0, 10)}T00:00:00`)
    : new Date(s)
  if (Number.isNaN(d.getTime())) return null
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
}

/**
 * « Date d'ajout » (YYYY-MM-DD ou horodatée, colonnes added_date /
 * acquired_date) → ANNÉE seule (« 2026 »). Sert aux badges superposés des
 * vignettes du Dashboard : on n'y affiche plus le format jj/mm/aaaa.
 * Renvoie null si la valeur est absente ou invalide.
 */
export function addedYear(value) {
  if (!value) return null
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.split(' ')[0])) return s.slice(0, 4)
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return String(d.getFullYear())
}

/**
 * Formate une « date de sortie » (release_date : année seule, AAAA-MM-JJ ou
 * chaîne ISO8601) en jj/mm/aaaa — temps local. Si seule l'année est présente
 * (ou si la chaîne n'est pas parseable comme date complète), renvoie l'année
 * extraite ; null si la valeur est absente / invalide.
 */
export function releaseDateFr(value) {
  const s = String(value ?? '').trim()
  if (!s) return null
  const p = (n) => String(n).padStart(2, '0')
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10))
    ? new Date(`${s.slice(0, 10)}T00:00:00`)
    : new Date(s)
  if (!Number.isNaN(d.getTime())) {
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
  }
  const m = s.match(/(19|20)\d{2}/)
  return m ? m[0] : null
}
