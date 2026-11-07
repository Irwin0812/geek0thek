import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'
import ComicCard from '../components/ComicCard.jsx'
import GroupCard from '../components/GroupCard.jsx'
import { EmptyState } from '../components/VinylCard.jsx'
import ItemDetailModal from '../components/ItemDetailModal.jsx'
import ItemList from '../components/ItemList.jsx'
import GroupedItemList from '../components/GroupedItemList.jsx'
import ViewToolbar from '../components/ViewToolbar.jsx'
import CollectionSearch from '../components/CollectionSearch.jsx'
import CollectionCounter from '../components/CollectionCounter.jsx'
import AlphabetFilterBar, { letterOf } from '../components/AlphabetFilterBar.jsx'
import { groupComicsBySeries, NO_SERIES_LABEL } from '../components/collection.js'
import { useDisplay, DisplayProvider, DISPLAY_SCOPES } from '../services/display.jsx'
import { PencilIcon, TrashIcon } from '../components/icons.jsx'

/**
 * Collection BD en vue hiérarchique :
 *  Niveau 1 : une tuile par série (première couverture du groupe en visuel)
 *  Niveau 2 : au clic sur une série, la liste des albums de cette série
 *            (tuiles individuelles, actions Modifier / Supprimer).
 * Quand une recherche est en cours, la liste reste à plat (résultat de la recherche).
 */
export default function ComicCollection() {
  /* Scope d'affichage DÉDIÉ BD (clé « geek0thek_display_comics ») : le mode
     grille/liste et les options de cette page sont totalement INDÉPENDANTS de
     ceux de « Mes disques » — chaque collection s'isole dans son propre
     <DisplayProvider> persisté sous sa propre clé localStorage. */
  return (
    <DisplayProvider scope={DISPLAY_SCOPES.comics}>
      <ComicCollectionView />
    </DisplayProvider>
  )
}

