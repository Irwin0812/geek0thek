import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FallbackCover as ComicFallback } from './ComicCard.jsx'
import { FallbackCover as VinylFallback } from './VinylCard.jsx'
import { coverAspect, resolveCoverUrl } from './cards.js'
import { resolveGroupImage } from './collection.js'

/**
 * Tuile de regroupement (niveau 1) : une série de BD ou un artiste de disques.
 * RÈGLE STRICTE : si l'artiste / la série n'a PAS d'image dédiée, la tuile
 * pointe IMPÉRATIVEMENT vers l'image de secours locale correspondante
 * (img/no_group.jpg pour les artistes / img/no_title.jpg pour les séries) —
 * elle ne retomme JAMAIS sur la couverture d'album / de tome du groupe
 * (`coverUrl`) : la dissociation image dédiée ↔ jaquette/couverture du tome
 * est totale. Un chemin local (/uploads/...) est résolu en URL absolue
 * (les routes du SPA peuvent être profondes, cf. ComicCard).
 *
 * BD : l'image affichée est la série DÉDIÉE (`seriesImage`, colonne
 * comics.series_image portée par le backend — Open Library / Google Books ou
 * upload manuel « seriesImage », repli propre img/no_title.jpg) si présente :
 * elle ne sert QUE sur la tuile de la grille « Mes BD », jamais sur les
 * cartes des tomes individuels (celles-ci restent sur leur couverture
 * d'album `coverUrl`). Sans image dédiée : JAMAIS la couverture d'un tome —
 * l'image de secours locale img/no_title.jpg.
 *
 * DISQUES : l'image affichée est la PHOTO / LOGO d'artiste (`artistImage`,
 * portée par le backend — récupérée automatiquement via MusicBrainz /
 * Cover Art Archive ou téléversée manuellement, repli propre img/no_group.jpg) :
 * elle ne sert QUE dans la grille « Mes Disques », jamais sur les cartes des
 * disques individuels (ceux-ci restent sur leur jaquette d'album `coverUrl`).
 * Sans photo d'artiste : JAMAIS la jaquette d'un album — l'image de secours
 * locale img/no_group.jpg.
 *
 *  - `view` : 'card' | 'jukebox' (format carte à jouer)
 *  - `size` : 'md' | 'sm' (dashboard, image réduite)
 */
