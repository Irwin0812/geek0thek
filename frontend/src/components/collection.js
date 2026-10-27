/**
 * Utilitaires de regroupement des collections :
 * - BD    : groupées par « Série » (les albums sans série forment « Hors série »)
 * - Disques : groupés par « Artiste » (« Divers » pour les artistes vides)
 *
 * Chaque groupe exposé contient :
 *  - key       : identifiant stable (clé React)
 *  - name      : nom affiché sur la tuile
 *  - items     : éléments triés (tome, puis date de sortie)
 *  - coverUrl  : première image disponible du groupe (tuile niveau 1)
 */

export const NO_SERIES_KEY = '__no_series__'
export const NO_SERIES_LABEL = 'Hors série'
export const NO_ARTIST_KEY = '__no_artist__'
export const NO_ARTIST_LABEL = 'Divers'

/* IMAGE DE SÉRIE — chemin local de repli porté par le backend (repli propre
   en cas d'échec de la récupération Open Library / Google Books ou upload
   manuel « seriesImage », cf. seriesService.js) : à traiter comme « absence »
   d'image dédiée, la tuile de série retombe alors sur la première couverture
   du groupe (couverture d'ALBUM — `cover_url` reste toujours inchangée). */
export const DEFAULT_SERIES_IMAGE = '/img/no_title.jpg'

