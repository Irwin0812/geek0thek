/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useCallback, useEffect, useState, memo } from 'react'
import { useTranslation } from 'react-i18next'
import ItemList from './ItemList.jsx'
import { resolveGroupImage } from './collection.js'
import { toDisplayImageUrl } from '../services/imageUrl.js'

/**
 * Vue « Liste » hiérarchique en accordéons — regroupe les éléments par
 * Artiste / Groupe (disques) ou par Série (BD), au lieu d'une liste à plat.
 *
 * `type`   : 'vinyl' | 'comic'
 * `groups` : groupes déjà calculés et triés (groupVinylsByArtist /
 *            groupComicsBySeries) — { key, name, items, coverUrl,
 *            artistImage, seriesImage }
 * Chaque ligne principale est un accordéon CLIQUABLE (image du groupe + nom
 * + compteur + chevron) : par défaut les éléments sont MASQUÉS, un clic
 * déroule la liste détaillée des albums / tomes (mêmes boutons d'actions —
 * validation, favoris, ⋯ — que le reste de la vue liste : on réutilise
 * <ItemList>, donc comportement strictement identique).
 * `actions` / `onAction` / `onDetail` / `show*` sont transférés aux sous-listes.
 */
export default function GroupedItemList({
  type,
  groups,
  actions = [],
  onAction,
  onDetail,
  showTitle = true,
  showYear = true,
  showBadges = true,
}) {
  /* Clés des accordéons ouverts — par défaut tout est replié. Plusieurs
     groupes peuvent être ouverts en même temps (menu déroulant multipliable). */
  const [openSet, setOpenSet] = useState(() => new Set())

  /* useCallback : le callback de toggle est STABLE entre rendus — indispensable
     pour que le memo des GroupRow fonctionne (une fermeture `() => toggle(g.key)`
     recréée à chaque rendu invaliderait le memo de TOUS les groupes). */
  const toggle = useCallback((key) => {
    setOpenSet((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  if (!groups || groups.length === 0) return null
  return (
    <ul className="space-y-2">
      {groups.map((g) => (
        <GroupRow
          key={g.key}
          type={type}
          group={g}
          open={openSet.has(g.key)}
          onToggle={toggle}
          actions={actions}
          onAction={onAction}
          onDetail={onDetail}
          showTitle={showTitle}
          showYear={showYear}
          showBadges={showBadges}
        />
      ))}
    </ul>
  )
}

/** Ligne principale : tête d'accordéon (image + nom + compteur) + panneau
    déroulant contenant la sous-liste détaillée des éléments du groupe.
    memo : un groupe ne se re-rend que si SON état (open / group / props)
    change — l'ouverture d'un autre accordéon ne redessine plus tous les
    groupes de la liste. */
const GroupRow = memo(function GroupRow({ type, group, open, onToggle, actions, onAction, onDetail, showTitle, showYear, showBadges }) {
  /* Montée en z-10 de l'accordéon actif quand le menu ⋯ d'une sous-ligne est
     ouvert (remontée via ItemList → Row → ActionsMenu) : le panneau absolu
     (z-50) se peint alors au-dessus des groupes suivants. */
  const [elevated, setElevated] = useState(false)
  /* Repli de l'accordéon en cours d'ouverture d'un menu ⋯ : on réinitialise. */
  useEffect(() => {
    if (!open) setElevated(false)
  }, [open])

  const { t } = useTranslation()
  const isVinyl = type === 'vinyl'
  // « Hors série » / « Divers » : affichage traduit via `isUnlabeled` (le nom
  // interne reste inchangé pour la logique de regroupement).
  const displayName = group.isUnlabeled ? t(isVinyl ? 'collection.groupNoArtist' : 'collection.groupNoSeries') : group.name
  const count = group.items.length

  /* Image de SÉRIE (BD) ou d'ARTISTE (disques). RÈGLE STRICTE : l'image de la
     ligne est EXCLUSIVEMENT son image DÉDIÉE — `seriesImage` (BD) ou
     `artistImage` (disques). Si cette valeur est vide, null, non définie ou
     porte le repli propre no_*.jpg exposé par le backend (préfixe d'origine
     mis à part — traité partout comme une « absence »), la source pointe
     IMPÉRATIVEMENT vers l'image de secours LOCALE correspondante :
     img/no_group.jpg pour les Artistes / img/no_title.jpg pour les Séries.
     Elle ne retomme JAMAIS sur la première jaquette / couverture du groupe
     (`group.coverUrl`) — dissociation totale, même règle que la tuile de
     grille GroupCard (même helper partagé resolveGroupImage). Le monogramme
     d'initiale reste en garde ultime (jamais de bloc d'image cassé) mais plus
     jamais au lieu de l'emblème local. */
  const imageSrc = resolveGroupImage(
    type === 'vinyl' ? 'artist' : 'series',
    type === 'vinyl' ? group.artistImage : group.seriesImage
  )
  // Monogramme d'initiale — garde ultime si l'image de secours locale manque
  // (onError -> <img> masqué).
  const initial = (displayName || '?').trim().charAt(0).toUpperCase() || '?'

  return (
    <li className="relative">
      {/* Tête d'accordéon — même langage visuel qu'une ligne ItemList, mais
          le clic déplie / replie au lieu d'ouvrir la fiche. */}
      <article
        className={`card flex items-center gap-3 px-3 py-2 transition ${
          open ? 'border-gold-500/40 bg-night-700/30' : ''
        } ${elevated ? 'relative z-10' : ''}`}
      >
        <button
          type="button"
          onClick={() => onToggle(group.key)}
          aria-expanded={open}
          title={open ? t('collection.collapse') : t('collection.expandItems')}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {/* Image du groupe (logo d'artiste / image de série) */}
          <div
            className={`shrink-0 overflow-hidden rounded-md border border-night-600 bg-night-900 ${
              type === 'vinyl' ? 'h-11 w-11' : 'h-14 w-[38px]'
            }`}
          >
            {imageSrc ? (
              <img
                src={toDisplayImageUrl(imageSrc)}
                alt=""
                loading="lazy"
                className="h-full w-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.visibility = 'hidden'
                }}
              />
            ) : (
              <div className="grid h-full w-full place-items-center text-sm font-bold text-gold-400">{initial}</div>
            )}
          </div>

          {/* Nom du groupe + compteur d'albums / de tomes */}
          <span className="min-w-0 flex-1 truncate font-semibold text-slate-100" title={displayName}>
            {displayName}
          </span>
          <span
            className="shrink-0 rounded border border-night-500/60 bg-night-700/80 px-1.5 py-0.5 text-[11px] font-medium text-slate-300"
            title={t(isVinyl ? 'collection.albumsCount' : 'collection.tomesCount', { count })}
          >
            {t(isVinyl ? 'collection.albumsCount' : 'collection.tomesCount', { count })}
          </span>

          {/* Chevron — même motif (▾ en transition) que les menus de la Navbar */}
          <ChevronIcon open={open} />
        </button>
      </article>

      {/* Panneau déroulant : sous-liste détaillée (couvertures + actions).
          `relative` + bord gauche doré : le contenu est clairement associé à
          son accordéon ; ItemList reçoit l'indicateur de z-index du menu ⋯. */}
      {open && (
        <div className="animate-fadein relative ml-2 space-y-1 border-l-2 border-gold-500/40 py-2 pl-3 sm:ml-3 sm:pl-4">
          <ItemList
            type={type}
            items={group.items}
            actions={actions}
            onAction={onAction}
            onDetail={onDetail}
            onElevate={setElevated}
            showTitle={showTitle}
            showYear={showYear}
            showBadges={showBadges}
          />
        </div>
      )}
    </li>
  )
})

function ChevronIcon({ open }) {
  return (
    <span
      aria-hidden="true"
      className={`shrink-0 text-base leading-none text-slate-400 transition-transform duration-200 ${
        open ? 'rotate-180' : ''
      }`}
    >
      ▾
    </span>
  )
}
