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
import { LockIcon } from '../components/icons.jsx'
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

      {/* Statistiques — GRILLE BENTO ASYMMÉTRIQUE 3 COLONNES (spec) :
          Colonne 1 (gauche, DOUBLE LARGEUR md:col-span-2) : DISQUES et BANDES
            DESSINÉES (cartes principales) + leurs compteurs secondaires
            équilibrés (Artistes / Groupes, Auteurs BD, Genres Musicaux,
            Séries BD). Chaque tuile porte sa PHOTO DÉDIÉE (img/bg_tuile_*.jpg,
            servie par frontend/public/img/) assombrie par UN VEILLE NOIR
            (overlay) garantissant la LISIBILITÉ du texte.
          Colonne 3 (droite) : 3 tuiles « À venir » EMPILÉES — JEUX VIDÉO /
            JEUX DE RÔLE-PLATEAU / LIVRES-MAGAZINES — bases de données NON
            MIGRÉES : icône cadenas + badge « PROCHAINEMENT » sur style
            GLASSMORPHISME SOMBRE (backdrop-blur-md + bordures subtiles), à
            remplacer par les vrais compteurs dès l'ouverture des collections.
          EFFETS AU SURVOL (toutes tuiles) : translation fluide hover:-translate-y-1,
          halo lumineux coloré par domaine (halo blur-2xl derrière la carte,
          prop `glow` du StatCard) et ombre prononcée (shadow-xl hover:shadow-black/50)
          — transition-all 300ms pour un mouvement doux.
          Toutes les tuiles partagent le MÊME composant StatCard ; `flex-1` sur
          chaque tuile + grid-auto-rows minmax sur le conteneur = hauteurs
          STRICTEMENT égales au sein de chaque colonne. Mobile : grille
          mono-colonne, les tuiles s'empilent dans l'ordre CSS. */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3 md:[grid-auto-rows:minmax(0,1fr)]">
        {/* Colonne 1 (gauche) — disques + bandes dessinées : largeur double,
            les 6 tuiles empilées verticalement à hauteurs égales. */}
        <div className="flex h-full flex-col gap-4 md:col-span-2">
          <StatCard label={t('dashboard.stats.vinyls')} value={stats.total} accent bgImage="/img/bg_tuile_disques.jpg" glow="bg-gold-500/40" />
          <StatCard label={t('dashboard.stats.artists')} value={stats.artists} bgImage="/img/bg_tuile_disques.jpg" glow="bg-gold-500/40" />
          <StatCard label={t('dashboard.stats.musicalGenres')} value={stats.genres} bgImage="/img/bg_tuile_disques.jpg" glow="bg-gold-500/40" />
          <StatCard label={t('dashboard.stats.comics')} value={stats.comics.total} accent bgImage="/img/bg_tuile_bd.jpg" glow="bg-violet-500/35" />
          <StatCard label={t('dashboard.stats.comicAuthors')} value={stats.comics.authors} bgImage="/img/bg_tuile_bd.jpg" glow="bg-violet-500/35" />
          <StatCard label={t('dashboard.stats.comicSeries')} value={stats.comics.series} bgImage="/img/bg_tuile_bd.jpg" glow="bg-violet-500/35" />
        </div>
        {/* Colonne 3 (droite) — futures bibliothèques (MEDIA_SOURCES backend,
            tables non migrées) : 3 tuiles « À venir » empilées en
            GLASSMORPHISME SOMBRE (aucune photo derrière le verre : le voile
            se bokeh sur les halos du fond global de la page). Quand chaque
            collection ouvrira : retirer `locked` et passer le vrai number dans
            `value` — rien d'autre à changer. */}
        <div className="flex h-full flex-col gap-4">
          <StatCard label={t('dashboard.stats.videoGames')} locked bgImage="/img/bg_tuile_jv.jpg" glow="bg-cyan-500/30" />
          <StatCard label={t('dashboard.stats.boardGames')} locked bgImage="/img/bg_tuile_jdr.jpg" glow="bg-emerald-500/30" />
          <StatCard label={t('dashboard.stats.books')} locked bgImage="/img/bg_tuile_livreszines.jpg" glow="bg-amber-500/30" />
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
 * TUILE DE LA GRILLE BENTO DU DASHBOARD (spec + style Glassmorphism) :
 * - Cartes PRINCIPALES à largeur double (colonne de gauche) : Disques, Bandes
 *   dessinées — `accent` : bordure/texte doré pour les deux « TOTAUX ».
 * - Cartes SECONDAIRES équilibrées : Artistes / Groupes, Auteurs BD, Genres
 *   Musicaux, Séries BD — mêmes StatCard (valeur numérique) que les totaux.
 * - Tuiles « À venir » (colonne de droite, 3 empilées) : `locked` — style
 *   GLASSMORPHISME SOMBRE au lieu du fond photo : verre translucide
 *   (bg-night-900/40 + backdrop-blur-md) + bordures subtiles (white/10) ; le
 *   bokeh de l'effet vient des halos lumineux déjà présents dans le fond global
 *   de la page (body). Icône cadenas (LockIcon) + badge « PROCHAINEMENT » à la
 *   place du compteur numérique (bases non migrées). Quand une collection ouvre :
 *   retirer `locked` et passer le vrai number dans `value` — rien d'autre.
 * FONDS D'IMAGE PAR TUILE : prop `bgImage` (chemin /img/bg_tuile_*.jpg, photos
 *   servies STATIQUEMENT par frontend/public/img/ — Vite les copie dans dist/ au
 *   build, nginx les sert à la racine, comme /img/bg_dark.jpg pour le thème). La
 *   photo est EN ARRIÈRE du contenu (overlay + texte en dessus) et VOILÉE par un
 *   gradient sombre vertical (de-night-950/85 -> night-950/60 via, plus dense en
 *   bas où vit le texte) : la LECTURE des étiquettes / compteurs reste lisible
 *   sur n'importe quelle photo. À l'overlay, fade de 25 % au survol (la photo
 *   « respire » sous le doigt sans jamais rendre le texte illisible).
 * EFFETS AU SURVOL (spec) — TOUS les types de tuiles :
 *   - translation fluide vers le haut : `hover:-translate-y-1` (transition-all 300ms) ;
 *   - GLOW : halo absolutely-positionné DEHORS la carte (wrapper parent,
 *     -inset-3, coloré par prop `glow`, ex. bg-gold-500/40), flou blur-2xl,
 *     opacité 0 -> 75/100 au survol : auréole lumineuse autour du cadre ;
 *   - ombres prononcées : `hover:shadow-xl hover:shadow-black/50` (wrapper =
 *     boîte de la tuile, même rayon rounded-2xl => ombre bien découpée).
 * ARCHITECTURE À DEUX NIVEAUX : le wrapper OUTER porte la translation, l'ombre
 *   et le halo (il n'a PAS d'overflow-hidden — le halo doit pouvoir déborder) ;
 *   la carte INNER (relative, overflow-hidden rounded-2xl) contient la photo,
 *   l'overlay et le texte. Peinture en ordre DOM : halo d'abord (en dessous),
 *   puis la carte avec son contenu par-dessus — pas besoin de z-index négatif.
 * CENTRAGE H+V conservé ; `flex-1` sur le wrapper + grid-auto-rows minmax du
 * conteneur = hauteurs STRICTEMENT égales au sein de chaque colonne.
 */
