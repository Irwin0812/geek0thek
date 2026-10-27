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
import { useDismiss } from '../components/hooks.js'

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
      // « Derniers ajouts » par type (grilles de cartes) : source des grilles
      // sous la section « Derniers ajouts », chargées en parallèle.
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
    const series = new Set(comics.map((c) => (c.series || '').toLowerCase()).filter(Boolean))
    const authors = new Set(
      comics.flatMap((c) => (c.authors || '').split(',').map((a) => a.trim().toLowerCase())).filter(Boolean)
    )
    return {
      total: vinyls.length,
      artists: artists.size,
      genres: genres.size,
      comics: { total: comics.length, series: series.size, authors: authors.size },
    }
  }, [vinyls, comics])

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
          {/* BOUTON UNIQUE « Ajouter un média » : remplace les deux anciens
              boutons séparés (« Ajouter un disque » + « Ajouter une BD »).
              Menu déroulant listant tous les types — Disque / BD actifs,
              Livres / Jeux de rôle-plateaux / Jeux vidéo déjà présents,
              grisés tant que leur page d'ajout n'est pas prête. */}
          <AddMediaDropdown />
        </div>
      </section>

      {/* Statistiques — GRILLE DU DASHBOARD en 3 COLONNES × 3 TUILES (spec) :
          Colonne 1 (gauche)  : DISQUES / ARTISTES-GROUPES / GENRES
          Colonne 2 (milieu)  : BANDES DESSINÉES / AUTEURS BD / SÉRIES
          Colonne 3 (droite)  : JEUX VIDÉO / JEUX DE RÔLE-PLATEAU / LIVRES-MAGAZINES
                                — bases de données NON MIGRÉES : valeur textuelle
                                « À venir » en GRIS CLAIR, à remplacer par les
                                vrais compteurs dès l'ouverture des collections.
          Les 9 tuiles partagent le MÊME composant StatCard : même format et
          même style (centrage H+V), et la même hauteur stricte (flex-1).
          Mobile : grille mono-colonne, les tuiles s'empilent dans l'ordre
          CSS ci-dessous (colonne 1, puis colonne 2, puis colonne 3). */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Colonne 1 (gauche) — disques : 3 tuiles empilées verticalement.
            h-full sur la colonne + flex-1 sur chaque StatCard = hauteurs
            STRICTEMENT identiques des 9 tuiles, quel que soit le contenu. */}
        <div className="flex h-full flex-col gap-4">
          <StatCard label={t('dashboard.stats.vinyls')} value={stats.total} accent />
          <StatCard label={t('dashboard.stats.artists')} value={stats.artists} />
          <StatCard label={t('dashboard.stats.genres')} value={stats.genres} />
        </div>
        {/* Colonne 2 (milieu) — bandes dessinées : 3 tuiles empilées verticalement. */}
        <div className="flex h-full flex-col gap-4">
          <StatCard label={t('dashboard.stats.comics')} value={stats.comics.total} accent />
          <StatCard label={t('dashboard.stats.comicAuthors')} value={stats.comics.authors} />
          <StatCard label={t('dashboard.stats.series')} value={stats.comics.series} />
        </div>
        {/* Colonne 3 (droite) — futures bibliothèques (MEDIA_SOURCES backend,
            tables non migrées) : MÊMES StatCard que les colonnes 1 et 2, avec
            une valeur textuelle « À venir » en GRIS CLAIR (prop `muted`) à la
            place du compteur numérique.
            Quand chaque collection ouvrira : passer le vrai number dans
            `value` et retirer `muted` — rien d'autre à changer. */}
        <div className="flex h-full flex-col gap-4">
          <StatCard label={t('dashboard.stats.videoGames')} value={t('dashboard.addMedia.soon')} muted />
          <StatCard label={t('dashboard.stats.boardGames')} value={t('dashboard.addMedia.soon')} muted />
          <StatCard label={t('dashboard.stats.books')} value={t('dashboard.addMedia.soon')} muted />
        </div>
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
 * TUILE COMPTEUR DU DASHBOARD — bloc SUPERIEUR en GRILLE 3 COLONNES × 3 TUILES
 * (spec) : 6 compteurs actifs (Disques, Artistes/Groupes, Genres, BD, Auteurs
 * BD, Séries) + 3 tuiles « À venir » grises dans la colonne de droite (Jeux
 * vidéo, Jeux de Rôle-Plateau, Livres-Magazines — bases non migrées).
 * CENTRAGE : contenu centré horizontalement ET verticalement dans la tuile —
 * `flex flex-col items-center justify-center text-center` sur le conteneur.
 * `accent` : bordure/texte doré pour les deux « TOTAUX » (Disques, BD) ;
 * `muted` : valeur textuelle en GRIS CLAIR à la place du compteur (tuiles « à
 * venir », en prévision des futures bases de données). Toutes les 9 tuiles
 * partagent CE composant : même format, même style et même hauteur stricte
 * (flex-1) au sein de chaque colonne. Les cartes de la section basse « Derniers
 * ajouts » (jaquettes / couvertures) sont des composants distincts, NON
 * concernés par ce centrage.
 */
