import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'
import Avatar from '../components/Avatar.jsx'
import VinylCard, { EmptyState } from '../components/VinylCard.jsx'
import ComicCard from '../components/ComicCard.jsx'
import GroupCard from '../components/GroupCard.jsx'
import ItemDetailModal from '../components/ItemDetailModal.jsx'
import ItemList from '../components/ItemList.jsx'
import GroupedItemList from '../components/GroupedItemList.jsx'
import ViewToolbar from '../components/ViewToolbar.jsx'
import CollectionSearch from '../components/CollectionSearch.jsx'
import CollectionCounter from '../components/CollectionCounter.jsx'
import { groupVinylsByArtist } from '../components/collection.js'
import { groupComicsBySeries } from '../components/collection.js'
import { useDisplay, DisplayProvider, DISPLAY_SCOPES } from '../services/display.jsx'

/**
 * COLLECTION PARTAGÉE — vue EN LECTURE SEULE de la collection d'UN AUTRE
 * utilisateur, cible du lien envoyé par e-mail lors d'un partage de
 * bibliothèque (chemin /shared/:ownerUserId).
 *
 * CHARTE VISUELLE : adopte rigoureusement la même structure que les pages
 * « Mes Disques » / « Mes BD » :
 *  - Compteur à gauche de la barre de recherche (« X artistes — Y disques »)
 *  - Basculement Grille / Liste (ViewToolbar, mêmes préférences localStorage)
 *  - Classement hiérarchique : Artistes → Albums (disques), Séries → Tomes (BD)
 *  - Tuiles GroupCard niveau 1, cartes individuelles niveau 2
 *
 * SÉCURITÉ / ISOLATION DES SESSIONS :
 *  - Le destinataire accède à cette vue sous SA PROPRE identité (celle de sa
 *    session JWT courante) — jamais sous celle de l'émetteur.
 *  - Si le visiteur n'est PAS connecté, la route est protégée (ProtectedRoute).
 *  - LECTURE SEULE STRICTE : aucun bouton de création / modification /
 *    suppression / import n'est affiché. Le backend verrouille par ailleurs
 *    toutes les routes d'écriture (POST/PUT/PATCH/DELETE) pour tout utilisateur
 *    qui n'est pas le propriétaire légitime.
 *
 * Les onglets affichés (Disques / BD) dépendent du SCOPE du partage accordé à
 * ce compte (cf. GET /api/users/library-shares -> sharedWithMe).
 */
