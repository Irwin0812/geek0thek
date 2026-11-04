import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'
import { useAuth } from '../App.jsx'
import Avatar from '../components/Avatar.jsx'

// ------------------------------------------------------------
// BIBLIOTHÈQUES PARTAGÉES — gestion des autorisations d'accès en
// consultation (lecture seule) à SA collection pour les autres
// utilisateurs enregistrés de l'application.
//
//   - liste des AUTRES utilisateurs (GET /api/users/all, tout compte
//     authentifié — pas besoin d'être admin),
//   - interrupteur par utilisateur : autoriser / retirer l'accès
//     (POST / DELETE /api/users/library-shares, scope « all »),
//   - section « Collections partagées avec moi » : accès reçus des
//     autres utilisateurs (GET /api/users/library-shares).
//
// Le contrôle d'accès est appliqué côté backend (canConsult de
// middlewares/auth.js) sur les routes de lecture des collections :
// un destinataire d'un partage peut consulter les disques / BD du
// propriétaire, sans jamais pouvoir les modifier.
// ------------------------------------------------------------

export default function SharedLibraries() {
  const { user: me } = useAuth()
  const { t } = useTranslation()
  const [users, setUsers] = useState([])
  const [shares, setShares] = useState({ sharedWith: [], sharedWithMe: [] })
  const [loadError, setLoadError] = useState('')
  const [busyId, setBusyId] = useState(null) // id utilisateur en cours de bascule
  const [toast, setToast] = useState(null) // { key, params } → traduit via t()

  const flash = (key, params = null) => {
    setToast({ key, params })
    setTimeout(() => setToast(null), 3500)
  }

  const load = async () => {
    try {
      const [{ users: members }, shareData] = await Promise.all([
        api.users.all(),
        api.libraryShares.list(),
      ])
      setUsers(members)
      setShares(shareData)
    } catch (err) {
      setLoadError(err.message)
    }
  }
  useEffect(() => { load() }, [])

  // Accès accordés par le compte courant, indexés par id du destinataire :
  // un utilisateur peut cumuler plusieurs partages (ex. « vinyls » + « comics »)
  // — l'interrupteur est ACTIF dès qu'au moins un partage existe pour lui.
  const grantedByRecipient = useMemo(() => {
    const map = new Map()
    for (const share of shares.sharedWith || []) {
      const id = share.user && share.user.id
      if (!id) continue
      if (!map.has(id)) map.set(id, [])
      map.get(id).push(share)
    }
    return map
  }, [shares])

  // Bascule d'un interrupteur : autorise (POST, scope « all ») ou retire
  // (DELETE de CHAQUE partage existant pour ce destinataire). L'état local
  // est mis à jour immédiatement (optimiste) puis resynchronisé avec l'API.
  const toggle = async (target) => {
    if (!target || target.id === me.id || busyId !== null) return
    setBusyId(target.id)
    try {
      const existing = grantedByRecipient.get(target.id) || []
      if (existing.length > 0) {
        // RETRAIT : suppression de tous les partages vers ce destinataire.
        await Promise.all(existing.map((share) => api.libraryShares.remove(share.id)))
        setShares((s) => ({
          ...s,
          sharedWith: s.sharedWith.filter((sh) => !(sh.user && sh.user.id === target.id)),
        }))
        flash('sharedLibraries.revoked', { name: `${target.firstName} ${target.lastName}`.trim() })
      } else {
        // AUTORISATION : ouverture de l'accès en consultation (scope « all » =
        // disques ET BD). Le backend déclenche l'e-mail n°2 au destinataire.
        const { share } = await api.libraryShares.create({ userId: target.id, scope: 'all' })
        setShares((s) => ({ ...s, sharedWith: [share, ...s.sharedWith] }))
        flash('sharedLibraries.granted', { name: `${target.firstName} ${target.lastName}`.trim() })
      }
    } catch (err) {
      // Échec (réseau / 403…) : resynchronise l'état réel depuis l'API.
      setLoadError('')
      load()
      flash('sharedLibraries.error', { message: err.message })
    } finally {
      setBusyId(null)
    }
  }

  const others = users.filter((u) => u.id !== me.id)

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <header>
        {/* cb-page-title : lettrage « case de BD » sous le thème Comic Books. */}
        <h1 className="cb-page-title text-2xl font-extrabold text-white">{t('sharedLibraries.title')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('sharedLibraries.subtitle')}</p>
      </header>

      {toast && (
        <p className="text-sm text-gold-300 bg-gold-500/10 border border-gold-500/30 rounded-lg px-3 py-2">
          {t(toast.key, toast.params ?? {})}
        </p>
      )}

      {/* --- Accès accordés : les autres utilisateurs de l'application --- */}
      <section className="card overflow-x-auto">
        <div className="px-4 pt-4">
          <h2 className="font-bold text-white">{t('sharedLibraries.grantedTitle')}</h2>
          <p className="mt-0.5 text-xs text-slate-500">{t('sharedLibraries.grantedHint')}</p>
        </div>

        {loadError ? (
          <p className="px-4 py-4 text-sm text-rose-400">{loadError}</p>
        ) : others.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500">{t('sharedLibraries.noOtherUsers')}</p>
        ) : (
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-night-600/60">
                <th className="px-4 py-3">{t('sharedLibraries.colMember')}</th>
                <th className="px-4 py-3">{t('sharedLibraries.colLogin')}</th>
                <th className="px-4 py-3">{t('sharedLibraries.colVinyls')}</th>
                <th className="px-4 py-3">{t('sharedLibraries.colComics')}</th>
                <th className="px-4 py-3 text-right">{t('sharedLibraries.colAccess')}</th>
              </tr>
            </thead>
            <tbody>
              {others.map((u) => {
                const granted = (grantedByRecipient.get(u.id) || []).length > 0
                const busy = busyId === u.id
                return (
                  <tr key={u.id} className="border-b border-night-700/50 hover:bg-night-700/20">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar user={u} size={36} />
                        <div>
                          <div className="font-semibold text-slate-100">{u.firstName} {u.lastName}</div>
                          <div className="text-xs text-slate-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-300">{u.login}</td>
                    <td className="px-4 py-3 text-slate-300">{u.vinylCount ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-300">{u.comicCount ?? '—'}</td>
                    <td className="px-4 py-3">
                      {/* Interrupteur d'autorisation (lecture seule) : actif =
                          accès accordé. Le backend applique le contrôle via
                          canConsult sur les routes de lecture des collections. */}
                      <div className="flex items-center justify-end gap-2">
                        <span className={`text-xs ${granted ? 'text-emerald-300' : 'text-slate-500'}`}>
                          {t(granted ? 'sharedLibraries.accessGranted' : 'sharedLibraries.accessDenied')}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={granted}
                          aria-label={`${t('sharedLibraries.toggleLabel')} — ${u.firstName} ${u.lastName}`}
                          disabled={busy}
                          onClick={() => toggle(u)}
                          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400/70 disabled:opacity-50 ${
                            granted ? 'bg-emerald-500' : 'bg-night-600'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
                              granted ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* --- Collections partagées avec moi (accès reçus) --- */}
      <section className="card p-4">
        <h2 className="font-bold text-white">{t('sharedLibraries.receivedTitle')}</h2>
        <p className="mt-0.5 text-xs text-slate-500">{t('sharedLibraries.receivedHint')}</p>

        {(shares.sharedWithMe || []).length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">{t('sharedLibraries.noReceived')}</p>
        ) : (
          <ul className="mt-3 divide-y divide-night-700/50">
            {(shares.sharedWithMe || []).map((share) => {
              const owner = share.user || {}
              return (
                <li key={share.id} className="flex items-center gap-3 py-2.5">
                  <Avatar user={owner} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-100">
                      {owner.firstName} {owner.lastName}
                    </div>
                    <div className="text-xs text-slate-500">{owner.login}</div>
                  </div>
                  <span className="badge bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    {t(`sharedLibraries.scope_${share.scope}`)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
