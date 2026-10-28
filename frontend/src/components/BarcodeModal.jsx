import { useEffect, useState } from 'react'
import { api } from '../services/api.js'

/**
 * Boîte de dialogue « Importer un Disque (#EAN/Mots clés) » : DEUX modes de
 * recherche qui coexistent à l'aide d'ONGLETS (même schéma que la modale BD
 * IsbnModal), sans conflit :
 *
 *  - ONGLET « Code-barres » — saisie du n° EAN/UPC, appel à l'API
 *    `/api/musicbrainz/barcode/:code` qui interroge MusicBrainz (aucun jeton)
 *    ET Discogs (jeton requis), puis Last.fm (prioritaire pour les visuels)
 *    côté serveur ; pré-remplissage du formulaire de création via « Pré-remplir
 *    la fiche ». Le champ `source` de la réponse indique la / les sources
 *    effectives : 'lastfm' | 'musicbrainz' | 'discogs' (et combinaisons).
 *  - ONGLET « Mots-clés » — secours quand le scan échoue : saisie d'une chaîne
 *    libre (titre de l'album, « artiste titre », voire un EAN) envoyée à
 *    api.musicbrainz.keyword (/api/musicbrainz/keyword/<q>) qui applique la
 *    CASCADE STRICTE 1. Last.fm (prioritaire, notamment les jaquettes) ->
 *    2. Discogs -> 3. MusicBrainz — chaque maillon n'est interrogé que si le
 *    précédent n'a rien trouvé. La fiche unique renvoyée s'affiche puis le
 *    bloc « Pré-remplir la fiche » applique le MÊME mapping vers AddVinyl.
 *
 * En bas, l'état des sources (found / not-found / not-configured / unavailable)
 * par source est exposé via providers — Last.fm / MusicBrainz / Discogs.
 */

/**
 * Nombre de chansons issu de l'API → nombre valide pour le formulaire.
 * `x || 0` masquerait un 0 légitime ; on ne retombe sur 0 que si la
 * valeur est absente, vide ou non numérique.
 */
