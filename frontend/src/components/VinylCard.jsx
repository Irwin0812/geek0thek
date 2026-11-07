import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { GRID_SIZES, coverAspect, coverFit, resolveCoverUrl, releaseDateFr } from './cards.js'
import { releaseYear } from './listData.js'

/**
 * Carte d'un disque (vue grille).
 *
 *  - `view`   : 'card' (default) | 'jukebox' — le format « carte à jouer »
 *    est un rectangle à double bise or, titre en bandeau bas sur la jaquette.
 *  - `size`   : 'md' (collections) | 'sm' (dashboard, images réduites)
 *  - `showTitle` / `showYear` : options de la grille (defaults true)
 *  - `showAddedDate` : mode Dashboard « Derniers ajouts » — le badge
 *    d'année haut-gauche est retiré et la DATE DE SORTIE (« Sorti le … »)
 *    descend en pied de carte, sous le badge de genre. Dans les collections
 *    rien ne change : année de sortie en haut-gauche, rien en bas.
 */
function VinylCard({
  vinyl,
  view = 'card',
  size = 'md',
  compact = false, // compat (dashboard legacy) → taille réduite
  showTitle = true,
  showYear = true,
  showAddedDate = false,
  actions = null,
  onClick = null,
}) {
  // COMPOSANT PARTAGÉ (collections + Dashboard « Derniers ajouts ») : un libellé
  // est traduit seulement si la clé EXISTE déjà dans les 6 locales (viewSheet,
  // coverAltVinyl, collectionOf, releasedOn, tracksBadge) — pas de clé neuve
  // « disques » qui y introduirait du vocabulaire de collection.
  const { t } = useTranslation()
  const s = GRID_SIZES[size] || GRID_SIZES[compact ? 'sm' : 'md']
  const src = resolveCoverUrl('vinyl', vinyl.coverUrl)
  // Disposition des dates — sur le Dashboard (« Derniers ajouts »,
  // `showAddedDate`) :
  //  - badge superposé HAUT-GAUCHE de la jaquette → RETIRÉ (plus de badge
  //    d'année « 2021 » ni de date d'ajout) ;
  //  - pied de carte → DATE DE SORTIE (dto.releaseDate), « Sorti le … », sous
  //    le badge de genre.
  // Hors dashboard : rien ne change (année en haut, rien en bas).
  const year = releaseYear(vinyl)
  const releaseLabel = releaseDateFr(vinyl.releaseDate)
  // Badge haut-gauche : année de sortie uniquement hors dashboard ; sur le
  // Dashboard le badge haut-gauche a été retiré (pas d'année, pas de date
  // d'ajout).
  const topLeft = showAddedDate ? null : (showYear ? year : null)
  // Pied de carte : date de sortie sur le dashboard, rien ailleurs
  const bottomLabel = showAddedDate ? releaseLabel : null
  const jukebox = view === 'jukebox'

  return (
    <article
      data-card="vinyl"
      aria-label={onClick ? t('collection.viewSheet', { title: vinyl.title }) : undefined}
      className={`group relative flex flex-col overflow-hidden transition duration-500 ${
        jukebox
          ? 'rounded-lg border-2 border-gold-500/60 bg-night-900 shadow-lg shadow-gold-500/10 outline outline-1 outline-gold-500/25 '
          : `card overflow-hidden ${
              // Tuiles du Dashboard « Derniers ajouts » (mode `showAddedDate`) :
              // effet de SURVOL LUMINEUX ARGENTÉ — bordure gris argenté + halo
              // clair subtil autour de toute la vignette. Hors dashboard
              // (grilles des collections), rien ne change.
              showAddedDate && !jukebox
                ? 'hover:border-slate-300 hover:shadow-[0_0_15px_rgba(203,213,225,0.25)]'
                : ''
            }`}
      }${onClick ? 'cursor-pointer' : ''} ${jukebox ? 'aspect-[5/7]' : ''}`}
      onClick={
        onClick
          ? (e) => {
              if (e.target.closest('a,button,input,select,textarea')) return
              onClick(vinyl)
            }
          : undefined
      }
    >
      {/* Jaquette : même intégration que les couvertures de Bandes Dessinées —
          fond sombre harmonisé (dégradé night) derrière la pochette affichée
          INTÉGRALE en object-contain, centrée avec des marges intérieures
          propres ; jamais rognée ni étirée sur toute la largeur de la tuile. */}
      <div
        className={`relative overflow-hidden bg-gradient-to-br from-night-800 to-night-900 ${coverAspect('vinyl', size)}`}
      >
        {src ? (
          <img
            src={src}
            alt={t('collection.coverAltVinyl', { title: vinyl.title, artist: vinyl.artist })}
            loading="lazy"
            className={`h-full w-full ${coverFit('vinyl')} select-none transition duration-500 group-hover:scale-[1.04]`}
            onError={(e) => {
              e.currentTarget.style.visibility = 'hidden'
            }}
          />
        ) : (
          <FallbackCover artist={vinyl.artist} />
        )}

        {/* Chips haut de jaquette : année de sortie + collection. Le badge
            d'année n'est PAS affiché sur le Dashboard (`showAddedDate`) — il
            a été retiré ; seules les collections montrent l'année
            haut-gauche. */}
        {topLeft || vinyl.owner ? (
          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2.5">
            {topLeft ? (
              <span
                className={`badge border border-night-600 bg-night-950/70 backdrop-blur text-slate-200`}
              >
                {topLeft}
              </span>
            ) : (
              <span />
            )}
            {vinyl.owner && (
              <span className="badge border border-gold-500/30 bg-gold-500/15 text-gold-300 backdrop-blur">
                {t('collection.collectionOf', { name: vinyl.owner.lastName })}
              </span>
            )}
          </div>
        ) : null}

        {/* Format carte à jouer : titre en bandeau bas sur la jaquette */}
        {jukebox && showTitle && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-night-950/95 via-night-950/60 to-transparent px-3 pb-3 pt-10">
            <h3 className={`font-extrabold text-white leading-tight line-clamp-1`} title={vinyl.title}>
              {vinyl.title}
            </h3>
            {vinyl.artist && (
              <p className={`truncate text-slate-400 ${s.subtitle}`}>{vinyl.artist}</p>
            )}
            {/* « Date de sortie » visible aussi en mode carte à jouer
                (dashboard) : le badge d'année haut-gauche ayant été retiré,
                elle est la seule information de date sur la vignette. */}
            {showAddedDate && bottomLabel && (
              <p className="mt-1 truncate text-[10px] font-medium text-gold-300/80">{t('collection.releasedOn', { date: bottomLabel })}</p>
            )}
          </div>
        )}
      </div>

      {/* Corps de la carte (masqué si carte à jouer : tout est sur la jaquette) */}
      {!jukebox && (
        <div className={`flex flex-1 flex-col ${s.body}`}>
          {showTitle && (
            <>
              <h3
                className={`font-bold text-white leading-snug ${s.title}`}
                title={vinyl.title}
              >
                {vinyl.title}
              </h3>
              {vinyl.artist && (
                <p className={`text-slate-400 ${s.subtitle}`} title={vinyl.artist}>
                  {vinyl.artist}
                </p>
              )}
            </>
          )}

          {(vinyl.genre || vinyl.label) && (
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              {vinyl.genre && <Tag className={s.badge}>{vinyl.genre}</Tag>}
              {vinyl.label && size === 'md' && <Tag muted className={s.badge}>{vinyl.label}</Tag>}
            </div>
          )}

          {size === 'md' && vinyl.trackCount > 0 && (
            // « N titre(s) » traduit (clé plurielle existante) + suffixe brut
            // « · n° {code-barres} » tel quel (comportement d'origine gardé).
            <p className="mt-1 text-xs text-slate-500">
              {t('collection.tracksBadge', { count: vinyl.trackCount })}
              {vinyl.barcode ? ` · n° ${vinyl.barcode}` : ''}
            </p>
          )}

          {/* « Date de sortie » en bas de carte (dashboard), sous le badge de
              genre : seul repère de date de la vignette, le badge d'année
              haut-gauche ayant été retiré sur le Dashboard. */}
          {showAddedDate && bottomLabel && !actions && (
            <p className="mt-auto pt-1 text-[11px] font-medium text-slate-400" title={bottomLabel}>
              {t('collection.releasedOn', { date: bottomLabel })}
            </p>
          )}

          {actions && <div className="mt-3 border-t border-night-600/50 pt-3">{actions}</div>}
        </div>
      )}
    </article>
  )
}

export default memo(VinylCard)

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

export function FallbackCover({ artist }) {
  const initial = (artist || '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <div className="grid h-full w-full place-items-center bg-gradient-to-br from-night-800 to-night-900">
      <div className="relative grid h-20 w-20 place-items-center rounded-full border-4 border-night-600 bg-night-700 sm:h-24 sm:w-24">
        <div className="absolute inset-3 rounded-full border border-night-500/60" />
        <div className="absolute inset-6 rounded-full border border-night-500/40" />
        <span className="text-3xl font-extrabold text-gold-400">{initial}</span>
      </div>
    </div>
  )
}

export function EmptyState({ title, subtitle, action = null }) {
  return (
    <div className="card col-span-full p-10 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full border border-night-600 bg-night-800 text-2xl">
        💿
      </div>
      <h3 className="text-lg font-bold text-white">{title}</h3>
      {subtitle && <p className="mx-auto mt-1 max-w-md text-sm text-slate-400">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
