/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'
import VinylCard, { EmptyState } from '../components/VinylCard.jsx'
import GroupCard from '../components/GroupCard.jsx'
import ItemDetailModal from '../components/ItemDetailModal.jsx'
import ItemList from '../components/ItemList.jsx'
import GroupedItemList from '../components/GroupedItemList.jsx'
import ViewToolbar from '../components/ViewToolbar.jsx'
import CollectionSearch from '../components/CollectionSearch.jsx'
import CollectionCounter from '../components/CollectionCounter.jsx'
import AlphabetFilterBar, { letterOf } from '../components/AlphabetFilterBar.jsx'
import { groupVinylsByArtist, NO_ARTIST_LABEL } from '../components/collection.js'
import { useDisplay, DisplayProvider, DISPLAY_SCOPES } from '../services/display.jsx'
import { PencilIcon, TrashIcon } from '../components/icons.jsx'

/**
 * Collection de disques en vue hiérarchique :
 *  Niveau 1 : une tuile par artiste (première jaquette du groupe en visuel)
 *  Niveau 2 : au clic sur un artiste, la liste de ses disques
 *            (tuiles individuelles, actions Modifier / Supprimer).
 * Quand une recherche est en cours, la liste reste à plat (résultat de la recherche).
 */
export default function Collection() {
  /* Scope d'affichage DÉDIÉ disques (clé « geek0thek_display_disks ») : le mode
     grille/liste et les options de cette page sont totalement INDÉPENDANTS de
     ceux de « Mes BD » — chaque collection s'isole dans son propre
     <DisplayProvider> persisté sous sa propre clé localStorage. */
  return (
    <DisplayProvider scope={DISPLAY_SCOPES.disks}>
      <CollectionView />
    </DisplayProvider>
  )
}