const toTrackCount = (value) => {
  if (value === null || value === undefined || value === '') return 0
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Libellé du badge « source de la fiche » (fusion possible Last.fm + MusicBrainz + Discogs). */
const SOURCE_LABELS = {
  lastfm: 'Last.fm',
  musicbrainz: 'MusicBrainz',
  discogs: 'Discogs',
  'lastfm+musicbrainz': 'Last.fm + MusicBrainz',
  'lastfm+discogs': 'Last.fm + Discogs',
  'musicbrainz+discogs': 'MusicBrainz + Discogs',
  'lastfm+musicbrainz+discogs': 'Last.fm + MusicBrainz + Discogs',
}

export default function BarcodeModal({ open, onClose, onPrefill }) {
  // ---- onglet actif : 'barcode' (défaut) | 'query' --------------------------
  const [tab, setTab] = useState('barcode')

  // ---- ONGLET CODE-BARRES ---------------------------------------------------
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  // ---- ONGLET MOTS-CLÉS -----------------------------------------------------
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)

  // ---- état partagé ----------------------------------------------------------
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [providers, setProviders] = useState(null) // { lastfm, musicbrainz, discogs }

  // État des fournisseurs côté serveur (LASTFM_API_KEY, DISCOGS_TOKEN) : affiché
  // dans le sous-titre ; en l'absence de clé/jeton, le backend saute la source.
  const [sourcesActive, setSourcesActive] = useState({ lastfm: true, musicbrainz: true, discogs: true })

  useEffect(() => {
    if (!open) return
    let cancelled = false
    api.musicbrainz
      .status()
      .then((s) => {
        if (cancelled || !s) return
        setSourcesActive({
          lastfm: Boolean(s.lastfm && s.lastfm.configured),
          musicbrainz: Boolean(s.configured), // MusicBrainz : toujours « configuré » (User-Agent seul)
          discogs: Boolean(s.discogs && s.discogs.configured),
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open])

  if (!open) return null

  const close = () => {
    setTab('barcode')
    setCode('')
    setQuery('')
    setError('')
    setResult(null)
    setWarnings([])
    setProviders(null)
    setHasSearched(false)
    onClose()
  }

  // Changement d'onglet : on réinitialise l'erreur et la fiche sélectionnée
  // (chaque onglet repart proprement, sans résultat résiduel).
  const switchTab = (next) => {
    if (next === tab) return
    setTab(next)
    setError('')
    setResult(null)
    setWarnings([])
    setProviders(null)
    setHasSearched(false)
  }

  // ----- ONGLET CODE-BARRES ---------------------------------------------------
  const valid = /^[0-9]{8,14}$/.test(code.trim())

  const lookup = async (e) => {
    e?.preventDefault()
    if (!valid) {
      setError('Le code-barres doit contenir entre 8 et 14 chiffres (EAN/UPC).')
      return
    }
    setError('')
    setResult(null)
    setBusy(true)
    try {
      // Le backend interroge MusicBrainz + Discogs en parallèle, puis résout la
      // fiche d'ALBUM Last.fm depuis l'identité « artiste + album » prioritaire :
      // une seule requête client.
      const { data, warnings: w, providers: p } = await api.musicbrainz.barcode(code.trim())
      setResult(data)
      setWarnings(Array.isArray(w) ? w : [])
      if (p) setProviders(p)
    } catch (err) {
      // 404 = disque inconnu des sources, 429/502 = incident d'infrastructure :
      // tous deux s'affichent tels quels.
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // ----- ONGLET MOTS-CLÉS ------------------------------------------------------
  const searchQuery = async (e) => {
    e?.preventDefault()
    if (busy || searching) return
    const value = query.replace(/\s+/g, ' ').trim()
    if (value.length < 2) {
      setError('Saisissez au moins 2 caractères : titre de l’album, « artiste titre », ou un n° EAN/UPC.')
      return
    }
    if (value.length > 300) {
      setError('Requête trop longue (300 caractères maximum).')
      return
    }
    setError('')
    setResult(null)
    setSearching(true)
    try {
      // CASCADE STRICTE côté serveur : 1. Last.fm (prioritaire, jaquettes) ->
      // 2. Discogs (seulement si Last.fm n'a rien trouvé) -> 3. MusicBrainz
      // (dernier recours). Fiche unique renvoyée.
      const { data, warnings: w, providers: p } = await api.musicbrainz.keyword(value)
      setResult(data)
      setWarnings(Array.isArray(w) ? w : [])
      if (p) setProviders(p)
      setHasSearched(true)
    } catch (err) {
      // 404 = aucune source ne connaît la parution, 429/502 = incident
      // d'infrastructure sur les sources actives : affichage tel quel.
      setError(err.message)
      setHasSearched(false)
    } finally {
      setSearching(false)
    }
  }

  const anyBusy = busy || searching

  // Badge « état par source » : found / not-found / not-configured / unavailable
  const providerBadge = (state) => {
    const [tone, label] =
      state === 'found'
        ? ['text-emerald-300 bg-emerald-500/10 border-emerald-500/30', '✓ trouvée']
        : state === 'unavailable'
          ? ['text-amber-300 bg-amber-500/10 border-amber-500/30', 'indisponible']
          : state === 'not-configured'
            ? ['text-slate-500 bg-slate-500/10 border-slate-500/30', 'non configurée']
            : ['text-slate-400 bg-slate-500/10 border-slate-500/30', 'absente']
    return (
      <span className={`shrink-0 text-[10px] font-semibold rounded px-1.5 py-0.5 border ${tone}`}>
        {label}
      </span>
    )
  }

  // Sous-titre de la fenêtre : état des sources configurées côté serveur
  // (les sources absentes sont signalées pour expliquer une fiche partielle).
  const activeNames = [
    ...(sourcesActive.lastfm ? ['Last.fm'] : []),
    'MusicBrainz',
    ...(sourcesActive.discogs ? ['Discogs'] : []),
  ]
  const subtitle =
    tab === 'barcode'
      ? `Saisissez le n° EAN/UPC de la pochette — pré-remplissage via ${activeNames.join(', ')}.`
      : `Titre de l’album, « artiste titre » ou n° EAN/UPC — cascade stricte : 1. Last.fm → 2. Discogs → 3. MusicBrainz (sources actives : ${activeNames.join(', ')}).`

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-night-950/80 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="card w-full max-w-xl p-6 shadow-2xl shadow-black/50 flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-extrabold text-white">Importer un Disque</h2>
            <p className="text-sm text-slate-400 mt-0.5">{subtitle}</p>
          </div>
          <button onClick={close} className="btn-ghost !p-1.5" aria-label="Fermer">✕</button>
        </div>

        {/* Onglets : Code-barres | Mots-clés (mêmes styles que la modale BD) */}
        <div className="flex gap-1 border-b border-night-600/60 mb-4" role="tablist" aria-label="Mode de recherche">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'barcode'}
            className={`px-3.5 py-2 text-sm font-bold rounded-t-lg transition-colors ${
              tab === 'barcode'
                ? 'bg-night-800/70 text-gold-300 border border-b-0 border-night-600/60'
                : 'text-slate-400 hover:text-white border border-transparent border-b-0'
            }`}
            onClick={() => switchTab('barcode')}
          >
            ⌗ Code-barres (EAN/UPC)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'query'}
            className={`px-3.5 py-2 text-sm font-bold rounded-t-lg transition-colors ${
              tab === 'query'
                ? 'bg-night-800/70 text-gold-300 border border-b-0 border-night-600/60'
                : 'text-slate-400 hover:text-white border border-transparent border-b-0'
            }`}
            onClick={() => switchTab('query')}
          >
            🔎 Mots-clés
          </button>
        </div>

        {/* ---------------------------- ONGLET CODE-BARRES --------------------- */}
        {tab === 'barcode' && (
          <form onSubmit={lookup} className="flex flex-wrap gap-2">
            <input
              className="input font-mono tracking-widest min-w-0"
              placeholder="Ex. 0190295958361"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              maxLength={14}
              autoFocus
            />
            <button className="btn-primary shrink-0" disabled={anyBusy || !valid}>
              {busy ? 'Recherche…' : 'Importer'}
            </button>
          </form>
        )}

        {/* ------------------------------ ONGLET MOTS-CLÉS --------------------- */}
        {tab === 'query' && (
          <div>
            <form onSubmit={searchQuery} className="flex flex-wrap gap-2">
              <input
                className="input min-w-0"
                placeholder="Ex. Pink Floyd — The Dark Side of the Moon (ou un n° EAN)…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={300}
                autoFocus
              />
              <button className="btn-primary shrink-0" disabled={anyBusy}>
                {searching ? 'Recherche…' : 'Rechercher'}
              </button>
            </form>
            <p className="text-[11px] text-slate-500 mt-1.5">
              Utilisable quand le code-barres échoue : titre de l’album, « artiste titre » ou n° EAN —
              ordre de recherche imposé : Last.fm d’abord (jaquettes), puis Discogs, puis MusicBrainz.
            </p>

            {/* Aucun disque trouvé (404 géré en erreur ci-dessous) */}
            {!error && hasSearched && !result && !searching && (
              <p className="mt-3 text-sm text-slate-500 bg-night-900/60 border border-night-600/60 rounded-lg px-3 py-2">
                Aucun disque trouvé pour cette recherche — essayez d’élargir la requête (titre seul,
                « artiste titre », ou le n° EAN exact de l’album).
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Avertissements non bloquants : une source a fourni la fiche mais
            l'une des sources actives a échoué (quota 429, jeton Discogs invalide…). */}
        {warnings.length > 0 && result && !error && (
          <div className="mt-3 text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2 space-y-1">
            <p className="font-semibold">Avertissements :</p>
            {warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        )}

        {result && !error && (
          <div className="mt-5 flex gap-4">
            <div className="w-28 h-28 shrink-0 rounded-lg overflow-hidden bg-night-900 border border-night-600">
              {result.cover_image ? (
                <img src={result.cover_image} alt="Aperçu jaquette" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center text-slate-600 text-xs">Aucune image</div>
              )}
            </div>
            <div className="flex-1 text-sm space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-white font-bold truncate" title={`${result.artist} – ${result.title}`}>
                  {result.artist} — {result.title}
                </p>
                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gold-300 bg-gold-500/10 border border-gold-500/30 rounded px-1.5 py-0.5">
                  {SOURCE_LABELS[result.source] || result.source || '—'}
                </span>
              </div>
              {/* État des sources (cascade : Last.fm prioritaire, MusicBrainz, Discogs) */}
              {providers && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    Last.fm {providerBadge(providers.lastfm)}
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    MusicBrainz {providerBadge(providers.musicbrainz)}
                  </span>
                  <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    Discogs {providerBadge(providers.discogs)}
                  </span>
                </div>
              )}
              <p className="text-slate-400 truncate">
                {[result.genre, result.release_date && String(result.release_date).slice(0, 4)]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {result.label && <p className="text-slate-500 truncate">Label : {result.label}</p>}
              <p className="text-slate-500">
                {toTrackCount(result.track_count) > 0
                  ? `${toTrackCount(result.track_count)} titre(s) détecté(s)`
                  : 'Aucune tracklist renvoyée : à compléter manuellement'}
              </p>
              {result.mbid && (
                <p className="text-slate-500 truncate font-mono text-[11px]" title={result.mbid}>
                  MBID : {result.mbid}
                </p>
              )}
              {result.discogs_release_id && result.discogs_url && (
                <a
                  href={result.discogs_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-[12px] text-gold-300 underline decoration-gold-500/40 hover:text-gold-200"
                >
                  Fiche Discogs #{result.discogs_release_id} ↗
                </a>
              )}
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={close}>Annuler</button>
          {result && (
            <button
              className="btn-primary"
              onClick={() => {
                // MÊME mapping vers le formulaire AddVinyl que le mode code-barres.
                const barcode = String(result.barcode || code).replace(/\D/g, '')
                const payload = {
                  barcode: /^\d{8,14}$/.test(barcode) ? barcode : '',
                  artist: result.artist,
                  title: result.title,
                  label: result.label,
                  genre: result.genre,
                  releaseDate: result.release_date || '',
                  tracklist: result.tracklist || '',
                  trackCount: toTrackCount(result.track_count),
                  coverRemoteUrl: result.cover_image || '',
                  // Identifiant MusicBrainz de la release (persisté avec le disque)
                  mbid: result.mbid || '',
                  // Identifiants Discogs (persistés avec le disque)
                  discogsReleaseId: result.discogs_release_id || '',
                  discogsUrl: result.discogs_url || '',
                  // Fiche Last.fm d'album — provenance PRIORITAIRE de la cascade :
                  // URL persistée avec le disque (champ « lastfm_url » backend).
                  lastfmUrl: result.lastfm_url || '',
                }
                close()
                onPrefill?.(payload)
              }}
            >
              Pré-remplir la fiche
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