function ComicCollectionView() {
  const location = useLocation()
  const navigate = useNavigate()
  const { settings } = useDisplay()
  const { t } = useTranslation()
  const [comics, setComics] = useState([])
  const [q, setQ] = useState('')
  const [loadError, setLoadError] = useState('')
  const [detailComic, setDetailComic] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  // Toast structural { key, params } → traduit en langue courante via t().
  const [toast, setToast] = useState(null)
  // Clé du groupe (série) ouvert au niveau 2, null pour la vue principale (niveau 1)
  const [openGroup, setOpenGroup] = useState(null)
  // Lettre active du filtre alphabétique (#, A–Z), null = aucun filtre.
  const [letter, setLetter] = useState(null)

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
      const { comics: data } = await api.comics.mine(q)
      setComics(data)
    } catch (err) {
      setLoadError(err.message)
    }
  }, [q])

  useEffect(() => {
    const t = setTimeout(() => load(), 200)
    return () => clearTimeout(t)
  }, [load])

  // Groupe courant (niveau 2) ; s'il n'existe plus (ex. après suppression), retour niveau 1.
  const groups = useMemo(() => groupComicsBySeries(comics), [comics])
  const currentGroup = openGroup ? groups.find((g) => g.key === openGroup) : null
  useEffect(() => {
    if (openGroup && !groups.some((g) => g.key === openGroup)) setOpenGroup(null)
  }, [groups, openGroup])

  // Filtre alphabétique (#, A–Z) : séries dont la lettre du nom correspond à
  // `letter` — accents normalisés (« Étrangers » → E, « À la page » → A).
  // null = toutes les séries.
  const filteredGroups = useMemo(
    () => (letter ? groups.filter((g) => letterOf(g.name) === letter) : groups),
    [groups, letter]
  )

  const remove = async (comic) => {
    try {
      await api.comics.remove(comic.id)
      setConfirmDelete(null)
      setToast({ key: 'common.retiredComic', params: { title: comic.title } })
      setTimeout(() => setToast(null), 3500)
      load()
    } catch (err) {
      alert(err.message)
    }
  }

  // useCallback : callback STABLE — requis pour que le memo des lignes/cartes
  // fonctionne (onAction en dépend, cf. plus bas).
  const goEdit = useCallback((comic) => {
    const params = new URLSearchParams()
    Object.entries(comic).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '' && typeof v !== 'boolean') params.set(k, String(v))
    })
    setOpenGroup(null)
    navigate(`/comics/${comic.id}?${params.toString()}`)
  }, [navigate])

  /** Pré-remplit le formulaire de création avec les infos du groupe (série, auteurs, éditeur). */
  const addForGroup = (group) => {
    const params = new URLSearchParams({ prefill: '1' })
    const first = group.items[0]
    const series = group.name === NO_SERIES_LABEL ? '' : group.name
    const set = (key, val) => {
      if (val !== null && val !== undefined && val !== '') params.set(key, val)
    }
    set('series', series)
    set('authors', first?.authors)
    set('publisher', first?.publisher)
    window.location.assign(`/comics/nouveau?${params.toString()}`)
  }

  // ------- Vue pilotée par les préférences d'affichage (grille / liste) -------
  const isList = settings.view === 'list'
  const cardView = settings.jukebox ? 'jukebox' : 'card'
  // ⚙ OPTIMISATION LISTE/GRILLE : ces props sont STABILISÉES (useMemo /
  // useCallback) pour que le React.memo des lignes (Row de ItemList) et des
  // cartes (ComicCard) fonctionne — sans cela, un littéral recréé à chaque
  // rendu invaliderait le memo de TOUTES les lignes à chaque re-rendu.
  const listActions = useMemo(
    () => [
      { value: 'edit', label: t('common.edit'), icon: <PencilIcon size={15} /> },
      { value: 'remove', label: t('common.delete'), icon: <TrashIcon size={15} />, danger: true },
    ],
    [t]
  )
  const onAction = useCallback(
    (value, c) => (value === 'edit' ? goEdit(c) : setConfirmDelete(c)),
    [goEdit]
  )
  const openDetail = useCallback((c) => setDetailComic(c), [])
  const cardProps = useMemo(
    () => ({
      view: cardView,
      showTitle: settings.showTitle,
      showYear: settings.showYear,
    }),
    [cardView, settings.showTitle, settings.showYear]
  )
  const gridCls = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
  // Nom AFFICHÉ du groupe (série) au niveau 2 : « Hors série » si non étiqueté, sinon le nom.
  const currentGroupName = currentGroup
    ? (currentGroup.isUnlabeled ? t('collection.groupNoSeries') : currentGroup.name)
    : ''

  // Modale de suppression BD : fragments traduits (titre isolé dans [1] pour
  // `<span>` en gras) ; « de {auteurs} » seulement si auteur présent, la cover
  // locale n'est mentionnée que si /uploads/.
  const comicDeleteParts = confirmDelete
    ? t('collection.deleteComicBodyParts', {
        title: confirmDelete.title,
        artists: confirmDelete.authors ? String(confirmDelete.authors) : '',
        returnObjects: true,
      }) || []
    : []
  const comicDeleteHasLocalCover = confirmDelete
    ? String(confirmDelete.coverUrl || '').startsWith('/uploads/')
    : false

  const gridActions = (c) => (
    <div className="flex gap-2">
      <button className="btn-ghost flex-1 !py-1.5" onClick={() => goEdit(c)}>{t('common.edit')}</button>
      <button
        className="btn-danger !py-1.5"
        onClick={() => setConfirmDelete(c)}
        disabled={confirmDelete?.id === c.id}
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
          {/* Nomenclature officielle (i18n navbar.myComics) : « Mes BD ». */}
          <h1 className="cb-page-title text-2xl md:text-3xl font-extrabold text-white">{t('navbar.myComics')}</h1>
        </div>
        {/* Barre d'actions : UNE seule ligne (recherche → vue → ajout), hauteurs
            uniformes (h-12). La recherche absorbe le sur-largeur (flex-1) au lieu
            de forcer le bouton à passer sous la toolbar. Layout strictement aligné sur la page Disques. */}
        {/* cb-actions : barre d'actions — le thème Comic Books y flashe le bouton
            « Ajouter » en jaune « splash » (thèmes/comic-books.css). */}
        <div className="cb-actions flex flex-wrap items-center gap-3">
          {/* Compteur de collection « X séries — Y albums » : à GAUCHE de la
              barre de recherche (gras + ombrage noir ; jaune liseré d'encre sous
              le thème Comic Books — cf. CollectionCounter / index.css). */}
          <CollectionCounter type="comics" groups={filteredGroups.length} items={comics.length} />
          <CollectionSearch value={q} onChange={(e) => setQ(e.target.value)} />
          <ViewToolbar />
          <Link to="/comics/nouveau" className="btn-primary !h-12">{t('dashboard.addComic')}</Link>
        </div>
      </header>

      {/* Barre de filtre alphabétique (#, A–Z) : intégrée directement sous le
          bloc recherche / sélection Grille-Liste. Visible UNIQUEMENT sur la vue
          racine « Toutes les séries » — masquée dès qu'une recherche est en
          cours ou qu'une série est ouverte (niveau 2). */}
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
      ) : comics.length === 0 ? (
        <div className="grid grid-cols-1 gap-4">
          <EmptyState
            title={q ? t('collection.noResults') : t('collection.emptyComicTitle')}
            subtitle={q
              ? t('collection.noComicMatch', { q })
              : t('collection.emptyComicSubtitle')}
            action={
              q ? (
                <button className="btn-ghost" onClick={() => setQ('')}>{t('collection.resetSearch')}</button>
              ) : (
                <Link to="/comics/nouveau" className="btn-primary">{t('dashboard.addComic')}</Link>
              )
            }
          />
        </div>
      ) : q ? (
        // ------- Recherche en cours : liste à plat de tous les résultats -------
        isList ? (
          <ItemList
            type="comic"
            items={comics}
            actions={listActions}
            onAction={onAction}
            onDetail={openDetail}
            showTitle={settings.showTitle}
            showYear={settings.showYear}
            showBadges={settings.showBadges}
          />
        ) : (
          <div className={gridCls}>
            {comics.map((c) => (
              <ComicCard key={c.id} comic={c} onClick={() => setDetailComic(c)} actions={gridActions(c)} {...cardProps} />
            ))}
          </div>
        )
      ) : currentGroup ? (
        // ------- Niveau 2 : albums de la série ouverte -------
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button className="btn-ghost" onClick={() => setOpenGroup(null)}>{t('collection.allSeries')}</button>
              <div>
                {/* Nom de la série (« Hors série » si non étiquetée) + compteur albums.
                    cb-group-title : lettrage « case de BD » sous le thème Comic Books. */}
                <h2 className="cb-group-title text-xl font-extrabold text-white" title={currentGroupName}>
                  {currentGroupName}
                </h2>
                <p className="text-sm text-slate-400">
                  {t('collection.albumsCount', { count: currentGroup.items.length })}
                  {currentGroup.items[0]?.authors ? ` — ${currentGroup.items[0].authors}` : ''}
                </p>
              </div>
            </div>
            {currentGroup.name !== NO_SERIES_LABEL && (
              <button className="btn-ghost" onClick={() => addForGroup(currentGroup)}>
                {t('collection.addInSeries')}
              </button>
            )}
          </div>

          {currentGroup.items.length === 0 ? (
            <div className="grid grid-cols-1 gap-4">
              <EmptyState
                title={t('collection.emptySeriesTitle')}
                subtitle={t('collection.emptySeriesSubtitle', { name: currentGroupName })}
                action={
                  <button className="btn-primary" onClick={() => addForGroup(currentGroup)}>
                    {t('collection.addAlbum')}
                  </button>
                }
              />
            </div>
          ) : isList ? (
            <ItemList
              type="comic"
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
              {currentGroup.items.map((c) => (
                <ComicCard key={c.id} comic={c} onClick={() => setDetailComic(c)} actions={gridActions(c)} {...cardProps} />
              ))}
            </div>
          )}
        </div>
      ) : (
        // ------- Niveau 1 : accordéons par série (vue liste) /
        //            tuiles par série (vue grille) -------
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
            type="comic"
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
                // Image / logo DÉDIÉ à la SÉRIE (comics.series_image — Open Library /
                // Google Books ou upload manuel « seriesImage ») : utilisé UNIQUEMENT
                // sur cette tuile de série ; les tomes individuels restent sur leur
                // couverture d'album `coverUrl`.
                seriesImage={g.seriesImage}
                view={cardView}
                showTitle={settings.showTitle}
                isUnlabeled={g.isUnlabeled}
                onClick={() => setOpenGroup(g.key)}
              />
            ))}
          </div>
        ))}

      <ItemDetailModal
        type="comic"
        item={detailComic}
        onClose={() => setDetailComic(null)}
        onEdit={(c) => { setDetailComic(null); navigate(`/comics/${c.id}`) }}
      />

      {confirmDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-slate-900/40 backdrop-blur-sm">
          {/* role=dialog + aria-modal : semantic modal + hook du liseré tricolore
              du thème Comic Books ([data-theme='comic-books'] .card[role=dialog]). */}
          <div role="dialog" aria-modal="true" className="card w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-white text-center">{t('collection.deleteComicTitle')}</h2>
            <p className="mt-2 text-sm text-slate-400">
              {comicDeleteParts[0]}<span className="font-semibold text-white">{comicDeleteParts[1]}</span>{comicDeleteParts[2] || ''}{confirmDelete.authors ? (comicDeleteParts[3] || '') : ''}{comicDeleteParts[4] || ''}{comicDeleteHasLocalCover ? (comicDeleteParts[5] || '') : ''}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
              <button
                className="btn-danger"
                disabled={confirmDelete.deleting}
                onClick={() => remove(confirmDelete)}
              >
                {t('common.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