function StatCard({ label, value, accent = false, locked = false, bgImage = null, glow = 'bg-gold-500/30' }) {
  const { t } = useTranslation()
  /** CADRE de la carte intérieure : tuile verrière glassmorphism pour `locked`,
      sinon bordure subtile (dorée pour les totaux accent). */
  const frame = locked
    ? 'border-white/10 bg-night-900/40 backdrop-blur-md'
    : accent
      ? 'border-gold-500/40 bg-night-950/40'
      : 'border-white/5 bg-night-950/40'
  return (
    /** WRAPPER OUTER : `group` = le survol pilote descendants ; flex-1 = hauteur
        égale dans la colonne ; translation + ombre prononcée au survol. */
    <div className="group relative flex-1 rounded-2xl transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:shadow-black/50">
      {/* HALO DE GLOW (spéc) : première couche peinte => derrière la carte ;
          déborde de 12px (-inset-3) au-delà du cadre, flou blur-2xl, couleur
          du domaine `glow` — invisible au repos, s'éveille sur group-hover. */}
      <span aria-hidden="true" className={`pointer-events-none absolute -inset-3 rounded-[24px] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-75 ${glow}`} />
      {/* CARTE INTÉRIEURE : cadre (border/background), overflow-hidden pour
          la photo aux coins arrondis, contenu centré H+V au-dessus. */}
      <div className={`relative flex h-full flex-col items-center justify-center overflow-hidden rounded-2xl border p-4 text-center ${frame}`}>
        {bgImage && (
          <>
            {/* PHOTO DE FOND : couverture complète (object-cover), lazy-load ;
                sous l'overlay et le texte (ordre DOM = ordre de peinture). */}
            <img
              src={bgImage}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 h-full w-full object-cover"
              loading="lazy"
            />
            {/* OVERLAY SOMBRE (lisibilité) : gradient vertical plus dense en bas ;
                fade léger au survol (75 %) pour révéler la photo « en respiration ». */}
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-night-950/85 via-night-950/60 to-night-950/90 transition-opacity duration-500 group-hover:opacity-75" />
            {/* Contenu sur la photo : `relative` => peint au-dessus des 2 couches. */}
            <div className="relative flex flex-col items-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-200 drop-shadow-sm">{label}</p>
              {locked ? (
                /** Cadenas + badge « PROCHAINEMENT » sur verre sombre : slate-400,
                    discret mais net même au-dessus du bokeh. */
                <span className="mt-1.5 inline-flex items-center gap-2">
                  <LockIcon size={18} className="text-slate-400" />
                  <span className="inline-flex items-center rounded-full border border-white/10 bg-night-900/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 backdrop-blur-sm">
                    {t('dashboard.addMedia.soon')}
                  </span>
                </span>
              ) : (
                <p className={`mt-1 text-3xl font-extrabold drop-shadow ${accent ? 'text-gold-400' : 'text-white'}`}>{value}</p>
              )}
            </div>
          </>
        )}
        {/* Contenu des tuiles SANS photo (fallback si `bgImage` est manquant). */}
        {!bgImage && (
          <div className="relative flex flex-col items-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</p>
            {locked ? (
              <span className="mt-1.5 inline-flex items-center gap-2">
                <LockIcon size={18} className="text-slate-500" />
                <span className="inline-flex items-center rounded-full border border-night-600/70 bg-night-900/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  {t('dashboard.addMedia.soon')}
                </span>
              </span>
            ) : (
              <p className={`mt-1 text-3xl font-extrabold ${accent ? 'text-gold-400' : 'text-white'}`}>{value}</p>
            )}
          </div>
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