export default function SharedCollection() {
  const { ownerUserId } = useParams()
  const ownerId = Number(ownerUserId)
  const { t } = useTranslation()

  const [shares, setShares] = useState(null) // { sharedWithMe: [...] } | null (chargement)
  const [activeTab, setActiveTab] = useState('vinyls')
  const [q, setQ] = useState('')
  const [vinyls, setVinyls] = useState([])
  const [comics, setComics] = useState([])
  const [loadError, setLoadError] = useState('')
  const [detail, setDetail] = useState(null) // { type: 'vinyl'|'comic', item }

  // Scopes accordés à CE compte pour la collection de cet émetteur :
  // « vinyls » / « comics » / « all ». Déterminent les onglets disponibles.
  const scopes = useMemo(() => {
    if (!shares) return null
    const mine = (shares.sharedWithMe || []).filter(
      (share) => share.user && Number(share.user.id) === ownerId
    )
    const set = new Set()
    for (const share of mine) {
      if (share.scope === 'all') {
        set.add('vinyls')
        set.add('comics')
      } else if (share.scope === 'vinyls' || share.scope === 'comics') {
        set.add(share.scope)
      }
    }
    return set
  }, [shares, ownerId])

  const owner = useMemo(() => {
    if (!shares) return null
    const mine = (shares.sharedWithMe || []).find(
      (share) => share.user && Number(share.user.id) === ownerId
    )
    return mine ? mine.user : null
  }, [shares, ownerId])

  // Onglets disponibles (ordre : disques puis BD).
  const tabs = useMemo(() => {
    if (!scopes) return []
    const list = []
    if (scopes.has('vinyls')) list.push({ key: 'vinyls', label: t('sharedLibraries.scope_vinyls') })
    if (scopes.has('comics')) list.push({ key: 'comics', label: t('sharedLibraries.scope_comics') })
    return list
  }, [scopes, t])

  // Onglet actif : si l'onglet courant n'est plus disponible (scope retiré),
  // on retombe sur le premier onglet disponible.
  useEffect(() => {
    if (tabs.length === 0) return
    if (!tabs.some((tab) => tab.key === activeTab)) setActiveTab(tabs[0].key)
  }, [tabs, activeTab])

  // Chargement des partages reçus (détermine les onglets + l'émetteur).
  useEffect(() => {
    let cancelled = false
    api.libraryShares
      .list()
      .then((data) => { if (!cancelled) setShares(data) })
      .catch((err) => { if (!cancelled) setLoadError(err.message) })
    return () => { cancelled = true }
  }, [])

  // Chargement de la collection de l'émetteur (lecture seule) pour l'onglet
  // actif, avec recherche éventuelle. Rechargé à chaque changement d'onglet /
  // de requête (délai anti-rebond).
  const load = useCallback(async () => {
    if (!scopes || tabs.length === 0) return
    setLoadError('')
    try {
      if (activeTab === 'vinyls') {
        const { vinyls: data } = await api.vinyls.byUser(ownerId, q)
        setVinyls(data || [])
      } else if (activeTab === 'comics') {
        const { comics: data } = await api.comics.byUser(ownerId, q)
        setComics(data || [])
      }
    } catch (err) {
      // 403 : accès retiré ou jamais accordé pour ce scope -> message propre.
      setLoadError(err.message)
    }
  }, [scopes, tabs, activeTab, ownerId, q])

  useEffect(() => {
    const timer = setTimeout(() => load(), 200)
    return () => clearTimeout(timer)
  }, [load])

  // Changement d'onglet : on repart sur une recherche vide.
  const switchTab = (key) => {
    if (key === activeTab) return
    setActiveTab(key)
    setQ('')
  }

  const openDetail = useCallback((item, type) => setDetail({ type, item }), [])

  // Compteur de collection (calculé ici pour la barre d'actions).
  const vinylGroups = useMemo(() => groupVinylsByArtist(vinyls), [vinyls])
  const comicGroups = useMemo(() => groupComicsBySeries(comics), [comics])

  return (
    // `lib-coll` : ancre CSS du thème « Médiathèque » — harmonise grilles /
    // listes à la charte chaude (même classe que les pages personnelles).
    <div className="lib-coll max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* En-tête : émetteur + mention LECTURE SEULE. */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {owner && <Avatar user={owner} size={48} />}
          <div>
            {/* cb-page-title : lettrage « case de BD » sous le thème Comic Books. */}
            <h1 className="cb-page-title text-2xl md:text-3xl font-extrabold text-white">
              {t('sharedCollection.title', { name: owner ? `${owner.firstName} ${owner.lastName}`.trim() : '' })}
            </h1>
            <p className="mt-0.5 text-sm text-slate-400">{t('sharedCollection.subtitle')}</p>
          </div>
        </div>
        {/* Badge « Lecture seule » : signale l'absence totale d'actions d'écriture. */}
        <span className="badge bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 self-start sm:self-center">
          {t('sharedCollection.readOnly')}
        </span>
      </header>

      {/* Onglets (Disques / BD) : uniquement les scopes effectivement partagés. */}
      {shares && tabs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => switchTab(tab.key)}
              className={`btn-ghost !h-10 ${activeTab === tab.key ? '!bg-gold-500/20 !text-gold-200' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {loadError ? (
        <p className="text-sm text-rose-400">{loadError}</p>
      ) : shares && tabs.length === 0 ? (
        // Aucun scope partagé avec ce compte pour cet émetteur.
        <EmptyState
          title={t('sharedCollection.noAccessTitle')}
          subtitle={t('sharedCollection.noAccessSubtitle')}
          action={<Link to="/partages" className="btn-primary">{t('sharedLibraries.title')}</Link>}
        />
      ) : shares && (activeTab === 'vinyls' ? vinyls.length === 0 : comics.length === 0) ? (
        <EmptyState
          title={q ? t('collection.noResults') : t('sharedCollection.emptyTitle')}
          subtitle={q
            ? t(activeTab === 'vinyls' ? 'collection.noVinylMatch' : 'collection.noComicMatch', { q })
            : t('sharedCollection.emptySubtitle')}
          action={q ? <button className="btn-ghost" onClick={() => setQ('')}>{t('collection.resetSearch')}</button> : null}
        />
      ) : activeTab === 'vinyls' ? (
        // ------- Onglet DISQUES : scope d'affichage dédié « disks ».
        // Le DisplayProvider englobe la barre d'actions ET le contenu pour que
        // ViewToolbar et la vue partagent le MÊME état (grille/liste). -------
        <DisplayProvider scope={DISPLAY_SCOPES.disks}>
          <div className="space-y-6">
            {/* Barre d'actions : compteur → recherche → vue. AUCUN bouton « Ajouter ». */}
            <div className="cb-actions flex flex-wrap items-center gap-3">
              <CollectionCounter type="disks" groups={vinylGroups.length} items={vinyls.length} />
              <CollectionSearch value={q} onChange={(e) => setQ(e.target.value)} />
              <ViewToolbar />
            </div>
            <SharedVinylsView vinyls={vinyls} q={q} onDetail={(v) => openDetail(v, 'vinyl')} />
          </div>
        </DisplayProvider>
      ) : (
        // ------- Onglet BD : scope d'affichage dédié « comics ». -------
        <DisplayProvider scope={DISPLAY_SCOPES.comics}>
          <div className="space-y-6">
            {/* Barre d'actions : compteur → recherche → vue. AUCUN bouton « Ajouter ». */}
            <div className="cb-actions flex flex-wrap items-center gap-3">
              <CollectionCounter type="comics" groups={comicGroups.length} items={comics.length} />
              <CollectionSearch value={q} onChange={(e) => setQ(e.target.value)} />
              <ViewToolbar />
            </div>
            <SharedComicsView comics={comics} q={q} onDetail={(c) => openDetail(c, 'comic')} />
          </div>
        </DisplayProvider>
      )}

      {/* Modale de détail EN LECTURE SEULE : aucun bouton « Modifier » (onEdit absent). */}
      {detail && (
        <ItemDetailModal
          type={detail.type}
          item={detail.item}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   VUE DISQUES PARTAGÉS — hiérarchie Artistes → Albums (lecture seule)
   ═══════════════════════════════════════════════════════════════════════ */
function SharedVinylsView({ vinyls, q, onDetail }) {
  const { settings } = useDisplay()
  const { t } = useTranslation()
  // Clé du groupe (artiste) ouvert au niveau 2, null pour la vue principale.
  const [openGroup, setOpenGroup] = useState(null)

  const groups = useMemo(() => groupVinylsByArtist(vinyls), [vinyls])
  const currentGroup = openGroup ? groups.find((g) => g.key === openGroup) : null
  useEffect(() => {
    if (openGroup && !groups.some((g) => g.key === openGroup)) setOpenGroup(null)
  }, [groups, openGroup])

  // ------- Vue pilotée par les préférences d'affichage (grille / liste) -------
  const isList = settings.view === 'list'
  const cardView = settings.jukebox ? 'jukebox' : 'card'
  const cardProps = useMemo(
    () => ({
      view: cardView,
      showTitle: settings.showTitle,
      showYear: settings.showYear,
    }),
    [cardView, settings.showTitle, settings.showYear]
  )
  const gridCls = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
  const openDetailCb = useCallback((v) => onDetail(v), [onDetail])

  // Nom AFFICHÉ du groupe niveau 2 : « Divers » si non étiqueté, sinon son nom.
  const currentGroupName = currentGroup
    ? (currentGroup.isUnlabeled ? t('collection.groupNoArtist') : currentGroup.name)
    : ''

  return (
    <>
      {q ? (
        // ------- Recherche en cours : liste à plat de tous les résultats -------
        isList ? (
          <ItemList
            type="vinyl"
            items={vinyls}
            actions={[]}
            onDetail={openDetailCb}
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
                onClick={() => onDetail(v)}
                {...cardProps}
              />
            ))}
          </div>
        )
      ) : currentGroup ? (
        // ------- Niveau 2 : disques de l'artiste ouvert (lecture seule) -------
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button className="btn-ghost" onClick={() => setOpenGroup(null)}>
                {t('collection.allArtists')}
              </button>
              <div>
                {/* cb-group-title : lettrage « case de BD » sous le thème Comic Books. */}
                <h2 className="cb-group-title text-xl font-extrabold text-white" title={currentGroupName}>
                  {currentGroupName}
                </h2>
                <p className="text-sm text-slate-400">
                  {t('collection.vinylsCount', { count: currentGroup.items.length })}
                  {currentGroup.items[0]?.label ? ` — ${currentGroup.items[0].label}` : ''}
                </p>
              </div>
            </div>
            {/* AUCUN bouton « Ajouter pour cet artiste » — lecture seule stricte. */}
          </div>

          {isList ? (
            <ItemList
              type="vinyl"
              items={currentGroup.items}
              actions={[]}
              onDetail={openDetailCb}
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
                  onClick={() => onDetail(v)}
                  {...cardProps}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        // ------- Niveau 1 : accordéons par artiste (liste) / tuiles (grille) -------
        isList ? (
          <GroupedItemList
            type="vinyl"
            groups={groups}
            actions={[]}
            onDetail={openDetailCb}
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
                artistImage={g.artistImage}
                variant="vinyl"
                view={cardView}
                showTitle={settings.showTitle}
                isUnlabeled={g.isUnlabeled}
                onClick={() => setOpenGroup(g.key)}
              />
            ))}
          </div>
        )
      )}
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   VUE BD PARTAGÉES — hiérarchie Séries → Tomes (lecture seule)
   ═══════════════════════════════════════════════════════════════════════ */
function SharedComicsView({ comics, q, onDetail }) {
  const { settings } = useDisplay()
  const { t } = useTranslation()
  // Clé du groupe (série) ouvert au niveau 2, null pour la vue principale.
  const [openGroup, setOpenGroup] = useState(null)

  const groups = useMemo(() => groupComicsBySeries(comics), [comics])
  const currentGroup = openGroup ? groups.find((g) => g.key === openGroup) : null
  useEffect(() => {
    if (openGroup && !groups.some((g) => g.key === openGroup)) setOpenGroup(null)
  }, [groups, openGroup])

  // ------- Vue pilotée par les préférences d'affichage (grille / liste) -------
  const isList = settings.view === 'list'
  const cardView = settings.jukebox ? 'jukebox' : 'card'
  const cardProps = useMemo(
    () => ({
      view: cardView,
      showTitle: settings.showTitle,
      showYear: settings.showYear,
    }),
    [cardView, settings.showTitle, settings.showYear]
  )
  const gridCls = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'
  const openDetailCb = useCallback((c) => onDetail(c), [onDetail])

  // Nom AFFICHÉ du groupe (série) au niveau 2 : « Hors série » si non étiquetée.
  const currentGroupName = currentGroup
    ? (currentGroup.isUnlabeled ? t('collection.groupNoSeries') : currentGroup.name)
    : ''

  return (
    <>
      {q ? (
        // ------- Recherche en cours : liste à plat de tous les résultats -------
        isList ? (
          <ItemList
            type="comic"
            items={comics}
            actions={[]}
            onDetail={openDetailCb}
            showTitle={settings.showTitle}
            showYear={settings.showYear}
            showBadges={settings.showBadges}
          />
        ) : (
          <div className={gridCls}>
            {comics.map((c) => (
              <ComicCard key={c.id} comic={c} onClick={() => onDetail(c)} {...cardProps} />
            ))}
          </div>
        )
      ) : currentGroup ? (
        // ------- Niveau 2 : albums de la série ouverte (lecture seule) -------
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button className="btn-ghost" onClick={() => setOpenGroup(null)}>
                {t('collection.allSeries')}
              </button>
              <div>
                {/* cb-group-title : lettrage « case de BD » sous le thème Comic Books. */}
                <h2 className="cb-group-title text-xl font-extrabold text-white" title={currentGroupName}>
                  {currentGroupName}
                </h2>
                <p className="text-sm text-slate-400">
                  {t('collection.albumsCount', { count: currentGroup.items.length })}
                  {currentGroup.items[0]?.authors ? ` — ${currentGroup.items[0].authors}` : ''}
                </p>
              </div>
            </div>
            {/* AUCUN bouton « Ajouter dans la série » — lecture seule stricte. */}
          </div>

          {isList ? (
            <ItemList
              type="comic"
              items={currentGroup.items}
              actions={[]}
              onDetail={openDetailCb}
              showTitle={settings.showTitle}
              showYear={settings.showYear}
              showBadges={settings.showBadges}
            />
          ) : (
            <div className={gridCls}>
              {currentGroup.items.map((c) => (
                <ComicCard key={c.id} comic={c} onClick={() => onDetail(c)} {...cardProps} />
              ))}
            </div>
          )}
        </div>
      ) : (
        // ------- Niveau 1 : accordéons par série (liste) / tuiles (grille) -------
        isList ? (
          <GroupedItemList
            type="comic"
            groups={groups}
            actions={[]}
            onDetail={openDetailCb}
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
                seriesImage={g.seriesImage}
                view={cardView}
                showTitle={settings.showTitle}
                isUnlabeled={g.isUnlabeled}
                onClick={() => setOpenGroup(g.key)}
              />
            ))}
          </div>
        )
      )}
    </>
  )
}
