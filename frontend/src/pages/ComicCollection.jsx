import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../services/api.js'
import ComicCard from '../components/ComicCard.jsx'
import GroupCard from '../components/GroupCard.jsx'
import { EmptyState } from '../components/VinylCard.jsx'
import ItemDetailModal from '../components/ItemDetailModal.jsx'
import ItemList from '../components/ItemList.jsx'
import GroupedItemList from '../components/GroupedItemList.jsx'
import ViewToolbar from '../components/ViewToolbar.jsx'
import CollectionSearch from '../components/CollectionSearch.jsx'
import { groupComicsBySeries, NO_SERIES_LABEL } from '../components/collection.js'
import { useDisplay } from '../services/display.jsx'
import { PencilIcon, TrashIcon } from '../components/icons.jsx'

/**
 * Collection BD en vue hiérarchique :
 *  Niveau 1 : une tuile par série (première couverture du groupe en visuel)
 *  Niveau 2 : au clic sur une série, la liste des albums de cette série
 *            (tuiles individuelles, actions Modifier / Supprimer).
 * Quand une recherche est en cours, la liste reste à plat (résultat de la recherche).
 */
export default function ComicCollection() {
  const location = useLocation()
  const navigate = useNavigate()
  const { settings } = useDisplay()
  const [comics, setComics] = useState([])
  const [q, setQ] = useState('')
  const [loadError, setLoadError] = useState('')
  const [detailComic, setDetailComic] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [toast, setToast] = useState('')
  // Clé du groupe (série) ouvert au niveau 2, null pour la vue principale (niveau 1)
  const [openGroup, setOpenGroup] = useState(null)

  useEffect(() => {
    if (location.state?.toast) {
      setToast(location.state.toast)
      const t = setTimeout(() => setToast(''), 4000)
      return () => clearTimeout(t)
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

  const remove = async (comic) => {
    try {
      await api.comics.remove(comic.id)
      setConfirmDelete(null)
      setToast(`« ${comic.title} » a été retirée de votre collection.`)
      setTimeout(() => setToast(''), 3500)
      load()
    } catch (err) {
      alert(err.message)
    }
  }

  const goEdit = (comic) => {
    const params = new URLSearchParams()
    Object.entries(comic).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '' && typeof v !== 'boolean') params.set(k, String(v))
    })
    setOpenGroup(null)
    navigate(`/comics/${comic.id}?${params.toString()}`)
  }

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
  const listActions = [
    { value: 'edit', label: 'Modifier', icon: <PencilIcon size={15} /> },
    { value: 'remove', label: 'Supprimer', icon: <TrashIcon size={15} />, danger: true },
  ]
  const onAction = (value, c) => (value === 'edit' ? goEdit(c) : setConfirmDelete(c))
  const openDetail = (c) => setDetailComic(c)
  const cardProps = {
    view: cardView,
    showTitle: settings.showTitle,
    showYear: settings.showYear,
  }
  const gridCls = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
  const gridActions = (c) => (
    <div className="flex gap-2">
      <button className="btn-ghost flex-1 !py-1.5" onClick={() => goEdit(c)}>Modifier</button>
      <button
        className="btn-danger !py-1.5"
        onClick={() => setConfirmDelete(c)}
        disabled={confirmDelete?.id === c.id}
      >
        Supprimer
      </button>
    </div>
  )

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          {/* Nomenclature officielle (i18n navbar.myComics) : « Mes BD ». */}
          <h1 className="text-2xl md:text-3xl font-extrabold text-white">Mes BD</h1>
          <p className="text-sm text-slate-400 mt-1">
            {comics.length} album{comics.length > 1 ? 's' : ''} regroupé{comics.length > 1 ? 's' : ''} en{' '}
            {groups.length} série{groups.length > 1 ? 's' : ''} — cliquez sur une série pour voir ses albums.
          </p>
        </div>
        {/* Barre d'actions : UNE seule ligne (recherche → vue → ajout), hauteurs
            uniformes (h-12). La recherche absorbe le sur-largeur (flex-1) au lieu
            de forcer le bouton à passer sous la toolbar. Layout strictement aligné sur la page Disques. */}
        <div className="flex flex-wrap items-center gap-3">
          <CollectionSearch value={q} onChange={(e) => setQ(e.target.value)} />
          <ViewToolbar />
          <Link to="/comics/nouveau" className="btn-primary !h-12">Ajouter une BD</Link>
        </div>
      </header>

      {toast && (
        <p className="text-sm text-amber-800 bg-amber-100 border border-amber-500/30 rounded-lg px-3 py-2">
          {toast}
        </p>
      )}

      {loadError ? (
        <p className="text-sm text-rose-600">{loadError}</p>
      ) : comics.length === 0 ? (
        <div className="grid grid-cols-1 gap-4">
          <EmptyState
            title={q ? 'Aucun résultat' : "Aucune bande dessinée pour l'instant"}
            subtitle={q
              ? `Aucun album ne correspond à « ${q} ».`
              : 'Commencez par ajouter un album en saisie manuelle ou via un ISBN (Google Books / Open Library).'}
            action={
              q ? (
                <button className="btn-ghost" onClick={() => setQ('')}>Réinitialiser la recherche</button>
              ) : (
                <Link to="/comics/nouveau" className="btn-primary">Ajouter une BD</Link>
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
              <button className="btn-ghost" onClick={() => setOpenGroup(null)}>← Toutes les séries</button>
              <div>
                <h2 className="text-xl font-extrabold text-white" title={currentGroup.name}>
                  {currentGroup.name}
                </h2>
                <p className="text-sm text-slate-400">
                  {currentGroup.items.length} album{currentGroup.items.length > 1 ? 's' : ''}
                  {currentGroup.items[0]?.authors ? ` — ${currentGroup.items[0].authors}` : ''}
                </p>
              </div>
            </div>
            {currentGroup.name !== NO_SERIES_LABEL && (
              <button className="btn-ghost" onClick={() => addForGroup(currentGroup)}>
                + Ajouter dans cette série
              </button>
            )}
          </div>

          {currentGroup.items.length === 0 ? (
            <div className="grid grid-cols-1 gap-4">
              <EmptyState
                title="Série vide"
                subtitle={`Aucun album n'est rattaché à « ${currentGroup.name} » pour le moment.`}
                action={
                  <button className="btn-primary" onClick={() => addForGroup(currentGroup)}>
                    + Ajouter un album
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
        isList ? (
          <GroupedItemList
            type="comic"
            groups={groups}
            actions={listActions}
            onAction={onAction}
            onDetail={openDetail}
            showTitle={settings.showTitle}
            showYear={settings.showYear}
            showBadges={settings.showBadges}
          />
        ) : (
          <div className={gridCls}>
            {groups.map((g) => (
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
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-white text-center">Supprimer cette bande dessinée ?</h2>
            <p className="mt-2 text-sm text-slate-400">
              « <span className="font-semibold text-white">{confirmDelete.title}</span> »
              {confirmDelete.authors ? ` de ${confirmDelete.authors}` : ''} sera définitivement retirée
              de votre collection.
              {String(confirmDelete.coverUrl || '').startsWith('/uploads/') &&
                ' Sa couverture locale sera également supprimée du disque.'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Annuler</button>
              <button
                className="btn-danger"
                disabled={confirmDelete.deleting}
                onClick={() => remove(confirmDelete)}
              >
                Oui, supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
