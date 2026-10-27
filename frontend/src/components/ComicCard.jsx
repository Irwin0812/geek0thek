import { GRID_SIZES, coverAspect, coverFit, resolveCoverUrl, releaseDateFr } from './cards.js'
import { releaseYear } from './listData.js'

/**
 * Carte d'une bande dessinée (vue grille).
 *  - `view`   : 'card' | 'jukebox' (format carte à jouer)
 *  - `size`   : 'md' (collections) | 'sm' (dashboard, images réduites)
 *  - `showTitle` / `showYear` : options de la grille (defaults true)
 *  - `showAddedDate` : mode Dashboard « Derniers ajouts » — aucun badge en
 *    haut-gauche (badge d'année / « Ajouté en 20… » retiré), pied de carte =
 *    date de sortie sous le badge de genre. Dans les collections rien ne
 *    change : année de sortie en haut-gauche, rien en bas.
 * `comic` suit le DTO backend : { id, coverUrl, title, series, tomeNumber,
 * authors, publisher, releaseDate, genre, condition, isSpecialEdition,
 * isSigned, addedDate, owner }
 */
export default function ComicCard({
  comic,
  view = 'card',
  size = 'md',
  compact = false, // compat (dashboard legacy) → taille réduite
  showTitle = true,
  showYear = true,
  showAddedDate = false,
  actions = null,
  onClick = null,
}) {
  const s = GRID_SIZES[size] || GRID_SIZES[compact ? 'sm' : 'md']
  const src = resolveCoverUrl('comic', comic.coverUrl)
  // Disposition des dates — sur le Dashboard (« Derniers ajouts »,
  // `showAddedDate`) : AUCUN badge superposé en HAUT-GAUCHE de la couverture
  // (le badge d'ajout « Ajouté en 20… » a été retiré) ; pied de carte → DATE
  // DE SORTIE (dto.releaseDate) sous le badge de genre. Hors dashboard rien
  // ne change (année de sortie en haut-gauche, rien en bas).
  const year = releaseYear(comic)
  const releaseLabel = releaseDateFr(comic.releaseDate)
  // Badge haut-gauche : année de sortie uniquement hors dashboard ; sur le
  // Dashboard aucun badge n'est affiché (pas d'année, pas de date d'ajout) —
  // comportement aligné sur les cartes Disques.
  const topLeft = showAddedDate ? null : (showYear ? year : null)
  // Pied de carte : date de sortie sur le dashboard, rien ailleurs
  const bottomLabel = showAddedDate ? releaseLabel : null
  const jukebox = view === 'jukebox'

  return (
    <article
      data-card="comic"
      aria-label={onClick ? `Voir la fiche de ${comic.title}` : undefined}
      className={`group relative flex flex-col overflow-hidden transition duration-500 ${
        jukebox
          ? 'rounded-lg border-2 border-gold-500/60 bg-night-900 shadow-lg shadow-gold-500/10 outline outline-1 outline-gold-500/25 '
          : 'card overflow-hidden '
      }${onClick ? 'cursor-pointer' : ''} ${jukebox ? 'aspect-[5/7]' : ''}`}
      onClick={
        onClick
          ? (e) => {
              if (e.target.closest('a,button,input,select,textarea')) return
              onClick(comic)
            }
          : undefined
      }
    >
      {/* Vignette : même cadre carré que les disques ; fond sombre derrière la
          couverture 2:3 (object-contain) pour absorber les marges latérales */}
      <div
        className={`relative overflow-hidden bg-gradient-to-br from-night-800 to-night-900 ${coverAspect('comic', size)}`}
      >
        {src ? (
          <img
            src={src}
            alt={`Couverture — ${comic.title}`}
            loading="lazy"
            className={`h-full w-full ${coverFit('comic')} select-none`}
            onError={(e) => {
              e.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : (
          <FallbackCover title={comic.title} />
        )}

        {/* Chips haut : année de sortie + édition spéciale / dédicacé (gauche) +
            collection (droite). Sur le Dashboard (`showAddedDate`), aucun
            badge n'est affiché en haut-gauche ; ailleurs, l'année de sortie. */}
        {topLeft || comic.isSpecialEdition || comic.isSigned || comic.owner ? (
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
            <div className="flex flex-col items-start gap-1.5">
              {topLeft && (
                <span className="badge border border-night-600 bg-night-950/70 backdrop-blur text-slate-200">
                  {topLeft}
                </span>
              )}
              {comic.isSpecialEdition && (
                <span className="badge border border-gold-400/60 bg-gold-500/90 font-bold text-night-950">
                  Édition Spéciale
                </span>
              )}
              {/* « Livre dédicacé » : badge distinct de l'édition spéciale */}
              {comic.isSigned && (
                <span className="badge border border-orange-400/70 bg-orange-500/90 font-bold text-night-950">
                  Dédicacé
                </span>
              )}
            </div>
            {comic.owner && (
              <span className="badge border border-gold-500/30 bg-gold-500/15 text-gold-300 backdrop-blur">
                Collection {comic.owner.lastName}
              </span>
            )}
          </div>
        ) : null}

        {/* Format carte à jouer : titre en bandeau bas sur la couverture */}
        {jukebox && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-night-950/95 via-night-950/60 to-transparent px-3 pb-3 pt-10">
            {(comic.series || comic.tomeNumber) && (
              <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-gold-400/90">
                {comic.series}
                {comic.tomeNumber ? ` · Tome ${comic.tomeNumber}` : ''}
              </p>
            )}
            {showTitle ? (
              <h3 className="line-clamp-1 font-extrabold leading-tight text-white" title={comic.title}>
                {comic.title}
              </h3>
            ) : null}
            {/* « Date de sortie » visible aussi en mode carte à jouer
                (dashboard) : seul repère de date de la vignette, le badge
                d'année/d'ajout haut-gauche ayant été retiré sur le Dashboard. */}
            {showAddedDate && bottomLabel && (
              <p className="mt-1 truncate text-[10px] font-medium text-gold-300/80">Sorti le {bottomLabel}</p>
            )}
          </div>
        )}
      </div>

      {/* Corps de la carte */}
      {!jukebox && (
        <div className={`flex flex-1 flex-col ${s.body}`}>
          {comic.series && (
            <p
              className={`truncate font-semibold uppercase tracking-wider text-gold-400/90 ${s.subtitle}`}
              title={comic.series}
            >
              {comic.series}
              {comic.tomeNumber ? ` · Tome ${comic.tomeNumber}` : ''}
            </p>
          )}
          {showTitle && (
            <h3 className={`font-bold leading-snug text-white ${s.title}`} title={comic.title}>
              {comic.title}
            </h3>
          )}
          {comic.authors && (
            <p className={`text-slate-400 ${s.subtitle}`} title={comic.authors}>
              {comic.authors}
            </p>
          )}

          {(comic.genre || comic.publisher) && (
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              {comic.genre && <Tag className={s.badge}>{comic.genre}</Tag>}
              {comic.publisher && size === 'md' && <Tag muted className={s.badge}>{comic.publisher}</Tag>}
            </div>
          )}

          {/* « Date de sortie » en bas de carte (dashboard), sous le badge de
              genre : seul repère de date de la vignette (le badge d'année /
              d'ajout haut-gauche ayant été retiré sur le Dashboard). */}
          {showAddedDate && bottomLabel && !actions && (
            <p className="mt-auto pt-1 text-[11px] font-medium text-slate-400" title={bottomLabel}>
              Sorti le {bottomLabel}
            </p>
          )}

          {actions && <div className="mt-3 border-t border-night-600/50 pt-3">{actions}</div>}
        </div>
      )}
    </article>
  )
}

function Tag({ children, muted = false, className = '' }) {
  return (
    <span
      className={`badge ${className} ${
        muted
          ? 'bg-night-700/70 text-slate-400'
          : 'bg-gold-500/10 text-gold-300 border border-gold-500/20'
      }`}
    >
      {children}
    </span>
  )
}

export function FallbackCover({ title }) {
  const initial = (title || '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <div className="grid h-full w-full place-items-center bg-gradient-to-br from-night-800 to-night-900">
      <div className="grid h-20 w-14 place-items-center rounded-md border-4 border-night-600 bg-night-700 shadow-inner sm:h-24 sm:w-[68px]">
        <span className="text-2xl font-extrabold text-gold-400">{initial}</span>
      </div>
    </div>
  )
}