function CollectionView() {
  const location = useLocation()
  const navigate = useNavigate()
  const { settings } = useDisplay()
  const { t } = useTranslation()
  // Sous-état de VUE restauré depuis location.state au remontage (retour d'un
  // formulaire après enregistrement/annulation) : openGroup (artiste ouvert),
  // letter (filtre alphabétique), q (recherche). Vide à l'ouverture normale.
  const [vinyls, setVinyls] = useState([])
  const [q, setQ] = useState(() => location.state?.q || '')
  const [loadError, setLoadError] = useState('')
  const [detailVinyl, setDetailVinyl] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  // Toast structural { key, params } → `t(key, params)` traduit en langue
  // courante. Sources : `location.state` émise par AddVinyl ({ toastKey,
  // title }) et la suppression locale de cette page (common.retiredVinyl).
  const [toast, setToast] = useState(null)
  // Clé du groupe (artiste) ouvert au niveau 2, null pour la vue principale (niveau 1)
  const [openGroup, setOpenGroup] = useState(() => location.state?.openGroup || null)
  // Lettre active du filtre alphabétique (#, A–Z), null = aucun filtre.
  const [letter, setLetter] = useState(() => location.state?.letter || null)

  useEffect(() => {
    if (location.state?.toastKey) {
      setToast({ key: location.state.toastKey, params: location.state.title ? { title: location.state.title } : null })
      const timer = setTimeout(() => setToast(null), 4000)
      return () => clearTimeout(timer)
    }
  }, [location.state])

  const load = useCallback(async () => {
    setLoadError('')
    try {
      const { vinyls: data } = await api.vinyls.mine(q)
      setVinyls(data)
    } catch (err) {
      setLoadError(err.message)
    }
  }, [q])

  useEffect(() => {
    const t = setTimeout(() => load(), 200)
    return () => clearTimeout(t)
  }, [load])

  // Groupe courant (niveau 2) ; s'il n'existe plus (ex. après suppression), retour niveau 1.
  const groups = useMemo(() => groupVinylsByArtist(vinyls), [vinyls])
  const currentGroup = openGroup ? groups.find((g) => g.key === openGroup) : null
  useEffect(() => {
    if (openGroup && !groups.some((g) => g.key === openGroup)) setOpenGroup(null)
  }, [groups, openGroup])

  // Filtre alphabétique (#, A–Z) : groupes dont la lettre du nom correspond à
  // `letter` — accents normalisés (« Étrangers » → E, « À la page » → A).
  // null = tous les groupes.
  const filteredGroups = useMemo(
    () => (letter ? groups.filter((g) => letterOf(g.name) === letter) : groups),
    [groups, letter]
  )

  const remove = async (vinyl) => {
    try {
      await api.vinyls.remove(vinyl.id)
      setConfirmDelete(null)
      setToast({ key: 'common.retiredVinyl', params: { title: vinyl.title } })
      setTimeout(() => setToast(null), 3500)
      load()
    } catch (err) {
      alert(err.message)
    }
  }

  // Sous-état de VUE courant (artiste ouvert / filtre lettre / recherche) :
  // transmis au formulaire via location.state.from pour un retour PRÉCIS à la
  // même vue après enregistrement ou annulation. Porté par une REF (toujours à
  // jour) afin que les callbacks STABILISÉS (onAction, cf. memo des lignes)
  // lisent la vue du moment au clic sans dépendre de q/openGroup/letter —
  // sinon leur identité changerait à chaque frappe et invaliderait le memo.
  const viewRef = useRef({ openGroup, letter, q })
  viewRef.current = { openGroup, letter, q }

  /** Pré-remplit le formulaire de création avec l'artiste du groupe. */
  const addForGroup = (group) => {
    const artist = group.name === NO_ARTIST_LABEL ? '' : group.name
    navigate(`/vinyles/nouveau?prefill=1&artist=${encodeURIComponent(artist)}`, { state: { from: { path: '/collection', view: viewRef.current } } })
  }

  // ------- Vue pilotée par les préférences d'affichage (grille / liste) -------
  const isList = settings.view === 'list'
  const cardView = settings.jukebox ? 'jukebox' : 'card'
  // ⚙ OPTIMISATION LISTE/GRILLE : ces props sont STABILISÉES (useMemo /
  // useCallback) pour que le React.memo des lignes (Row de ItemList) et des
  // cartes (VinylCard) fonctionne — sans cela, un littéral recréé à chaque
  // rendu invaliderait le memo de TOUTES les lignes à chaque re-rendu.
  const listActions = useMemo(
    () => [
      { value: 'edit', label: t('common.edit'), icon: <PencilIcon size={15} /> },
      { value: 'remove', label: t('common.delete'), icon: <TrashIcon size={15} />, danger: true },
    ],
    [t]
  )
  const onAction = useCallback(
    (value, v) => (value === 'edit' ? navigate(`/vinyles/${v.id}`, { state: { from: { path: '/collection', view: viewRef.current } } }) : setConfirmDelete(v)),
    [navigate]
  )
  const openDetail = useCallback((v) => setDetailVinyl(v), [])
  const cardProps = useMemo(
    () => ({
      view: cardView,
      showTitle: settings.showTitle,
      showYear: settings.showYear,
    }),
    [cardView, settings.showTitle, settings.showYear]
  )
  const gridCls = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
  // Nom AFFICHÉ du groupe niveau 2 : « Divers » si non étiqueté, sinon son nom.
  const currentGroupName = currentGroup
    ? (currentGroup.isUnlabeled ? t('collection.groupNoArtist') : currentGroup.name)
    : ''

  // Modale de suppression : fragments traduits (titre isolé dans parts[1] pour
  // être rendu en `<span>` en gras) ; le 4ᵉ fragment (« jaquette locale… »)
  // n'apparaît que si la cover est une image LOCALE (/uploads/…).
  const vinylDeleteParts = confirmDelete
    ? t('collection.deleteVinylBodyParts', {
        title: confirmDelete.title,
        artist: confirmDelete.artist,
        returnObjects: true,
      }) || []
    : []
  const vinylDeleteHasLocalCover = confirmDelete
    ? String(confirmDelete.coverUrl || '').startsWith('/uploads/')
    : false
  const gridActions = (v) => (
    <div className="flex gap-2">
      <button type="button" className="btn-ghost flex-1 !py-1.5" onClick={() => navigate(`/vinyles/${v.id}`, { state: { from: { path: '/collection', view: viewRef.current } } })}>{t('common.edit')}</button>
      <button
        className="btn-danger !py-1.5"
        onClick={() => setConfirmDelete(v)}
        disabled={confirmDelete?.id === v.id}
      >
        {t('common.delete')}
      </button>
    </div>
  )

  return (
    // `lib-coll` : ancre CSS du thème « Médiathèque » (src/themes/library.css,
    // bloc « PAGES DE COLLECTIONS ») — harmonise grilles / listes / boutons
    // d'action de cette page à la charte chaude. Inerte sous les autres thèmes.
    <div className="lib-coll max-w-7xl mx-auto px-4 py-8 space-y-6">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          {/* Nomenclature officielle (i18n navbar.myVinyls) : « Mes Disques ». */}
           {/* cb-page-title : lettrage « case de BD » sous le thème Comic Books
               (Bangers blanc + liseré noir, cf. themes/comic-books.css). */}
           <h1 className="cb-page-title text-2xl md:text-3xl font-extrabold text-white">{t('navbar.myVinyls')}</h1>
        </div>
        {/* Barre d'actions : UNE seule ligne (recherche → vue → ajout), hauteurs
            uniformes (h-12). La recherche absorbe le sur-largeur (flex-1) au lieu
            de forcer le bouton à passer sous la toolbar. Layout strictement aligné sur la page BD. */}
        {/* cb-actions : barre d'actions — le thème Comic Books y flashe le bouton
            « Ajouter » en jaune « splash » (thèmes/comic-books.css). */}
        <div className="cb-actions flex flex-wrap items-center gap-3">
          {/* Compteur de collection « X artistes — Y disques » : à GAUCHE de la
              barre de recherche (gras + ombrage noir ; jaune liseré d'encre sous
              le thème Comic Books — cf. CollectionCounter / index.css). */}
          <CollectionCounter type="disks" groups={filteredGroups.length} items={vinyls.length} />
          <CollectionSearch value={q} onChange={(e) => setQ(e.target.value)} />
          <ViewToolbar />
          <button type="button" className="btn-primary !h-12" onClick={() => navigate('/vinyles/nouveau', { state: { from: { path: '/collection', view: viewRef.current } } })}>{t('dashboard.addVinyl')}</button>
        </div>
      </header>

      {/* Barre de filtre alphabétique (#, A–Z) : intégrée directement sous le
          bloc recherche / sélection Grille-Liste. Visible UNIQUEMENT sur la vue
          racine « Tous les artistes » — masquée dès qu'une recherche est en
          cours ou qu'un artiste est ouvert (niveau 2). */}
      {!q && !currentGroup && (
        <AlphabetFilterBar labels={groups.map((g) => g.name)} value={letter} onChange={setLetter} />
      )}

      {toast && (
        <p className="text-sm text-amber-800 bg-amber-100 border border-amber-500/30 rounded-lg px-3 py-2">
          {t(toast.key, toast.params ?? {})}
        </p>
      )}

      {loadError ? (
        <p className="text-sm text-rose-600">{loadError}</p>
      ) : vinyls.length === 0 ? (
        <div className="grid grid-cols-1 gap-4">
          <EmptyState
            title={q ? t('collection.noResults') : t('collection.emptyVinylTitle')}
            subtitle={q
              ? t('collection.noVinylMatch', { q })
              : t('collection.emptyVinylSubtitle')}
            action={
              q ? (
                <button className="btn-ghost" onClick={() => setQ('')}>{t('collection.resetSearch')}</button>
              ) : (
                <button type="button" className="btn-primary" onClick={() => navigate('/vinyles/nouveau', { state: { from: { path: '/collection', view: viewRef.current } } })}>{t('dashboard.addVinyl')}</button>
              )
            }
          />
        </div>
      ) : q ? (
        // ------- Recherche en cours : liste à plat de tous les résultats -------
        isList ? (
          <ItemList
            type="vinyl"
            items={vinyls}
            actions={listActions}
            onAction={onAction}
            onDetail={openDetail}
            showTitle={settings.showTitle}
            showYear={settings.showYear}
            showBadges={settings.showBadges}
          />
        ) : (
          <div className={gridCls}>
            {vinyls.map((v) => (
              <VinylCard
                key={v.id}
                vinyl={v}
                onClick={() => setDetailVinyl(v)}
                actions={gridActions(v)}
                {...cardProps}
              />
            ))}
          </div>
        )
      ) : currentGroup ? (
        // ------- Niveau 2 : disques de l'artiste ouvert -------
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button className="btn-ghost" onClick={() => setOpenGroup(null)}>{t('collection.allArtists')}</button>
              <div>
                {/* Nom du groupe (« Divers » si non étiqueté) + compteur disques.
                    cb-group-title : lettrage « case de BD » sous le thème Comic Books. */}
                <h2 className="cb-group-title text-xl font-extrabold text-white" title={currentGroupName}>
                  {currentGroupName}
                </h2>
                <p className="text-sm text-slate-400">
                  {t('collection.vinylsCount', { count: currentGroup.items.length })}
                  {currentGroup.items[0]?.label ? ` — ${currentGroup.items[0].label}` : ''}
                </p>
              </div>
            </div>
            <button className="btn-ghost" onClick={() => addForGroup(currentGroup)}>
              {t('collection.addForArtist')}
            </button>
          </div>

          {currentGroup.items.length === 0 ? (
            <div className="grid grid-cols-1 gap-4">
              <EmptyState
                title={t('collection.emptyArtistTitle')}
                subtitle={t('collection.emptyArtistSubtitle', { name: currentGroupName })}
                action={
                  <button className="btn-primary" onClick={() => addForGroup(currentGroup)}>
                    {t('dashboard.addVinyl')}
                  </button>
                }
              />
            </div>
          ) : isList ? (
            <ItemList
              type="vinyl"
              items={currentGroup.items}
              actions={listActions}
              onAction={onAction}
              onDetail={openDetail}
              showTitle={settings.showTitle}
              showYear={settings.showYear}
              showBadges={settings.showBadges}
            />
          ) : (
            <div className={gridCls}>
              {currentGroup.items.map((v) => (
                <VinylCard
                  key={v.id}
                  vinyl={v}
                  onClick={() => setDetailVinyl(v)}
                  actions={gridActions(v)}
                  {...cardProps}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        // ------- Niveau 1 : accordéons par artiste (vue liste) /
        //            tuiles par artiste (vue grille) -------
        filteredGroups.length === 0 ? (
          <div className="grid grid-cols-1 gap-4">
            <EmptyState
              title={t('collection.noResults')}
              subtitle={t('collection.noLetterMatch', { letter })}
              action={<button className="btn-ghost" onClick={() => setLetter(null)}>{t('collection.resetFilter')}</button>}
            />
          </div>
        ) : isList ? (
          <GroupedItemList
            type="vinyl"
            groups={filteredGroups}
            actions={listActions}
            onAction={onAction}
            onDetail={openDetail}
            showTitle={settings.showTitle}
            showYear={settings.showYear}
            showBadges={settings.showBadges}
          />
        ) : (
          <div className={gridCls}>
            {filteredGroups.map((g) => (
              <GroupCard
                key={g.key}
                name={g.name}
                count={g.items.length}
                coverUrl={g.coverUrl}
                // Photo / logo d'ARTISTE (gérée par le backend : récupération
                // automatique MusicBrainz / Cover Art Archive ou téléversement
                // manuel, repli propre img/no_group.jpg) — image utilisée UNIQUEMENT
                // sur la tuile du groupe de cette grille « Mes Disques ».
                artistImage={g.artistImage}
                variant="vinyl"
                view={cardView}
                showTitle={settings.showTitle}
                isUnlabeled={g.isUnlabeled}
                onClick={() => setOpenGroup(g.key)}
              />
            ))}
          </div>
        ))}

      <ItemDetailModal
        type="vinyl"
        item={detailVinyl}
        onClose={() => setDetailVinyl(null)}
        onEdit={(v) => { setDetailVinyl(null); navigate(`/vinyles/${v.id}`, { state: { from: { path: '/collection', view: viewRef.current } } }) }}
      />

      {confirmDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-slate-900/40 backdrop-blur-sm">
          {/* role=dialog + aria-modal : semantic modal + hook du liseré tricolore
              du thème Comic Books ([data-theme='comic-books'] .card[role=dialog]). */}
          <div role="dialog" aria-modal="true" className="card w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-white text-center">{t('collection.deleteVinylTitle')}</h2>
            <p className="mt-2 text-sm text-slate-400">
              {vinylDeleteParts[0]}<span className="font-semibold text-white">{vinylDeleteParts[1]}</span>{vinylDeleteParts[2] || ''}{vinylDeleteHasLocalCover ? (vinylDeleteParts[3] || '') : ''}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
              <button className="btn-danger" disabled={confirmDelete.deleting} onClick={() => remove(confirmDelete)}>
                {t('common.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