export default function GroupCard({
  name,
  count,
  coverUrl,
  artistImage = null,
  seriesImage = null,
  variant = 'comic',
  view = 'card',
  size = 'md',
  showTitle = true,
  showAddedDate = false,
  isUnlabeled = false,
  onClick = null,
  actions = null,
}) {
  const { t } = useTranslation()
  const isVinyl = variant === 'vinyl'
  // « Hors série » / « Divers » : le NOM interne (NO_SERIES_LABEL / NO_ARTIST_LABEL)
  // reste inchangé pour la logique (groupement, pré-remplissage) ; seul l'affichage
  // est traduit via `isUnlabeled` (flag posé par groupComicsBySeries /
  // groupVinylsByArtist).
  const displayName = isUnlabeled ? t(isVinyl ? 'collection.groupNoArtist' : 'collection.groupNoSeries') : name
  const jukebox = view === 'jukebox'
  // Tuiles du Dashboard « Derniers ajouts » (mode `showAddedDate`) : même
  // effet de SURVOL LUMINEUX ARGENTÉ que VinylCard / ComicCard — bordure gris
  // argenté + halo clair subtil. Hors dashboard, rien ne change.
  const silverHover =
    showAddedDate && !jukebox
      ? 'hover:border-slate-300 hover:shadow-[0_0_15px_rgba(203,213,225,0.25)]'
      : ''

  // RÈGLE STRICTE (dissociation stricte) : l'image du groupe est EXCLUSIVEMENT
  // sa photo / logo DÉDIÉ — `artistImage` (disques) ou `seriesImage` (BD).
  // Si cette valeur est vide, null, non définie (ou porte le repli propre
  // no_*.jpg exposé par le backend), la source pointe IMPÉRATIVEMENT vers
  // l'image de secours locale correspondante — elle ne retomme JAMAIS sur la
  // couverture d'ALBUM / de TOME (`coverUrl`) pour la tuile du groupe :
  //  - DISQUES -> img/no_group.jpg (artiste sans photo) ;
  //  - BD      -> img/no_title.jpg (série sans image dédiée).
  // Les cartes des éléments INDIVIDUELS (VinylCard / ComicCard via ItemList)
  // restent sur leur jaquette `coverUrl` — la présente tuile de groupe, elle,
  // n'en adopte jamais une. « Absence » = vide/null/undefined OU emblème par
  // défaut du backend (reconnu même préfixé par l'origine : fin de chemin).
  const dedicatedImage = isVinyl ? artistImage : seriesImage
  const imageSrc = resolveGroupImage(isVinyl ? 'artist' : 'series', dedicatedImage)
  // `coverUrl` (couverture d'ALBUM / de TOME) est volontairement JAMAIS utilisé
  // ici — aucun fallback vers une jaquette individuelle.
  const resolvedCover = useMemo(
    () =>
      imageSrc && !isVinyl && !imageSrc.startsWith('http')
        ? `${window.location.origin}${imageSrc}`
        : resolveCoverUrl(isVinyl ? 'vinyl' : 'comic', imageSrc),
    [imageSrc, isVinyl]
  )

  return (
    <article
      data-card="group"
      aria-label={onClick ? t(isVinyl ? 'collection.viewGroupVinyls' : 'collection.viewGroupComics', { name: displayName }) : undefined}
      className={`group relative flex flex-col overflow-hidden transition duration-500 ${
        jukebox
          ? 'rounded-lg border-2 border-gold-500/60 bg-night-900 shadow-lg shadow-gold-500/10 outline outline-1 outline-gold-500/25 '
          : `card overflow-hidden ${silverHover}`
      }${onClick ? 'cursor-pointer' : ''}`}
      onClick={
        onClick
          ? (e) => {
              if (e.target.closest('a,button,input,select,textarea')) return
              onClick()
            }
          : undefined
      }
    >
      {/* Cadre : carré pour les BD (comme les disques). L'image DÉDIÉE de la
          série / de l'artiste remplit TOUTE la tuile (object-cover, pleine
          hauteur et largeur) — même comportement que les jaquettes carrées
          des disques : aucune bande noire ni espace vide en marges. */}
      <div
        className={`relative overflow-hidden ${isVinyl ? 'bg-night-900' : 'bg-gradient-to-br from-night-800 to-night-900'} ${coverAspect(isVinyl ? 'vinyl' : 'comic', size)}`}
      >
        {resolvedCover ? (
          // Même zoom fluide au survol que les jaquettes de disques (VinylCard) :
          // transition 500 ms + scale 1.04, confiné dans le cadre par son
          // overflow-hidden — quel que soit le domaine (disques / BD).
          <img
            src={resolvedCover}
            alt={`« ${displayName} »`}
            loading="lazy"
            className="h-full w-full object-cover select-none transition duration-500 group-hover:scale-[1.04]"
            onError={(e) => {
              e.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : isVinyl ? (
          <VinylFallback artist={displayName} />
        ) : (
          <ComicFallback title={displayName} />
        )}

        {/* Bandeau dégradé : nom du groupe + nombre d'éléments */}
        {(showTitle || count != null) && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-night-950/95 via-night-950/60 to-transparent px-3 pb-3 pt-12">
            {showTitle && (
              <h3 className={`line-clamp-2 font-extrabold leading-tight text-white ${
                size === 'sm' ? 'text-sm' : 'text-base'
              }`} title={displayName}>
                {displayName}
              </h3>
            )}
            {count != null && (
              <p className={`mt-0.5 font-semibold text-gold-300 ${size === 'sm' ? 'text-[10px]' : 'text-xs'}`}>
                {t(isVinyl ? 'collection.vinylsCount' : 'collection.albumsCount', { count })}
              </p>
            )}
          </div>
        )}
      </div>

      {actions && <div className="border-t border-night-600/50 p-3">{actions}</div>}
    </article>
  )
}
