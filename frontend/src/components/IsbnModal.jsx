/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'

// Libellés des sources (une fiche peut être la fusion des deux quand
// Google Books est incomplet et qu'Open Library a complété les vides).
const SOURCE_LABELS = {
  google_books: 'Google Books',
  open_library: 'Open Library',
  'google_books+open_library': 'Google Books + Open Library',
}

/**
 * Boîte de dialogue « Remplir via ISBN / mots-clés » : DEUX modes de
 * recherche qui coexistent à l'aide d'ONGLETS, sans conflit :
 *
 *  - ONGLET « ISBN / Code-barres » — saisie d'un ISBN avec DEUX modes d'action :
 *    * MODE 1 — PRÉ-REMPLISSAGE (bouton « Chercher ») : appel à l'API lookup
 *      (api.isbn.lookup, Google Books / Open Library) et pré-remplissage du
 *      formulaire de création via « Pré-remplir la fiche ». Le champ
 *      `cover_image` renvoyé est l'URL distante de la couverture : le backend
 *      la télécharge et la stocke localement (/uploads/comics/...) lors de la
 *      création de la BD (coverRemoteUrl). Pré-remplit TOUS les champs du
 *      formulaire : coverRemoteUrl, title, series, tomeNumber, authors,
 *      illustrators, publisher, releaseDate, genre, isbn et synopsis.
 *    * MODE 2 — IMPORT DIRECT (bouton « Importer par code-barres ») : appel à
 *      api.comics.importByIsbn(isbn) — le backend cherche l'ISBN et CRÉE la BD
 *      directement (couverture téléchargée localement, association à sa série).
 *      Le rappel onImport(comic) prend ensuite la main (navigation + toast).
 *  - ONGLET « Recherche par mots-clés » — secours quand l'ISBN / code-barres
 *    échoue : saisie d'une requête TEXTUELLE libre (titre de la BD, auteur,
 *    série…) envoyée à api.isbn.search (/api/isbn/search?q=… -> Google Books
 *    `q=...`). L'API renvoie UNE LISTE de fiches normalisées : l'utilisateur
 *    choisit la bonne bande dessinée dans la grille de sélection (couverture,
 *    titre, série+tome, auteurs, éditeur, date, générique, ISBN), puis le
 *    bloc d'action « Pré-remplir la fiche » s'affiche — MÊME mapping vers le
 *    formulaire AddComic que le mode ISBN.
 */
