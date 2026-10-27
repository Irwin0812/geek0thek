import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../services/api.js'
import VinylCard, { EmptyState } from '../components/VinylCard.jsx'
import GroupCard from '../components/GroupCard.jsx'
import ItemDetailModal from '../components/ItemDetailModal.jsx'
import ItemList from '../components/ItemList.jsx'
import GroupedItemList from '../components/GroupedItemList.jsx'
import ViewToolbar from '../components/ViewToolbar.jsx'
import CollectionSearch from '../components/CollectionSearch.jsx'
import { groupVinylsByArtist, NO_ARTIST_LABEL } from '../components/collection.js'
import { useDisplay } from '../services/display.jsx'
import { PencilIcon, TrashIcon } from '../components/icons.jsx'

/**
 * Collection de disques en vue hiérarchique :
 *  Niveau 1 : une tuile par artiste (première jaquette du groupe en visuel)
 *  Niveau 2 : au clic sur un artiste, la liste de ses disques
 *            (tuiles individuelles, actions Modifier / Supprimer).
 * Quand une recherche est en cours, la liste reste à plat (résultat de la recherche).
 */
export default function Collection() {
  const location = useLocation()
  const { settings } = useDisplay()
  const [vinyls, setVinyls] = useState([])
  const [q, setQ] = useState('')
  const [loadError, setLoadError] = useState('')
  const [detailVinyl, setDetailVinyl] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [toast, setToast] = useState('')
  // Clé du groupe (artiste) ouvert au niveau 2, null pour la vue principale (niveau 1)
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

  const remove = async (vinyl) => {
    try {
      await api.vinyls.remove(vinyl.id)
      setConfirmDelete(null)
      setToast(`« ${vinyl.title} » a été retiré de votre collection.`)
      setTimeout(() => setToast(''), 3500)
      load()
    } catch (err) {
      alert(err.message)
    }
  }

  /** Pré-remplit le formulaire de création avec l'artiste du groupe. */
  const addForGroup = (group) => {
    const artist = group.name === NO_ARTIST_LABEL ? '' : group.name
    window.location.assign(`/vinyles/nouveau?prefill=1&artist=${encodeURIComponent(artist)}`)
  }

  // ------- Vue pilotée par les préférences d'affichage (grille / liste) -------
  const isList = settings.view === 'list'
  const cardView = settings.jukebox ? 'jukebox' : 'card'
  const listActions = [
    { value: 'edit', label: 'Modifier', icon: <PencilIcon size={15} /> },
    { value: 'remove', label: 'Supprimer', icon: <TrashIcon size={15} />, danger: true },
  ]
  const onAction = (value, v) => (value === 'edit' ? window.location.assign(`/vinyles/${v.id}`) : setConfirmDelete(v))
  const openDetail = (v) => setDetailVinyl(v)
  const cardProps = {
    view: cardView,
    showTitle: settings.showTitle,
    showYear: settings.showYear,
  }
  const gridCls = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
  const gridActions = (v) => (
    <div className="flex gap-2">
      <Link to={`/vinyles/${v.id}`} className="btn-ghost flex-1 !py-1.5">Modifier</Link>
      <button
        className="btn-danger !py-1.5"
        onClick={() => setConfirmDelete(v)}
        disabled={confirmDelete?.id === v.id}
      >
        Supprimer
      </button>
    </div>
  )

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          {/* Nomenclature officielle (i18n navbar.myVinyls) : « Mes Disques ». */}
           <h1 className="text-2xl md:text-3xl font-extrabold text-white">Mes Disques</h1>
          <p className="text-sm text-slate-400 mt-1">
            {vinyls.length} disque{vinyls.length > 1 ? 's' : ''} regroupé{vinyls.length > 1 ? 's' : ''} en{' '}
            {groups.length} artist{groups.length > 1 ? 'es' : 'e'} — cliquez sur un artiste pour voir ses disques.
          </p>
        </div>
        {/* Barre d'actions : UNE seule ligne (recherche → vue → ajout), hauteurs
            uniformes (h-12). La recherche absorbe le sur-largeur (flex-1) au lieu
            de forcer le bouton à passer sous la toolbar. Layout strictement aligné sur la page BD. */}
        <div className="flex flex-wrap items-center gap-3">
          <CollectionSearch value={q} onChange={(e) => setQ(e.target.value)} />
          <ViewToolbar />
          <Link to="/vinyles/nouveau" className="btn-primary !h-12">Ajouter un disque</Link>
        </div>
      </header>

      {toast && (
        <p className="text-sm text-amber-800 bg-amber-100 border border-amber-500/30 rounded-lg px-3 py-2">
          {toast}
        </p>
      )}

      {loadError ? (
        <p className="text-sm text-rose-600">{loadError}</p>
      ) : vinyls.length === 0 ? (
        <div className="grid grid-cols-1 gap-4">
          <EmptyState
            title={q ? 'Aucun résultat' : 'Aucun disque pour l’instant'}
            subtitle={q
              ? `Aucun disque ne correspond à « ${q} ».`
              : 'Commencez par ajouter un disque en saisie manuelle ou via un code-barres (MusicBrainz + Discogs).'}
            action={
              q ? (
                <button className="btn-ghost" onClick={() => setQ('')}>Réinitialiser la recherche</button>
              ) : (
                <Link to="/vinyles/nouveau" className="btn-primary">Ajouter un disque</Link>
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
              <button className="btn-ghost" onClick={() => setOpenGroup(null)}>← Tous les artistes</button>
              <div>
                <h2 className="text-xl font-extrabold text-white" title={currentGroup.name}>
                  {currentGroup.name}
                </h2>
                <p className="text-sm text-slate-400">
                  {currentGroup.items.length} disque{currentGroup.items.length > 1 ? 's' : ''}
                  {currentGroup.items[0]?.label ? ` — ${currentGroup.items[0].label}` : ''}
                </p>
              </div>
            </div>
            <button className="btn-ghost" onClick={() => addForGroup(currentGroup)}>
              + Ajouter pour cet artiste
            </button>
          </div>

          {currentGroup.items.length === 0 ? (
            <div className="grid grid-cols-1 gap-4">
              <EmptyState
                title="Artiste vide"
                subtitle={`Aucun disque n'est attribué à « ${currentGroup.name} » pour le moment.`}
                action={
                  <button className="btn-primary" onClick={() => addForGroup(currentGroup)}>
                    + Ajouter un disque
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
        isList ? (
          <GroupedItemList
            type="vinyl"
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
                // Photo / logo d'ARTISTE (gérée par le backend : récupération
                // automatique MusicBrainz / Cover Art Archive ou téléversement
                // manuel, repli propre img/no_group.jpg) — image utilisée UNIQUEMENT
                // sur la tuile du groupe de cette grille « Mes Disques ».
                artistImage={g.artistImage}
                variant="vinyl"
                view={cardView}
                showTitle={settings.showTitle}
                onClick={() => setOpenGroup(g.key)}
              />
            ))}
          </div>
        ))}

      <ItemDetailModal
        type="vinyl"
        item={detailVinyl}
        onClose={() => setDetailVinyl(null)}
        onEdit={(v) => { setDetailVinyl(null); window.location.assign(`/vinyles/${v.id}`) }}
      />

      {confirmDelete && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-white text-center">Supprimer ce disque ?</h2>
            <p className="mt-2 text-sm text-slate-400">
              « <span className="font-semibold text-white">{confirmDelete.title}</span> » de {confirmDelete.artist} sera
              définitivement retiré.{String(confirmDelete.coverUrl || '').startsWith('/uploads/') &&
                ' Sa jaquette locale sera également supprimée du disque.'}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Annuler</button>
              <button className="btn-danger" disabled={confirmDelete.deleting} onClick={() => remove(confirmDelete)}>
                Oui, supprimer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