function StatCard({ label, value, accent = false, muted = false }) {
  return (
    <div className={`card p-4 flex-1 flex flex-col items-center justify-center text-center ${accent ? 'border-gold-500/30' : ''}`}>
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-3xl font-extrabold ${muted ? 'text-slate-500' : accent ? 'text-gold-400' : 'text-white'}`}>{value}</p>
    </div>
  )
}

/**
 * BOUTON UNIQUE « Ajouter un média » (header du tableau de bord).
 * FUSIONNE les anciens boutons séparés « Ajouter un disque » /
 * « Ajouter une BD » en un seul déclencheur + menu déroulant, prêt à
 * accueillir les futures collections sans toucher au layout :
 *   - Disque            -> /vinyles/nouveau  (actif)
 *   - BD                -> /comics/nouveau   (actif)
 *   - Livre             -> à venir           (grisé jusqu'à l'ouverture)
 *   - Jeu de Rôle/Plateaux -> à venir        (idem)
 *   - Jeu vidéo         -> à venir           (idem)
 * Les types non prêts sont grisés + badge « à venir » : structure
 * anticipée, désactivés tant que le routeur n'expose pas leurs pages.
 * Fermeture au clic extérieur / touche Échap via `useDismiss` — la ref
 * est posée sur le conteneur englobant déclencheur + panneau (mêmes
 * règles que les menus déroulant du Navbar).
 * Z-INDEX : le panneau absolu porte `z-50` impératif — il sort du
 * stacking context racine de la page (aucun ancêtre positionné n'a de
 * z-index, donc tous ses ancêtres partagent auto/0) et s'affiche au-dessus
 * des tuiles du dashboard suivantes / cartes / modales.
 */
function AddMediaDropdown() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))

  /**
   * Catalogue des options d'ajout, dans l'ordre du menu :
   *  - `label`         traduction (les clés existent déjà — i18n dashboard.addMedia.*) ;
   *  - `to`            route d'ajout (clic -> navigate, le chemin est aussi la
   *                    clé d'index stable de l'entrée) ;
   *  - `enabled`       false tant que la page d'ajout du type n'est pas
   *                    disponible : l'entrée reste AFFICHÉE mais grise +
   *                    badge « à venir » (option « par anticipation » de la spec).
   * Pour brancher un nouveau type : créer sa route dans App.jsx puis passer
   * `enabled: true` ici — c'est tout.
   */
  const options = [
    { to: '/vinyles/nouveau', label: t('dashboard.addMedia.vinyl'), enabled: true },
    { to: '/comics/nouveau', label: t('dashboard.addMedia.comic'), enabled: true },
    { to: '/livres/nouveau', label: t('dashboard.addMedia.book'), enabled: false },
    { to: '/jeux-de-mesa/nouveau', label: t('dashboard.addMedia.boardGame'), enabled: false },
    { to: '/jeux-video/nouveau', label: t('dashboard.addMedia.videoGame'), enabled: false },
  ]

  const pick = (opt) => {
    setOpen(false) // ferme AVANT la navigation (re-rendu / démontage propres)
    if (opt.enabled) navigate(opt.to)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!options.some((o) => o.enabled)}
        className={`btn-primary ${open ? 'ring-2 ring-gold-500/40' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span aria-hidden="true">+</span>
        {t('dashboard.addMedia.title')}
        {/* Chevron qui pivote à l'ouverture (même modèle que « Autres Collections »). */}
        <span
          aria-hidden="true"
          className={`text-xs leading-none transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          ▾
        </span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('dashboard.addMedia.title')}
          /* Z-INDEX IMPÉRATIF (z-50) : les tuiles .card du dashboard (backdrop-blur-sm
             + fond semi-transparent) créent des contextes d'empilement qui se peignent
             dans l'ordre du DOM, APRÈS le wrapper du bouton — sans z explicite, le
             panneau absolu (z auto/0) se retrouvait donc en-dessous. z-50 le sort de
             ce conflit et le place au-dessus de toutes les tuiles / cartes suivantes
             (niveau partagé avec les modales du codebase). */
          className="absolute right-0 top-full z-50 mt-1.5 w-72 max-w-[calc(100vw-2rem)] card !p-1.5 shadow-2xl shadow-black/50"
        >
          {options.map((opt) => (
            <button
              key={opt.to}
              type="button"
              role="menuitem"
              disabled={!opt.enabled}
              onClick={() => pick(opt)}
              title={opt.enabled ? undefined : t('dashboard.addMedia.soon')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                opt.enabled
                  ? 'text-slate-200 hover:bg-night-700/60 hover:text-white'
                  : 'cursor-not-allowed text-slate-500 hover:bg-transparent'
              }`}
            >
              <span className="truncate">{opt.label}</span>
              {!opt.enabled && (
                <span className="ml-auto shrink-0 rounded-full bg-night-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                  {t('dashboard.addMedia.soon')}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
