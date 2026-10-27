import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'
import { useAuth } from '../App.jsx'
import VinylCard, { EmptyState } from '../components/VinylCard.jsx'
import ComicCard from '../components/ComicCard.jsx'
import ItemDetailModal from '../components/ItemDetailModal.jsx'
import { useDisplay } from '../services/display.jsx'
import { addedDateValue } from '../components/cards.js'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { settings } = useDisplay()
  const [vinyls, setVinyls] = useState([])
  const [comics, setComics] = useState([])
  const [detailVinyl, setDetailVinyl] = useState(null)
  const [detailComic, setDetailComic] = useState(null)
  const [loadError, setLoadError] = useState('')

  const load = async () => {
    try {
      const [v, c] = await Promise.all([api.vinyls.mine(), api.comics.mine()])
      setVinyls(v.vinyls)
      setComics(c.comics)
    } catch (err) {
      setLoadError(err.message)
    }
  }
  useEffect(() => { load() }, [])

  /**
   * « Derniers ajouts » : tri chronologique STRICT sur la date d'ajout métier
   * (vinyls.acquired_date / comics.added_date) — plus récent à GAUCHE, plus
   * ancien à droite. Second passage : les éléments sans date d'ajout valide
   * (lignes pré-migration) tombent sur created_at (ISO UTC, comparaison
   * lexicographique) pour un rendu stable et déterminant. La QUAINTITÉ
   * affichée par ligne est inchangée (4 colonnes).
   */
  const byAddedDate = (list) =>
    [...list].sort(
      (a, b) =>
        addedDateValue(b.addedDate) - addedDateValue(a.addedDate) ||
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
    )
  const latestVinyls = useMemo(() => byAddedDate(vinyls), [vinyls])
  const latestComics = useMemo(() => byAddedDate(comics), [comics])

  const stats = useMemo(() => {
    const artists = new Set(vinyls.map((v) => (v.artist || '').toLowerCase()).filter(Boolean))
    const genres = new Set(vinyls.map((v) => (v.genre || '').toLowerCase()).filter(Boolean))
    // Dernier ajout de disque : tri strict sur la DATE D'AJOUT métier
    // (colonne acquired_date), pas l'horodatage technique created_at.
    const latest = [...vinyls].sort(
      (a, b) => addedDateValue(b.addedDate) - addedDateValue(a.addedDate)
    )[0]
    const series = new Set(comics.map((c) => (c.series || '').toLowerCase()).filter(Boolean))
    const authors = new Set(
      comics.flatMap((c) => (c.authors || '').split(',').map((a) => a.trim().toLowerCase())).filter(Boolean)
    )
    // Dernier ajout de BD : tri strict sur la DATE D'AJOUT métier
    // (colonne added_date), pas l'horodatage technique created_at.
    const latestComic = [...comics].sort(
      (a, b) => addedDateValue(b.addedDate) - addedDateValue(a.addedDate)
    )[0]
    return {
      total: vinyls.length,
      artists: artists.size,
      genres: genres.size,
      latest,
      comics: { total: comics.length, series: series.size, authors: authors.size, latest: latestComic },
    }
  }, [vinyls, comics])

  /** Formate une date ISO en jj/mm/aaaa (temps local), ou null si invalide. */
  const formatFrDate = (value) => {
    if (!value) return null
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return null
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    return `${day}/${month}/${d.getFullYear()}`
  }

  return (
    // Espacement resserré en Full HD : les couvertures plafonnées à max-h-56
    // + un espace inter-sections réduit tiennent sans scroll excessif.
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-8 xl:space-y-6">
      {/* Modale de détail (clic sur carte) */}
      <ItemDetailModal type="vinyl" item={detailVinyl} onClose={() => setDetailVinyl(null)} onEdit={(v) => { setDetailVinyl(null); navigate(`/vinyles/${v.id}`) }} />
      <ItemDetailModal type="comic" item={detailComic} onClose={() => setDetailComic(null)} onEdit={(c) => { setDetailComic(null); navigate(`/comics/${c.id}`) }} />

      {/* En-tête */}
      <section>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h1 className="text-2xl md:text-3xl font-bold text-white">
            {t('dashboard.greeting', { name: user.firstName })}
          </h1>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Link to="/vinyles/nouveau" className="btn-primary">{t('dashboard.addVinyl')}</Link>
            <Link to="/comics/nouveau" className="btn-primary">{t('dashboard.addComic')}</Link>
          </div>
        </div>
      </section>

      {/* Statistiques */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label={t('dashboard.stats.vinyls')} value={stats.total} accent size="sm" />
        <StatCard label={t('dashboard.stats.artists')} value={stats.artists} size="sm" />
        <StatCard label={t('dashboard.stats.genres')} value={stats.genres} size="sm" />
        {/* « Dernier Ajout » Disques : titre puis artiste, et la DATE
            D'AJOUT (JJ/MM/AAAA) affichée en dessous — tuile au style IDENTIQUE
            à celle des Bandes Dessinées (même composant LatestAddCard). */}
        <LatestAddCard
          item={stats.latest}
          lines={stats.latest ? [stats.latest.title, stats.latest.artist] : []}
          empty={t('dashboard.noVinyl')}
          addedDate={stats.latest?.addedDate}
          formatDate={formatFrDate}
        />
        <StatCard label={t('dashboard.stats.comics')} value={stats.comics.total} accent size="sm" />
        <StatCard label={t('dashboard.stats.series')} value={stats.comics.series} size="sm" />
        <StatCard label={t('dashboard.stats.comicAuthors')} value={stats.comics.authors} size="sm" />
        <LatestAddCard
          item={stats.comics.latest}
          lines={stats.comics.latest ? comicLatestLines(stats.comics.latest, t) : []}
          empty={t('dashboard.noComic')}
          addedDate={stats.comics.latest?.addedDate}
          formatDate={formatFrDate}
        />
      </section>

      {/* Derniers ajouts */}
      <section>
        <h2 className="text-lg font-bold text-white mb-4">{t('dashboard.latestAdds')}</h2>
        {loadError ? (
          <p className="text-sm text-rose-400">{loadError}</p>
        ) : (
          <div className="space-y-8">
            {/* Disques */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-200">{t('dashboard.vinylsSection')}</h3>
                <Link to="/collection" className="text-sm text-gold-400 hover:text-gold-300">{t('common.viewAll')}</Link>
              </div>
              {vinyls.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <EmptyState
                    title={t('dashboard.emptyVinylTitle')}
                    subtitle={t('dashboard.emptyVinylSubtitle')}
                    action={<Link to="/vinyles/nouveau" className="btn-primary">{t('dashboard.addVinyl')}</Link>}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {latestVinyls.slice(0, 4).map((v) => (
                    <VinylCard
                      key={v.id}
                      vinyl={v}
                      size="sm"
                      view={settings.jukebox ? 'jukebox' : 'card'}
                      showTitle={settings.showTitle}
                      showYear={settings.showYear}
                      showAddedDate
                      onClick={() => setDetailVinyl(v)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* BDs */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-slate-200">{t('dashboard.comicsSection')}</h3>
                <Link to="/comics" className="text-sm text-gold-400 hover:text-gold-300">{t('common.viewAll')}</Link>
              </div>
              {comics.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <EmptyState
                    title={t('dashboard.emptyComicTitle')}
                    subtitle={t('dashboard.emptyComicSubtitle')}
                    action={<Link to="/comics/nouveau" className="btn-primary">{t('dashboard.addComic')}</Link>}
                  />
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {latestComics.slice(0, 4).map((c) => (
                    <ComicCard
                      key={c.id}
                      comic={c}
                      size="sm"
                      view={settings.jukebox ? 'jukebox' : 'card'}
                      showTitle={settings.showTitle}
                      showYear={settings.showYear}
                      showAddedDate
                      onClick={() => setDetailComic(c)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

/**
 * Lignes de la carte « Dernier ajout » BD : la série d'abord,
 * puis le titre de l'album. Si le titre n'est qu'un numéro
 * (ex : "1"), on affiche « Tome N » pour rester lisible.
 */
function comicLatestLines(comic, t) {
  const series = (comic.series || '').trim()
  const title = (comic.title || '').trim()
  const album = /^\d{1,3}$/.test(title) ? t('dashboard.volume', { number: title }) : title
  return [series, album].filter(Boolean)
}

function StatCard({ label, value, sub, accent = false, size = 'md' }) {
  const compact = size === 'sm'
  return (
    <div className={`card ${compact ? 'p-3' : 'p-4'} ${accent ? 'border-gold-500/30' : ''}`}>
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 font-extrabold ${compact ? 'text-2xl' : 'text-3xl'} ${accent ? 'text-gold-400' : 'text-white'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500 truncate">{sub}</p>}
    </div>
  )
}

/**
 * Carte « Dernier ajout » (Disques et Bandes Dessinées) : empilement
 * vertical des informations — 1/2. les lignes principales en blanc, tronquées
 * (titre + artiste pour un disque ; série/tome pour une BD), puis
 * 3. la DATE D'AJOUT métier (addedDate) en JJ/MM/AAAA sous le titre et
 * l'artiste — grise, non tronquée (une date complète tient toujours). La date
 * affichée est la DATE D'AJOUT métier (colonne added_date / acquired_date) —
 * et non l'horodatage technique created_at.
 */
function LatestAddCard({ item, lines, empty, addedDate = null, formatDate }) {
  const { t } = useTranslation()
  const date = addedDate && formatDate ? formatDate(addedDate) : null
  return (
    <div className="card p-3">
      <p className="text-xs uppercase tracking-wider text-slate-500">{t('dashboard.latestAdd')}</p>
      {item ? (
        <div className="mt-1 space-y-0.5">
          {lines.filter(Boolean).map((line, i) => (
            <p key={i} className="text-sm font-bold text-white truncate" title={line}>{line}</p>
          ))}
          <p className="text-sm text-slate-400" aria-hidden={!date}>{date ?? '—'}</p>
        </div>
      ) : (
        <p className="mt-1 text-sm text-slate-500">{empty}</p>
      )}
    </div>
  )
}
