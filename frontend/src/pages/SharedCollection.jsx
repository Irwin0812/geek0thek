import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'
import Avatar from '../components/Avatar.jsx'
import VinylCard, { EmptyState } from '../components/VinylCard.jsx'
import ComicCard from '../components/ComicCard.jsx'
import ItemDetailModal from '../components/ItemDetailModal.jsx'
import CollectionSearch from '../components/CollectionSearch.jsx'

/**
 * COLLECTION PARTAGÉE — vue EN LECTURE SEULE de la collection d'UN AUTRE
 * utilisateur, cible du lien envoyé par e-mail lors d'un partage de
 * bibliothèque (chemin /shared/:ownerUserId).
 *
 * SÉCURITÉ / ISOLATION DES SESSIONS :
 *  - Le destinataire accède à cette vue sous SA PROPRE identité (celle de sa
 *    session JWT courante) — jamais sous celle de l'émetteur. Aucun jeton,
 *    mot de passe ou identifiant de connexion n'est transmis par le lien.
 *  - Si le visiteur n'est PAS connecté, la route est protégée (ProtectedRoute)
 *    : il est redirigé vers /login puis revient ici après identification avec
 *    SES PROPRES identifiants.
 *  - LECTURE SEULE STRICTE : aucun bouton de création / modification /
 *    suppression / import n'est affiché (pas d'« Ajouter », pas d'actions sur
 *    les cartes, modale de détail sans bouton « Modifier »). Le backend
 *    verrouille par ailleurs toutes les routes d'écriture (POST/PUT/PATCH/
 *    DELETE) pour tout utilisateur qui n'est pas le propriétaire légitime.
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
  // « vinyls » / « comiques » / « all ». Déterminent les onglets disponibles.
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

  const items = activeTab === 'vinyls' ? vinyls : comics
  const gridCls = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4'

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* En-tête : émetteur + mention LECTURE SEULE. */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {owner && <Avatar user={owner} size={48} />}
          <div>
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

      {/* Barre de recherche (lecture seule). */}
      {shares && tabs.length > 0 && (
        <div className="flex justify-end">
          <CollectionSearch value={q} onChange={(e) => setQ(e.target.value)} />
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
      ) : shares && items.length === 0 ? (
        <EmptyState
          title={q ? t('collection.noResults') : t('sharedCollection.emptyTitle')}
          subtitle={q ? t(activeTab === 'vinyls' ? 'collection.noVinylMatch' : 'collection.noComicMatch', { q }) : t('sharedCollection.emptySubtitle')}
          action={q ? <button className="btn-ghost" onClick={() => setQ('')}>{t('collection.resetSearch')}</button> : null}
        />
      ) : (
        <div className={gridCls}>
          {activeTab === 'vinyls'
            ? vinyls.map((v) => (
                <VinylCard key={v.id} vinyl={v} onClick={() => setDetail({ type: 'vinyl', item: v })} />
              ))
            : comics.map((c) => (
                <ComicCard key={c.id} comic={c} onClick={() => setDetail({ type: 'comic', item: c })} />
              ))}
        </div>
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