export default function IsbnModal({ open, onClose, onPrefill, onImport }) {
  const { t } = useTranslation()

  // ---- onglet actif : 'isbn' (défaut) | 'query' -------------------------
  const [tab, setTab] = useState('isbn')

  // ---- ONGLET ISBN / CODE-BARRES ----------------------------------------
  const [isbn, setIsbn] = useState('')
  const [busy, setBusy] = useState(false) // mode 1 : lookup (pré-remplissage)
  const [importing, setImporting] = useState(false) // mode 2 : import direct par code-barres

  // ---- ONGLET RECHERCHE PAR MOTS-CLÉS -----------------------------------
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [hasSearched, setHasSearched] = useState(false) // une recherche mots-clés a eu lieu
  const [results, setResults] = useState([]) // fiches normalisées (200 + [] si vide)

  // ---- état partagé -------------------------------------------------------
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) // fiche sélectionnée (les deux onglets)
  const [activeIsbn, setActiveIsbn] = useState('') // ISBN en cours de pré-remplissage

  if (!open) return null

  const close = () => {
    setIsbn('')
    setQuery('')
    setError('')
    setResult(null)
    setHasSearched(false)
    setResults([])
    onClose()
  }

  const digits = isbn.replace(/\D/g, '')
  const validIsbn = digits.length === 13 || /^\d{9}[\dXx]$/.test(digits)

  // Changement d'onglet : on réinitialise l'erreur et la fiche sélectionnée
  // (les résultats mots-clés sont conservés : basculer ne refait pas l'appel).
  const switchTab = (next) => {
    if (next === tab) return
    setTab(next)
    setError('')
    setResult(null)
  }

  // ----- ONGLET ISBN --------------------------------------------------------

  const lookup = async (e) => {
    e?.preventDefault()
    if (busy || importing) return // un seul appel à la fois (modes 1 et 2 exclusifs)
    const value = digits
    if (!validIsbn) {
      setError(t('isbnModal.errorInvalidIsbn'))
      return
    }
    setError('')
    setResult(null)
    setBusy(true)
    try {
      const { data } = await api.isbn.lookup(value)
      setActiveIsbn(value)
      setResult(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // MODE 2 : IMPORT DIRECT PAR CODE-BARRES — la BD est créée côté backend
  // (POST /comics/import/isbn/:isbn : Google Books d'abord, Open Library en
  // secours ; couverture téléchargée localement, rattachement à sa série).
  // Le résultat doit être CONSOMMÉ par le parent (onImport) : navigation vers
  // la collection + toast de confirmation — on ne « pré-remplit » jamais après.
  const importDirect = async (e) => {
    e?.preventDefault()
    if (!validIsbn || busy || importing) return
    setError('')
    setImporting(true)
    try {
      const { comic } = await api.comics.importByIsbn(digits)
      close()
      onImport?.(comic)
    } catch (err) {
      setError(err.message)
    } finally {
      setImporting(false)
    }
  }

  // ----- ONGLET RECHERCHE PAR MOTS-CLÉS ------------------------------------

  const searchQuery = async (e) => {
    e?.preventDefault()
    if (searching || busy || importing) return // exclusif avec les appels ISBN
    const value = query.replace(/\s+/g, ' ').trim()
    if (value.length < 2) {
      setError(t('isbnModal.minCharsError'))
      return
    }
    setError('')
    setResult(null)
    setSearching(true)
    try {
      const { data } = await api.isbn.search(value, 10)
      // 200 + data: [] = aucun volume (résultat valide, pas une erreur).
      setResults(Array.isArray(data) ? data : [])
      setHasSearched(true)
    } catch (err) {
      setError(err.message)
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  // Choix d'une fiche de la grille mots-clés -> bloc d'action « Pré-remplir ».
  const pickResult = (item) => {
    setError('')
    setResult(item)
    // ISBN de la fiche si Google l'a fourni, sinon l'ISBN saisi sur l'autre
    // onglet (l'utilisateur peut l'avoir combiné à sa recherche texte).
    setActiveIsbn(String(item.isbn ?? '').replace(/[^0-9xX]/g, '') || digits)
  }

  const anyBusy = busy || importing || searching

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-night-950/80 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div className="card w-full max-w-xl p-6 shadow-2xl shadow-black/50 flex flex-col max-h-[90vh]">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-extrabold text-white">{t('isbnModal.title')}</h2>
            <p className="text-sm text-slate-400 mt-0.5">
              {t('isbnModal.subtitle')}
            </p>
          </div>
          <button onClick={close} className="btn-ghost !p-1.5" aria-label={t('common.close')}>✕</button>
        </div>

        {/* Onglets : ISBN / Code-barres | Recherche par mots-clés */}
        <div className="flex gap-1 border-b border-night-600/60 mb-4" role="tablist" aria-label={t('isbnModal.searchModeLabel')}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'isbn'}
            className={`px-3.5 py-2 text-sm font-bold rounded-t-lg transition-colors ${
              tab === 'isbn'
                ? 'bg-night-800/70 text-gold-300 border border-b-0 border-night-600/60'
                : 'text-slate-400 hover:text-white border border-transparent border-b-0'
            }`}
            onClick={() => switchTab('isbn')}
          >
            {t('isbnModal.tabIsbn')}
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
            {t('isbnModal.tabQuery')}
          </button>
        </div>

        {/* ------------------------------ ONGLET ISBN ----------------------- */}
        {tab === 'isbn' && (
          <form onSubmit={lookup} className="flex flex-wrap gap-2">
            <input
              className="input font-mono tracking-widest min-w-0"
              placeholder={t('isbnModal.isbnPlaceholder')}
              inputMode="numeric"
              value={isbn}
              onChange={(e) => setIsbn(e.target.value.replace(/[^0-9xX]/g, ''))}
              maxLength={17}
              autoFocus
            />
            <button className="btn-primary shrink-0" disabled={anyBusy || !validIsbn}>
              {busy ? t('common.searching') : t('isbnModal.searchBtn')}
            </button>
            {/* MODE 2 — IMPORT DIRECT PAR CODE-BARRES : création immédiate de la
                BD côté backend (api.comics.importByIsbn) ; le parent prend la
                main via onImport (navigation + toast). Coexiste sans conflit
                avec « Chercher » (mode 1, pré-remplissage du formulaire). */}
            <button type="button" className="btn-ghost shrink-0" onClick={importDirect} disabled={anyBusy || !validIsbn}>
              {importing ? t('isbnModal.importing') : t('isbnModal.importByBarcode')}
            </button>
          </form>
        )}

        {/* ------------------- ONGLET RECHERCHE PAR MOTS-CLÉS --------------- */}
        {tab === 'query' && (
          <div>
            <form onSubmit={searchQuery} className="flex flex-wrap gap-2">
              <input
                className="input min-w-0"
                placeholder={t('isbnModal.queryPlaceholder')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                maxLength={300}
                autoFocus
              />
              <button className="btn-primary shrink-0" disabled={anyBusy}>
                {searching ? t('common.searching') : t('common.search')}
              </button>
            </form>
            <p className="text-[11px] text-slate-500 mt-1.5">
              {t('isbnModal.queryHint')}
            </p>

            {/* Grille de sélection des résultats (200 + [] = aucun volume) */}
            {!error && results.length > 0 && !searching && (
              <div className="mt-3 max-h-64 overflow-y-auto border border-night-600/60 rounded-lg">
                {results.map((item, i) => (
                  <button
                    key={item.isbn || `${item.title}-${i}`}
                    type="button"
                    onClick={() => pickResult(item)}
                    className={`w-full flex gap-3 items-center text-left px-3 py-2 border-b border-night-700/40 last:border-b-0 transition-colors ${
                      result === item ? 'bg-gold-500/10' : 'hover:bg-night-800/60'
                    }`}
                  >
                    <span className="w-10 h-14 shrink-0 overflow-hidden rounded border border-night-600 bg-night-900">
                      {item.cover_image ? (
                        <img src={item.cover_image} alt="" loading="lazy" className="w-full h-full object-cover" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1 text-sm space-y-0.5">
                      <span className="block font-semibold text-white truncate">{item.title || t('isbnModal.noTitle')}</span>
                      {(item.series || item.tome_number) && (
                        <span className="block text-gold-300 truncate text-xs">
                          {[item.series, item.tome_number ? t('isbnModal.volume', { number: item.tome_number }) : ''].filter(Boolean).join(' · ')}
                        </span>
                      )}
                      <span className="block text-slate-400 truncate text-xs">
                        {[item.authors, item.publisher].filter(Boolean).join(' · ')}
                      </span>
                      <span className="block text-slate-600 text-[11px] font-mono flex items-center gap-2">
                        <span>{[item.release_date, item.isbn ? t('isbnModal.isbnField', { isbn: item.isbn }) : ''].filter(Boolean).join(' · ') || '—'}</span>
                        {/* Provenance de la fiche : Google Books seul, Open
                            Library (cascade) ou fusion des deux. */}
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-night-600/70 text-slate-500">
                          {SOURCE_LABELS[item.source] || 'Open Library'}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* Aucun volume trouvé (200 + []), affiché uniquement après une recherche */}
            {!error && hasSearched && results.length === 0 && !searching && (
              <p className="mt-3 text-sm text-slate-500 bg-night-900/60 border border-night-600/60 rounded-lg px-3 py-2">
                {t('isbnModal.noResults')}
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-3 text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {/* Fiche sélectionnée (onglet ISBN : le lookup direct ; onglet mots-clés :
            le choix dans la grille ci-dessus) -> bouton « Pré-remplir la fiche ». */}
        {result && !error && (
          <div className="mt-5 flex gap-4">
            <div className="w-24 shrink-0 aspect-[2/3] rounded-lg overflow-hidden bg-night-900 border border-night-600">
              {result.cover_image ? (
                <img src={result.cover_image} alt={t('isbnModal.coverPreview')} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center text-slate-600 text-xs text-center px-2">{t('common.noImage')}</div>
              )}
            </div>
            <div className="flex-1 text-sm space-y-1 min-w-0">
              <p className="text-white font-bold truncate" title={result.title}>
                {result.title || t('isbnModal.noTitle')}
              </p>
              {(result.series || result.tome_number) && (
                <p className="text-gold-300 truncate">
                  {[result.series, result.tome_number ? t('isbnModal.volume', { number: result.tome_number }) : ''].filter(Boolean).join(' · ')}
                </p>
              )}
              <p className="text-slate-400 truncate">
                {[result.authors, result.illustrators ? t('isbnModal.drawingsBy', { names: result.illustrators }) : '', result.publisher].filter(Boolean).join(' · ')}
              </p>
              <p className="text-slate-500">
                {[result.release_date, result.genre].filter(Boolean).join(' · ')}
              </p>
              {result.isbn && (
                <p className="text-[11px] text-slate-600 font-mono">
                  {t('isbnModal.isbnField', { isbn: result.isbn })}
                </p>
              )}
              {result.synopsis && (
                <p
                  className="text-[11px] text-slate-500 italic line-clamp-2"
                  title={result.synopsis}
                >
                  {result.synopsis}
                </p>
              )}
              <p className="text-[11px] text-slate-600">
                {t('isbnModal.sourceLabel')} : {SOURCE_LABELS[result.source] || 'Open Library'}
              </p>
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button className="btn-ghost" onClick={close}>{t('common.cancel')}</button>
          {result && (
            <button
              className="btn-primary"
              onClick={() => {
                // Mapping exhaustif de TOUS les champs de la réponse API vers
                // le formulaire AddComic (noms camelCase du payload attendu) :
                //   coverRemoteUrl <- cover_image (URL distante : le backend
                //                     la télécharge en /uploads/comics/ à
                //                     l'enregistrement de la BD)
                //   title          <- title
                //   series         <- series
                //   tomeNumber     <- tome_number
                //   authors        <- authors
                //   illustrators   <- illustrators
                //   publisher      <- publisher
                //   releaseDate    <- release_date (AAAA-MM-JJ strict)
                //   genre          <- genre
                //   condition      <- condition (état, valeur standard de l'API)
                //   isbn           <- isbn
                //   synopsis       <- synopsis (résumé nettoyé)
                const clean = (v) =>
                  (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim())
                const releaseDate = clean(result.release_date)
                const payload = {
                  // 1. Couverture : URL distante (Google Books / Open Library)
                  coverRemoteUrl: clean(result.cover_image),
                  // 2. Titre de l'album
                  title: clean(result.title),
                  // 3. Série
                  series: clean(result.series),
                  // 4. Tome / numéro
                  tomeNumber: clean(result.tome_number),
                  // 5. Auteur(s)
                  authors: clean(result.authors),
                  // 6. Dessinateur(s)
                  illustrators: clean(result.illustrators),
                  // 7. Éditeur
                  publisher: clean(result.publisher),
                  // 8. Date de parution — le formulaire attend un AAAA-MM-JJ strict (input type="date")
                  releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate : '',
                  // 9. Genre
                  genre: clean(result.genre),
                  // 10. ISBN
                  isbn: clean(result.isbn) || activeIsbn,
                  // 11. État (valeur standard fournie par le backend)
                  condition: clean(result.condition),
                  // 12. Synopsis (résumé nettoyé, champ optionnel du formulaire)
                  synopsis: clean(result.synopsis),
                }
                close()
                onPrefill?.(payload)
              }}
            >
              {t('common.prepopulateSheet')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