/** Normalise un libellé de groupe (minuscules, apostrophes normalisées). */
export function groupKeyOf(name, fallbackKey) {
  const clean = String(name || '').trim().toLowerCase().replace(/['’]/g, "'")
  return clean || fallbackKey
}

/**
 * Tri « numérique d'abord, alphabétique ensuite » :
 * Tome 2 passe devant « 2.5 », qui passe devant « Saga complète ».
 */
export function sortTomeValues(values) {
  const parse = (v) => {
    const m = String(v).match(/(\d+(?:[.,]\d+)?)/)
    return m ? Number(m[1].replace(',', '.')) : null
  }
  return [...values].sort((a, b) => {
    const na = parse(a)
    const nb = parse(b)
    if (na !== null && nb !== null && na !== nb) return na - nb
    if (na !== null) return -1
    if (nb !== null) return 1
    return String(a).localeCompare(String(b), 'fr')
  })
}

function byReleaseDesc(a, b) {
  const da = a.releaseDate ? String(a.releaseDate).slice(0, 10) : '0000'
  const db = b.releaseDate ? String(b.releaseDate).slice(0, 10) : '0000'
  return db.localeCompare(da)
}

function byReleaseAsc(a, b) {
  const da = a.releaseDate ? String(a.releaseDate).slice(0, 10) : '0000'
  const db = b.releaseDate ? String(b.releaseDate).slice(0, 10) : '0000'
  return da.localeCompare(db)
}

/* Image / logo DÉDIÉ à une SÉRIE : 1re image « seriesImage » NON par défaut
   trouvée parmi les tomes du groupe (les tomes partagent la même image de
   série — comics.series_image portée par le backend). null si aucun tome ne
   porte une vraie image dédiée -> la tuile retombe sur la première couverture. */
function seriesImageOf(items) {
  const withImage = items.find(
    (i) => i.seriesImageUrl && String(i.seriesImageUrl).trim() !== DEFAULT_SERIES_IMAGE
  )
  return withImage ? withImage.seriesImageUrl : null
}

/** Regroupe une liste de BD par série (tomes triés par numéro, puis date). */
export function groupComicsBySeries(comics) {
  const map = new Map()
  for (const comic of comics) {
    const key = groupKeyOf(comic.series, NO_SERIES_KEY)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(comic)
  }

  const groups = []
  for (const [key, items] of map) {
    // Tomes numérotés d'abord (ordre numérique, ex. 2 avant « 2.5 »),
    // puis les albums sans tome, chacun par date de sortie croissante.
    const tomes = items.filter((i) => i.tomeNumber)
    const sansTome = items.filter((i) => !i.tomeNumber)
    tomes.sort((a, b) => {
      if (String(a.tomeNumber).trim() === String(b.tomeNumber).trim()) {
        return byReleaseAsc(a, b) || (a.id - b.id)
      }
      const first = sortTomeValues([a.tomeNumber, b.tomeNumber])[0]
      return a.tomeNumber === first ? -1 : 1
    })
    sansTome.sort((a, b) => byReleaseAsc(a, b) || (a.id - b.id))
    const sorted = [...tomes, ...sansTome]

    const withCover = sorted.find((i) => i.coverUrl)
    groups.push({
      key,
      name: items.find((i) => i.series)?.series.trim() || NO_SERIES_LABEL,
      items: sorted,
      // Couverture d'ALBUM (première image disponible) — visuelle des tomes
      // individuels : inchangée.
      coverUrl: withCover ? withCover.coverUrl : null,
      // Image / logo DÉDIÉ à la SÉRIE (colonne comics.series_image portée par
      // le backend — Open Library / Google Books ou upload manuel « seriesImage ») :
      // utilisée UNIQUEMENT sur la tuile de série de la grille « Mes BD ».
      // Le repli propre img/no_title.jpg est traité comme une absence.
      seriesImage: key === NO_SERIES_KEY ? null : seriesImageOf(sorted),
      isUnlabeled: key === NO_SERIES_KEY,
    })
  }

  // Groupes nommés d'abord (A→Z), « Hors série » en dernier.
  groups.sort((a, b) => {
    if (a.isUnlabeled !== b.isUnlabeled) return a.isUnlabeled ? 1 : -1
    return a.name.localeCompare(b.name, 'fr')
  })
  return groups
}

/* IMAGE D'ARTISTE — chemin local de repli porté par le backend (repli propre
   en cas d'échec de la récupération automatique) : à traiter comme « absence »
   de photo d'artiste, la tuile de groupe retombe alors sur son fond dédié. */
export const DEFAULT_ARTIST_IMAGE = '/img/no_group.jpg'

/* Photo / logo d'ARTISTE d'un groupe : première image NON par défaut trouvée
   parmi les disques du groupe (les disques partagent l'image de leur artiste).
   null si aucun disque ne porte une vraie photo -> la tuile affiche son fond. */
function artistImageOf(items) {
  const withImage = items.find(
    (i) => i.artistImage && String(i.artistImage).trim() !== DEFAULT_ARTIST_IMAGE
  )
  return withImage ? withImage.artistImage : null
}

/** Regroupe une liste de disques par artiste (trié par année de sortie). */
export function groupVinylsByArtist(vinyls) {
  const map = new Map()
  for (const vinyl of vinyls) {
    const key = groupKeyOf(vinyl.artist, NO_ARTIST_KEY)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(vinyl)
  }

  const groups = []
  for (const [key, items] of map) {
    items.sort((a, b) => byReleaseDesc(a, b) || (a.id > b.id ? 1 : -1))
    const withCover = items.find((i) => i.coverUrl)
    groups.push({
      key,
      name: items.find((i) => i.artist)?.artist.trim() || NO_ARTIST_LABEL,
      items,
      coverUrl: withCover ? withCover.coverUrl : null,
      // Photo / logo d'ARTISTE (grille « Mes Disques » uniquement — les
      // jaquettes des disques individuels restent sur coverUrl).
      artistImage: key === NO_ARTIST_KEY ? null : artistImageOf(items),
      isUnlabeled: key === NO_ARTIST_KEY,
    })
  }

  // Groupes nommés d'abord (A→Z), « Divers » en dernier.
  groups.sort((a, b) => {
    if (a.isUnlabeled !== b.isUnlabeled) return a.isUnlabeled ? 1 : -1
    return a.name.localeCompare(b.name, 'fr')
  })
  return groups
}

/**
 * Image d'un GROUPE niveau 1 (tuile de grille GroupCard / ligne d'accordéon
 * GroupedItemList) — helper partagé par les deux vues.
 * `type` : 'artist' (disques) | 'series' (BD).
 *
 * RÈGLE STRICTE (dissociation totale) : si l'image dédiée (`artistImage` /
 * `seriesImage`) est vide, null, non définie — OU porte l'emblème par défaut
 * du backend (img/no_group.jpg / img/no_title.jpg, reconnu à sa FIN de nom
 * quel que soit l'origine préfixée) — retourne IMPÉRATIVEMENT l'image de
 * secours LOCALE correspondante. Elle ne retomme JAMAIS sur la couverture
 * d'un album individuel (`coverUrl`) ni sur la jaquette d'un tome.
 */
export function resolveGroupImage(type, dedicated) {
  const fallbackImage = type === 'artist' ? DEFAULT_ARTIST_IMAGE : DEFAULT_SERIES_IMAGE
  if (typeof dedicated !== 'string' || !dedicated.trim()) return fallbackImage
  const emblem = fallbackImage.slice(fallbackImage.lastIndexOf('/') + 1)
  // Compare la FIN de chemin (préfixe d'origine mis à part) pour couvrir
  // aussi le repli retourné AVEC son préfixe d'origine (https://site/…/no_*.jpg).
  const localPath = dedicated.replace(/^https?:\/\/[^/]+/i, '')
  return localPath.endsWith(emblem) ? fallbackImage : dedicated
}
