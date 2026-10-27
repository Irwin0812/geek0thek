import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'
import { useAuth } from '../App.jsx'
import VinylCard, { EmptyState } from '../components/VinylCard.jsx'
import ComicCard from '../components/ComicCard.jsx'
import ItemDetailModal from '../components/ItemDetailModal.jsx'
import { useDisplay } from '../services/display.jsx'
import { addedDateValue, addedDateFr } from '../components/cards.js'
import { useDismiss } from '../components/hooks.js'

export default function Dashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { settings } = useDisplay()
  const [vinyls, setVinyls] = useState([])
  const [comics, setComics] = useState([])
  // Tuile UNIQUE « Dernier ajout » (tous médias confondus) : renvoyée par
  // GET /api/dashboard — { counts, lastAdd: { id, mediaType, title, addedDate, item } }.
  const [latestAdd, setLatestAdd] = useState(null)
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
    // Tuile UNIQUE « Dernier ajout » GLOBAL — chargée en PARALLÈLE, et sa
    // défaite n'empêche JAMAIS le reste du dashboard (état vide propre :
    // « Aucun média… ») ; l'agrégat est non bloquant côté backend.
    api.dashboard
      .latest()
      .then((d) => setLatestAdd(d.lastAdd || null))
      .catch(() => setLatestAdd(null))
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

  /**
   * Champ « NOM » de la tuile unique « Dernier ajout », déduit du type de
   * médias (meta du backend, clé = MEDIA_SOURCES) et de son DTO normalisé :
   *  - Disque          -> Groupe / Artiste (item.artist) ;
   *  - BD              -> Auteurs (item.authors, premier séparateur) ;
   *  - Futures tables  -> « Nom » unique attendu par convention backend :
   *      books       -> item.author     (Auteur)
   *      boardGames  -> item.publisher  (Maison d'édition / éditeur)
   *      videoGames  -> item.platform   (Plateforme)
   */
  const latestName = useMemo(() => {
    if (!latestAdd) return null
    const item = latestAdd.item || {}
    switch (latestAdd.mediaType) {
      case 'comics':
        // Auteurs : séparateur / — premier auteur affiché, reste en infobulle.
        return String(item.authors || '').split('/')[0].trim() || null
      default:
        // Disques ET futures bibliothèques : champ nommant l'element,
        // harmonisé « artist » (vinyl DTO), ou convention author/publisher/
        // platform des modules à venir (décommentés dans MEDIA_SOURCES).
        return (
          String(item.artist || item.author || item.publisher || item.platform || '').trim() || null
        )
    }
  }, [latestAdd])

  /** Titre de la tuile : BD sans série -> « Tome N » si le titre n'est qu'un numéro. */
  const latestTitle = useMemo(() => {
    if (!latestAdd) return null
    const title = String(latestAdd.title || '').trim()
    if (latestAdd.mediaType === 'comics' && !((latestAdd.item || {}).series || '').trim()) {
      return /^\d{1,3}$/.test(title) ? t('dashboard.volume', { number: title }) : title
    }
    return title || null
  }, [latestAdd, t])

  /** Lien de détail : la page d'édition du type d'origine, ou '#' (aucun). */
  const latestPath = useMemo(() => {
    if (!latestAdd) return ''
    switch (latestAdd.mediaType) {
      case 'vinyls':
        return `/vinyles/${latestAdd.id}`
      case 'comics':
        return `/comics/${latestAdd.id}`
      default:
        // Bibliothèques futures (books / boardGames / videoGames) : les pages
        // d'édition n'existent pas encore -> tuile non-cliquable ('#'), le
        // DTO et la structure de la tuile restent prêts.
        return '#'
    }
  }, [latestAdd])

  /** Ouverture de la fiche du dernier ajout (clic sur la tuile unique). */
  const openLatest = (e) => {
    if (!latestAdd || latestPath === '#') return
    e.preventDefault()
    if (latestAdd.mediaType === 'vinyls') setDetailVinyl(latestAdd.item)
    else if (latestAdd.mediaType === 'comics') setDetailComic(latestAdd.item)
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
          {/* BOUTON UNIQUE « Ajouter un média » : remplace les deux anciens
              boutons séparés (« Ajouter un disque » + « Ajouter une BD »).
              Menu déroulant listant tous les types — Disque / BD actifs,
              Livres / Jeux de rôle-plateaux / Jeux vidéo déjà présents,
              grisés tant que leur page d'ajout n'est pas prête. */}
          <AddMediaDropdown />
        </div>
      </section>

      {/* Statistiques — GRILLE DU DASHBOARD en 3 COLONNES (spec) :
          Colonne 1 (gauche)  : DISQUES / ARTISTES-GROUPES / GENRES
          Colonne 2 (milieu)  : BANDES DESSINÉES / AUTEURS BD / SÉRIES
          Colonne 3 (droite)  : GRANDE tuile « DERNIER AJOUT » — tous médias
          confondus, renvoyée par GET /api/dashboard (l'élément de la
          collection portant la DATE D'AJOUT métier la plus récente).
          Mobile : grille mono-colonne, les tuiles s'empilent dans l'ordre
          CSS ci-dessous (colonne 1, colonne 2, tuile Dernier ajout en fin). */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Colonne 1 (gauche) — disques : empilées verticalement. */}
        <div className="flex flex-col gap-4">
          <StatCard label={t('dashboard.stats.vinyls')} value={stats.total} accent />
          <StatCard label={t('dashboard.stats.artists')} value={stats.artists} />
          <StatCard label={t('dashboard.stats.genres')} value={stats.genres} />
        </div>
        {/* Colonne 2 (milieu) — bandes dessinées : empilées verticalement. */}
        <div className="flex flex-col gap-4">
          <StatCard label={t('dashboard.stats.comics')} value={stats.comics.total} accent />
          <StatCard label={t('dashboard.stats.comicAuthors')} value={stats.comics.authors} />
          <StatCard label={t('dashboard.stats.series')} value={stats.comics.series} />
        </div>
        {/* Colonne 3 (droite) — GRANDE TUILE « Dernier Ajout » :
            EN-TÊTE / NOM / TITRE / TYPE DE MÉDIA (badge) / DATE D'AJOUT,
            chaque bloc séparé par une MARGE VERTICALE explicite (space-y-4).
            Cliquer ouvre la fiche du média. Conventions NOM par type —
            disque : item.artist (Groupe/Artiste), BD : item.authors
            (Auteurs), futures bibliothèques (MEDIA_SOURCES backend) :
            books->author (Auteur), boardGames->publisher (Maison d'édition),
            videoGames->platform (Plateforme). La date affichée est la DATE
            D'AJOUT métier (acquired_date / added_date, JJ/MM/AAAA) — jamais
            l'horodatage technique created_at. */}
        <LatestAddCard
          name={latestName}
          title={latestTitle}
          mediaTypeLabel={latestAdd ? t(`dashboard.mediaTypes.${latestAdd.mediaType}`, { defaultValue: latestAdd.mediaType }) : null}
          addedDate={latestAdd ? addedDateFr(latestAdd.addedDate) : null}
          empty={t('dashboard.noLatestAdd')}
          href={latestPath}
          onOpen={openLatest}
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
 * Tuile compteur de collection (Disques, Artistes / Groupes, Genres, BD …).
 * `accent` : bordure dorée pour les deux compteurs « totaux » (total de la
 * bibliothèque, jamais le dérivé). `size` : 'md' — grande tuile de la grille
 * du dashboard (texte 3xl) ; 'sm' — variante compacte conservée pour d'autres
 * usages. Chaque colonne du dashboard empile trois tuiles verticalement.
 */
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
 * TUILE « DERNIER AJOUT » — grande tuile de la TROISIÈME COLONNE du
 * dashboard, tous médias confondus (Disque, BD, et à venir Livres,
 * Jeux de Rôle/Plateaux, Jeux vidéo).
 *
 * Structure D'HAUT EN BAS, chaque bloc séparé par un ESPACE VERTICAL
 * explicite — conteneur `space-y-4` (margin-bottom de 1rem entre les blocs) :
 *   1. EN-TÊTE        le titre de la tuile « Dernier ajout » ;
 *      (marge verticale space-y-4)
 *   2. NOM / ENTITÉ   Groupe / Artiste, Auteurs, Maison d'édition
 *                     (Jeux de Rôle/Plateaux) ou Plateforme (Jeux vidéo) ;
 *      (marge verticale space-y-4)
 *   3. TITRE          titre de l'album, du livre ou du jeu ;
 *      (marge verticale space-y-4)
 *   4. TYPE DE MÉDIA  badge — Disque / BD / Livre / Jeu de Rôle/Plateaux /
 *                     Jeu vidéo (clés i18n books/boardGames/videoGames déjà
 *                     présentes — les futurs types s'affichent sans code) ;
 *      (marge verticale space-y-4)
 *   5. DATE D'AJOUT   date métier au format JJ/MM/AAAA.
 * En l'absence de média (collection vide) : état propre « aucun ».
 * Cliquer (média connu) ouvre la fiche via `onOpen`. Le TYPE DE MÉDIA se lit
 * dans un badge doré, visible immédiatement.
 */
function LatestAddCard({ name = null, title = null, mediaTypeLabel = null, addedDate = null, empty, href, onOpen }) {
  const { t } = useTranslation()
  const hasMedia = Boolean(title || name)
  const clickable = hasMedia && href && href !== '#'
  return (
    <div
      className="card p-6 flex flex-col border-gold-500/30"
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      title={clickable ? t('dashboard.latestAddTitle') : undefined}
      onClick={clickable ? onOpen : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen && onOpen(e)
              }
            }
          : undefined
      }
    >
      {/* Espace vertical explicite entre chaque bloc du contenu : `space-y-4`
          impose un margin-top de 1rem (0.25 × 4) à tout élément suivant
          l'en-tête, le nom, le titre et le badge — l'espacement demandé est
          donc garanti par cette classe seule, indépendante du padding card. */}
      <div className="flex flex-col space-y-4 grow">
        {/* 1. EN-TÊTE — titre de la tuile */}
        <p className="text-xs uppercase tracking-wider text-slate-500">{t('dashboard.latestAdd')}</p>

        {hasMedia ? (
          <>
            {/* Espace / marge verticale (space-y-4) entre en-tête et nom.
                NOM — Groupe/Artiste, Auteurs / Maison d'édition / Plateforme. */}
            <p
              className={`text-lg font-bold truncate ${clickable ? 'cursor-pointer text-white hover:text-gold-300' : 'text-white'}`}
              title={name}
            >
              {name || '—'}
            </p>
            {/* ESPACE VERTICAL — même espace entre le nom et le titre.
                TITRE — album, livre ou jeu (Tome N géré par latestTitle). */}
            <p className="text-base font-semibold text-gold-400" title={title}>
              {title}
            </p>
            {/* ESPACE VERTICAL — entre le titre et le type de média.
                TYPE DE MÉDIA — badge doré (Disque / BD / Livre / Jeu… ; futures
                clés books/boardGames/videoGames déjà présentes dans l'i18n). */}
            <span className="inline-block self-start rounded bg-gold-500/15 px-2 py-1 text-[11px] uppercase tracking-wide text-gold-400">
              {mediaTypeLabel}
            </span>
          </>
        ) : (
          <p className="text-sm text-slate-500">{empty}</p>
        )}

        {/* ESPACE VERTICAL — entre le type de média et la date.
            DATE D'AJOUT métier — JJ/MM/AAAA, en bas de tuile. */}
        {hasMedia && (
          <p className="text-xs text-slate-400">
            <span className="inline-block text-gold-400">·</span> {addedDate || '—'}
          </p>
        )}
      </div>
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
