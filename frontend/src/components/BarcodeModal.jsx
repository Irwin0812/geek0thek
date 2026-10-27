import { useEffect, useState } from 'react'
import { api } from '../services/api.js'

/**
 * Boîte de dialogue « Import par code-barres » : saisie du barcode,
 * appel à l'API `/api/musicbrainz/barcode/:code` qui interroge
 * MusicBrainz (aucun jeton) ET Discogs (jeton requis) en parallèle
 * côté serveur, puis pré-remplissage du formulaire de création.
 *
 * La fiche MusicBrainz est la « de référence » (tracklist, MBID) ; les
 * données Discogs la complètent (date/label/genre manquants, miniature)
 * + identifiants Discogs (release id + URL de la fiche). Le champ
 * `source` de la réponse indique la source effective :
 *   'musicbrainz' | 'discogs' | 'musicbrainz+discogs'.
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

export default function BarcodeModal({ open, onClose, onPrefill }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [providers, setProviders] = useState(null) // { musicbrainz, discogs } états par source
  const [discogsActive, setDiscogsActive] = useState(true)

  // État Discogs côté serveur (jeton DISCOGS_TOKEN) : affiché dans le sous-titre
  // ; en l'absence de jeton, le backend ne l'interroge pas et renvoie la
  // fiche MusicBrainz seule (source: 'musicbrainz').
  useEffect(() => {
    if (!open) return
    let cancelled = false
    api.discogs
      .status()
      .then((s) => !cancelled && setDiscogsActive(Boolean(s && s.configured)))
      .catch(() => {})
    return () => { cancelled = true }
  }, [open])

  if (!open) return null

  const close = () => {
    setCode('')
    setError('')
    setResult(null)
    setWarnings([])
    setProviders(null)
    onClose()
  }

  const valid = /^[0-9]{8,14}$/.test(code.trim())

  const lookup = async (e) => {
    e?.preventDefault()
    const value = code.trim()
    if (!valid) {
      setError('Le code-barres doit contenir entre 8 et 14 chiffres (EAN/UPC).')
      return
    }
    setError('')
    setBusy(true)
    try {
      // Le backend interroge MusicBrainz + Discogs (si configuré) en parallèle
      // et renvoie la fiche fusionnée : une seule requête client.
      const { data, warnings: w, providers: p } = await api.musicbrainz.barcode(value)
      setResult(data)
      setWarnings(Array.isArray(w) ? w : [])
      setProviders(p && p.musicbrainz ? p : null)
    } catch (err) {
      // Remarques : un 503 « Discogs pas configuré » ne peut pas arriver ici —
      // le backend ne lève pas d'erreur quand Discogs est absent (il renvoie la
      // fiche MusicBrainz, source: 'musicbrainz'). Une 404 = disque inconnu des
      // deux sources, une 429/502 = incident d'infrastructure : tous deux
      // s'affichent tels quels.
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

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

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-night-950/80 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="card w-full max-w-lg p-6 shadow-2xl shadow-black/50">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-extrabold text-white">Import par code-barres</h2>
            <p className="text-sm text-slate-400 mt-0.5">
              {discogsActive
                ? 'Saisissez le n° EAN/UPC de la pochette : MusicBrainz et Discogs pré-remplissent la fiche.'
                : 'Saisissez le n° EAN/UPC de la pochette : pré-remplissage via MusicBrainz (Discogs non configuré).'}
            </p>
          </div>
          <button onClick={close} className="btn-ghost !p-1.5" aria-label="Fermer">✕</button>
        </div>

        <form onSubmit={lookup} className="flex gap-2">
          <input
            className="input font-mono tracking-widest"
            placeholder="Ex. 0190295958361"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            maxLength={14}
            autoFocus
          />
          <button className="btn-primary shrink-0" disabled={busy || !valid}>
            {busy ? 'Recherche…' : 'Importer'}
          </button>
        </form>

        {error && (
          <p className="mt-3 text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Avertissements non bloquants : une source a été trouvée mais
            l'autre a échoué (quota 429, jeton Discogs invalide 401, 502…). */}
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
                  {result.source === 'musicbrainz+discogs'
                    ? 'MusicBrainz + Discogs'
                    : result.source === 'discogs'
                      ? 'Discogs'
                      : 'MusicBrainz'}
                </span>
              </div>
              {providers && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
                const payload = {
                  barcode: result.barcode || code,
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
