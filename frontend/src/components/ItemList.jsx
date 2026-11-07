import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDismiss } from './hooks.js'
import {
  releaseYear,
  hasSubtitles,
  isVerified,
  itemBadges,
  resolveImageUrl,
} from './listData.js'
import { CheckIcon, CCIcon, HeartIcon, MoreIcon } from './icons.jsx'

/**
 * Ligne compacte de la vue en liste :
 *  [ miniature ] [ titre · année · sous-titre ] [ badges … ] [ ✓ ♥ CC ⋯ ]
 *
 * `type`  : 'vinyl' | 'comic'
 * `items` : DTO backend (vinyl ou comic)
 * `actions`: [{ value, label, icon?, danger? }] → contenu du menu ⋯
 * `onAction` : (value, item) — ex. 'edit' / 'remove'
 * `onDetail` : (item) — clic sur la ligne (modale de détail)
 * `showTitle` / `showYear` / `showBadges` : pilotés par les options de la grille
 * `onElevate` : (z) — notifie le parent quand une ligne active son menu ⋯
 *   (la liste monte sa carte en z-10 ; un conteneur parent ex. l'accordéon
 *   GroupedItemList remonte aussi à son tour pour rester au-dessus des cartes
 *   des blocs suivants)
 */
export default function ItemList({
  type,
  items,
  actions = [],
  onAction,
  onDetail,
  showTitle = true,
  showYear = true,
  showBadges = true,
  onElevate,
}) {
  if (!items || items.length === 0) return null
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <Row
          key={item.id}
          type={type}
          item={item}
          actions={actions}
          onAction={onAction}
          onDetail={onDetail}
          showTitle={showTitle}
          showYear={showYear}
          showBadges={showBadges}
          onElevate={onElevate}
        />
      ))}
    </ul>
  )
}

/* memo : une ligne ne se re-rend que si SON item / ses props changent —
   le scroll / la recherche / l'ouverture d'un menu ⋯ ailleurs dans la liste
   ne redessinent plus TOUTES les lignes (grille de plusieurs dizaines de
   couvertures). */
const Row = memo(function Row({ type, item, actions, onAction, onDetail, showTitle, showYear, showBadges, onElevate }) {
  const [fav, setFav] = useState(false)
  /* État du menu ⋯ remonté dans la LIGNE : à l'ouverture la carte passe en
     z-10 (voir className de <article>) pour que le panneau absolu s'affiche
     au-dessus des cartes des lignes suivantes. */
  const [menuOpen, setMenuOpen] = useState(false)
  const { t } = useTranslation()
  const verified = isVerified(type, item)
  const subtitles = hasSubtitles(type, item)
  const year = releaseYear(item)
  const badges = itemBadges(type, item, t)
  const src = resolveImageUrl(type, item.coverUrl)
  const title = item.title
  const subtitle = type === 'vinyl' ? item.artist : item.authors
  const initial = (title || '?').trim().charAt(0).toUpperCase() || '?'

  const stop = (fn) => (e) => {
    e.stopPropagation()
    fn()
  }

  return (
    /* relative : point d'ancrage éventuellement utilisé par les éléments de la
       ligne (le panneau du menu ⋯, z-50, étant un frère absolu du bouton). */
    <li className="relative">
      <article
        /* z-10 à l'ouverture du menu ⋯ : la carte de la ligne active passe au-dessus
           des cartes des lignes suivantes (le panneau reste absolu z-50, son contexte
           de superposition étant alors le plus haut de la vue — jamais plus bas). */
        className={`group/item card flex items-center gap-3 px-3 py-2 cursor-pointer transition
          hover:border-gold-500/40 hover:bg-night-700/40 ${menuOpen ? 'relative z-10' : ''}`}
        onClick={() => onDetail?.(item)}
        aria-label={showTitle ? t('collection.viewSheet', { title }) : undefined}
      >
        {/* Miniature */}
        <div
          className={`shrink-0 overflow-hidden rounded-md border border-night-600 bg-night-900 ${
            type === 'vinyl' ? 'h-11 w-11' : 'h-14 w-[38px]'
          }`}
        >
          {src ? (
            <img
              src={src}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
              onError={(e) => {
                e.currentTarget.style.visibility = 'hidden'
              }}
            />
          ) : (
            <div
              className={`grid h-full w-full place-items-center font-bold text-gold-400 ${
                type === 'comic' ? 'text-[11px]' : 'text-sm'
              }`}
            >
              {initial}
            </div>
          )}
        </div>

        {/* Titre (+ année, sous-titre) */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {showTitle && (
            <span className="truncate font-semibold text-slate-100" title={title}>
              {title}
            </span>
          )}
          {showYear && year && (
            <span
              className="shrink-0 rounded border border-night-500/60 bg-night-700/80 px-1.5 py-0.5 text-[11px] font-medium text-slate-300"
              title={String(item.releaseDate)}
            >
              {year}
            </span>
          )}
          {subtitle && (
            <span className="hidden truncate text-xs text-slate-500 md:inline" title={subtitle}>
              {subtitle}
            </span>
          )}
          {showTitle && <StarIcon title={t('collection.rateSoon')} />}
        </div>

        {/* Badges d'information (alignés à droite) */}
        {showBadges && (
          <div className="hidden max-w-[45%] flex-wrap items-center justify-end gap-1.5 sm:flex">
            {badges.map((b) => (
              <Badge key={b.label} badge={b} />
            ))}
          </div>
        )}

        {/* Actions rapides : conteneur Flexbox avec espacement (gap-3) — le cœur
            (favoris) et le bouton « … » sont clairement distincts, jamais
            superposés. Le panneau du menu ⋯ est absolu (z-50) en frère du bouton. */}
        <div className="flex shrink-0 items-center gap-3 pr-1">
          {verified && (
            <button
              className="icon-btn"
              title={t('collection.verifiedHint')}
              onClick={stop(() => onDetail?.(item))}
            >
              <CheckIcon size={15} className="text-gold-400" />
            </button>
          )}
          {subtitles && (
            <span className="icon-btn" title={t('collection.subtitlesHint')}>
              <CCIcon size={15} className="text-slate-400" />
            </span>
          )}
          <button
            className="icon-btn"
            title={fav ? t('collection.removeFavorite') : t('collection.addFavorite')}
            onClick={stop(() => setFav((v) => !v))}
          >
            <HeartIcon size={15} filled={fav} className={fav ? 'text-rose-400' : 'text-slate-400'} />
          </button>

          {/* Bouton « … » dans le flux, séparé du cœur par gap-3 : en l'ouvrant,
              la ligne passe en z-10 et le panneau absolu s'affiche au-dessus
              des cartes suivantes. */}
          {actions.length > 0 && (
            <ActionsMenu
              actions={actions}
              onAction={(v) => onAction?.(v, item)}
              /* Montée en z-10 de la ligne + remontée au parent (accordéon). */
              onOpenChange={(z) => {
                setMenuOpen(z)
                onElevate?.(z)
              }}
            />
          )}
        </div>
      </article>
    </li>
  )
})

/** Étoile de note (réservée — les notes n'existent pas encore en données). */
function StarIcon({ title }) {
  return (
    <span
      className="hidden shrink-0 text-slate-600 lg:inline"
      title={title}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9z" />
      </svg>
    </span>
  )
}

function Badge({ badge }) {
  const tone =
    badge.tone === 'gold'
      ? 'bg-gold-500/10 text-gold-300 border-gold-500/20'
      : badge.tone === 'check'
        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
        : 'bg-night-700/80 text-slate-400 border-night-500/50'
  return (
    <span className={`badge shrink-0 border ${tone}`}>{badge.label}</span>
  )
}

/** Menu contextuel ⋯ (Modifier / Supprimer selon la page).
 *  Le bouton vit dans le flux de la ligne (à côté du cœur, séparé par gap-3) ;
 *  seul le PANNEAU est absolu (z-50), en frère absolu du bouton : il échappe
 *  à la carte et déborde librement vers le bas / la droite. À l'ouverture,
 *  on notifie la ligne (onOpenChange → z-index de la carte active : voir Row). */
function ActionsMenu({ actions, onAction, onOpenChange }) {
  const [open, setOpen] = useState(false)
  const { t } = useTranslation()

  /* Notifie la ligne : tant que le menu est ouvert, la carte active de la
     ligne se peint au-dessus des cartes suivantes (z-10 sur <article>, voir Row). */
  const openMenu = () => {
    setOpen(true)
    onOpenChange?.(true)
  }
  const close = () => {
    setOpen(false)
    onOpenChange?.(false)
  }
  const ref = useDismiss(open, close)

  return (
    <div className="relative flex" ref={ref}>
      <button
        className="icon-btn"
        title={t('collection.moreActions')}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          if (open) close()
          else openMenu()
        }}
      >
        <MoreIcon size={15} />
      </button>
      {open && (
        /* z-50 : au-dessus de toutes les cartes/suivantes (les panneaux d'options de
           ViewToolbar et le modal de suppression restent à la même strate 50, mais ne
           coexistent jamais avec ce menu). */
        <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-night-600 bg-night-800 p-1.5 shadow-xl shadow-black/50">
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={(e) => {
                e.stopPropagation()
                close()
                onAction(a.value)
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition ${
                a.danger ? 'text-rose-300 hover:bg-rose-500/15' : 'text-slate-200 hover:bg-night-700/70'
              }`}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
