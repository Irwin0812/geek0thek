import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight, BookOpen, ChevronDown, Dices, Disc3, Gamepad2, Layers, Library, Lock, PenLine, Plus, Tags, Users,
} from 'lucide-react'

import { api } from '../services/api.js'
import { useAuth } from '../App.jsx'
import { useDisplay } from '../services/display.jsx'
import VinylCard, { EmptyState } from '../components/VinylCard.jsx'
import ComicCard from '../components/ComicCard.jsx'
import ItemDetailModal from '../components/ItemDetailModal.jsx'
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
      // « Derniers ajouts » par type (grilles de cartes) + alimente la grille
      // BENTO (compteurs Disques / BD / Artistes / Auteurs / Genres / Séries).
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
   * lexicographique) pour un rendu stable et déterminant.
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
    // BENTO RIGIDE (2 colonnes Gauche / Droite) : section haute = grid
    // lg:grid-cols-3 — la colonne gauche (lg:col-span-2, flex-col) empile les 2
    // bannières DISQUES / BANDES DESSINÉES en flex-1 ; la colonne droite
    // (lg:col-span-1, flex-col) empile les 3 tuiles « À venir » en flex-1. Les 2
    // colonnes de la grille s'étirent à la même hauteur et TOUT l'espace libre est
    // absorbé par les enfants flex-1 de chaque colonne → ZÉRO trou. Section basse :
    // les 4 cartes secondaires en grid sm:grid-cols-2 lg:grid-cols-4 pleine largeur.
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Modale de détail (clic sur carte) */}
      <ItemDetailModal type="vinyl" item={detailVinyl} onClose={() => setDetailVinyl(null)} onEdit={(v) => { setDetailVinyl(null); navigate(`/vinyles/${v.id}`) }} />
      <ItemDetailModal type="comic" item={detailComic} onClose={() => setDetailComic(null)} onEdit={(c) => { setDetailComic(null); navigate(`/comics/${c.id}`) }} />

      {/* En-tête */}
      <section>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h1 className="text-2xl md:text-3xl font-bold tracking-wide text-white">
            {t('dashboard.greeting', { name: user.firstName })}
          </h1>
          {/* Bouton unique « Ajouter un média » (menu déroulant, cf. doc bas de page). */}
          <AddMediaDropdown />
        </div>
      </section>

      {/* ================= SECTION HAUTE : GRILLE RIGIDE 2 COLONNES (Gauche / Droite) ============
          grid grid-cols-1 lg:grid-cols-3 + gap-6, les deux colonnes-sœurs de la grille
          s'étirent à TOUTE LA HAUTEUR de la section (alignements flexibles), et tous
          leurs enfants sont flex-1 : tout l'espace restant est absorbé par les cartes
          de chaque colonne → il n'est pas possible techniquement d'avoir un « trou »
          blanc au milieu.

          COLONNE GAUCHE (lg:col-span-2, pile flex-col gap-6) :
            1. BANNIÈRE DISQUES (compacte, photo bg_tuile_disques.jpg + overlay sombre,
               contenu ancré à gauche : icône + label CAPITALES + chiffre gras, actions
               rapides « Ajouter un disque » / « Tout voir » à droite) ;
            2. BANNIÈRE BANDES DESSINÉES (id. photo bg_tuile_bd.jpg, accents teal).
          COLONNE DROITE (lg:col-span-1, pile flex-col gap-4) : les 3 tuiles « À venir »
          empilées en GLASSMORPHISME SOMBRE (photos bg_tuile_jv / _jdr / _livreszines.jpg,
          bordure slate subtle white/10, backdrop-blur-md, icône + cadenas + badge
          PROCHAINEMENT — tables non migrées) : Jeux Vidéo / Jeux de Rôle-Plateau /
          Livres-Magazines. Chaque tuile est flex-1, elles remplissent la colonne entière.

          SECTION BASSE : les 4 CARTES SECONDAIRES (grid grid-cols-1 sm:grid-cols-2
          lg:grid-cols-4 + gap-6) en FOND UNI THÉMATIQUE sans photo de fond — bordure et
          accents assortis au domaine (marron/ambre, prune/violet, vert sombre, bleu nuit). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* COLONNE GAUCHE — les 2 colonnes sur 3 (lg:col-span-2) : pile VERTICALE des
            bannières Disques / Bandes dessinées, toutes deux flex-1 pour s'équider
            et absorber la hauteur de la colonne. */}
        <div className="flex flex-col gap-6 lg:col-span-2">
          {/* 1. Carte DISQUES (bannière horizontale compacte, photo dédiée + overlay). */}
          <PrimaryStatCard
            className="flex-1"
            to="/collection"
            icon={<Disc3 size={26} />}
            label={t('dashboard.stats.vinyls')}
            value={stats.total}
            bgImage="/img/bg_tuile_disques.jpg"
            glow="bg-amber-500/40"
            frame="border-amber-500/30 hover:border-amber-400/60"
            chip="border-amber-500/40 text-amber-300"
            numberClass="text-white [text-shadow:0_2px_18px_rgba(245,158,11,0.45)]"
          />
          {/* 2. Carte BANDES DESSINÉES (bannière horizontale compacte, photo dédiée + overlay). */}
          <PrimaryStatCard
            className="flex-1"
            to="/comics"
            icon={<BookOpen size={26} />}
            label={t('dashboard.stats.comics')}
            value={stats.comics.total}
            bgImage="/img/bg_tuile_bd.jpg"
            glow="bg-teal-500/40"
            frame="border-teal-500/30 hover:border-teal-400/60"
            chip="border-teal-500/40 text-teal-300"
            numberClass="text-white [text-shadow:0_2px_18px_rgba(45,212,191,0.45)]"
          />
        </div>

        {/* COLONNE DROITE — 1 colonne sur 3 : pile VERTICALE des 3 tuiles « À venir »
            (glassmorphism sombre). Bases de données non migrées : icône cadenas + badge
            PROCHAINEMENT. Quand une collection ouvrira : retirer le badge et passer un
            vrai compteur — même composant, rien d'autre à changer. Chaque tuile est
            flex-1 → elles remplissent toute la hauteur de la colonne gauche. */}
        <div className="flex flex-col gap-4">
          <SoonCard icon={Gamepad2} label={t('dashboard.stats.videoGames')} bgImage="/img/bg_tuile_jv.jpg" />
          <SoonCard icon={Dices} label={t('dashboard.stats.boardGames')} bgImage="/img/bg_tuile_jdr.jpg" />
          <SoonCard icon={Library} label={t('dashboard.stats.books')} bgImage="/img/bg_tuile_livreszines.jpg" />
        </div>
      </div>

      {/* SECTION BASSE — les 4 CARTES SECONDAIRES alignées horizontalement (1 → sm:2 →
          lg:4 colonnes), en FOND UNI THÉMATIQUE sans photo de fond : bordure et accents
          du domaine appliqués aux chip icône, halo et flèche (objets `theme` ci-dessous). */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* Artistes / Groupes — fond uni marron chaud + accents ambre. */}
        <SecondaryStatCard
          to="/collection"
          icon={<Users size={16} />}
          label={t('dashboard.stats.artists')}
          value={stats.artists}
          theme={{
            card: 'border-amber-900/40 bg-[#2a1a15] hover:border-amber-700/60',
            glow: 'bg-amber-500/30',
            chip: 'border-amber-500/40 text-amber-300',
            arrow: 'text-amber-300',
          }}
        />
        {/* Genres Musicaux — fond uni prune + accents violet. */}
        <SecondaryStatCard
          to="/collection"
          icon={<Tags size={16} />}
          label={t('dashboard.stats.musicalGenres')}
          value={stats.genres}
          theme={{
            card: 'border-purple-900/40 bg-[#221528] hover:border-purple-700/60',
            glow: 'bg-purple-500/30',
            chip: 'border-purple-500/40 text-purple-300',
            arrow: 'text-purple-300',
          }}
        />
        {/* Auteurs BD — fond uni vert sombre + accents émeraude. */}
        <SecondaryStatCard
          to="/comics"
          icon={<PenLine size={16} />}
          label={t('dashboard.stats.comicAuthors')}
          value={stats.comics.authors}
          theme={{
            card: 'border-emerald-900/40 bg-[#11221c] hover:border-emerald-700/60',
            glow: 'bg-emerald-500/30',
            chip: 'border-emerald-500/40 text-emerald-300',
            arrow: 'text-emerald-300',
          }}
        />
        {/* Séries BD — fond uni bleu nuit + accents bleus. */}
        <SecondaryStatCard
          to="/comics"
          icon={<Layers size={16} />}
          label={t('dashboard.stats.comicSeries')}
          value={stats.comics.series}
          theme={{
            card: 'border-blue-900/40 bg-[#121929] hover:border-blue-700/60',
            glow: 'bg-blue-500/30',
            chip: 'border-blue-500/40 text-blue-300',
            arrow: 'text-blue-300',
          }}
        />
      </div>

      {/* Derniers ajouts */}
      <section>
        <h2 className="text-lg font-bold uppercase tracking-wider text-white mb-4">{t('dashboard.latestAdds')}</h2>
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
 * BENTO — CARTE PRINCIPALE (BANNIÈRE HORIZONTALE COMPACTE) : Disques / Bandes
 * dessinées, empilées en FLEX-COL (chacune `flex-1`) dans la COLUMNNE GAUCHE de la
 * section haute (lg:col-span-2). La pile s'équilibre verticalement : chaque
 * bannière grandit jusqu'à ce que la colonne gauche égale la hauteur de la colonne
 * droite (3 tuiles « À venir » flex-1) — et aucun espace ne peut rester vide car
 * tout le surplus est absorbé par flex-1. Photo dédiée plein cadre + overlay sombre
 * en dégradé, icône contextuelle lucide dans un chip
 * glassmorphism, stat (label CAPITALES ESPACÉES + chiffre font-black 3xl→4xl)
 * ancrée à gauche, ACTIONS RAPIDES (« Ajouter », « Tout voir ») ancrées à droite —
 * contenu aligné verticalement sur UNE ligne pour le gabarit bannière.
 * Survol : translation fluide hover:-translate-y-1 + HALO GLOW coloré (prop `glow`,
 * blur-2xl déporté hors du cadre, 0 → 75 % d'opacité) + shadow-xl. Architecture à
 * deux niveaux : le wrapper OUTER porte la translation / ombre / halo (sans
 * overflow-hidden — le halo doit déborder) ; la carte INNER (overflow-hidden
 * rounded-2xl) contient photo, overlay et contenu.
 */
function PrimaryStatCard({ to, icon, label, value, bgImage, glow, frame, chip, numberClass, className = '' }) {
  const { t } = useTranslation()
  return (
    <div className={`group relative min-h-0 rounded-2xl transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:shadow-black/50 ${className}`}>
      {/* Halo lumineux : première couche peinte → derrière la carte ; déborde
          de 12 px (-inset-3), flou blur-2xl, couleur du domaine `glow`. */}
      <span aria-hidden="true" className={`pointer-events-none absolute -inset-3 rounded-[26px] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-75 ${glow}`} />
      {/* BANNIÈRE : h-full + min-h de repli (mobile, pile de cartes) ; en desktop
          le wrapper flex-1 de la colonne gauche s'étire et c'est lui qui fixe
          la hauteur (min-h-0 sur le wrapper → pas de min-content bloquant). */}
      <div className={`relative flex h-full min-h-[150px] flex-wrap items-center gap-y-2 overflow-hidden rounded-2xl border bg-night-950/50 px-6 transition-colors duration-300 ${frame}`}>
        {/* PHOTO DE FOND dédiée à la tuile (servie statiquement par public/img)
            + VEILLE SOMBRE : gradient slate-950/95 → night-950/40, plus dense
            en bas où vivent le label et les actions ; fade léger au survol
            (la photo « respire » sous la main, le texte reste lisible). */}
        <img src={bgImage} alt="" aria-hidden="true" loading="lazy" className="pointer-events-none absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-slate-950/95 via-night-950/75 to-night-950/35 transition-opacity duration-500 group-hover:opacity-80" />

        {/* Gauche : icône (chip verre) + stat, alignées en UNE ligne (bannière). */}
        <div className="relative flex min-w-0 shrink-0 items-center gap-3 sm:gap-4">
          <span className={`hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-night-950/60 shadow-lg shadow-black/40 backdrop-blur-md sm:flex ${chip}`}>
            {icon}
          </span>
          {/* Statistique : label CAPITALES ESPACÉES + CHIFFRE gras, ancrés à gauche ;
              chiffre = lien direct vers la collection. */}
          <Link to={to} aria-label={`${label} — ${value}`} className="group/num min-w-0">
            <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-200 drop-shadow-sm">{label}</p>
            <p className={`mt-1 text-3xl font-black leading-none tracking-tight transition-colors duration-300 sm:text-4xl group-hover/num:brightness-125 ${numberClass}`}>
              {value}
            </p>
          </Link>
        </div>

        {/* ACTIONS RAPIDES : bouton d'ajout (accent du domaine) + lien direct —
            ancrées à droite de la bannière (au lieu du bas dans le format carré). */}
        <span className="relative ml-auto flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center sm:gap-2">
          <QuickAction to={to === '/collection' ? '/vinyles/nouveau' : `/comics/nouveau`} tone={frame.includes('amber') ? 'amber' : 'teal'}>
            <Plus size={14} strokeWidth={2.75} aria-hidden="true" />
            {t(`dashboard.${to === '/collection' ? 'addVinyl' : 'addComic'}`)}
          </QuickAction>
          <QuickAction to={to} tone="neutral">
            {t('common.viewAll')}
            <ArrowRight size={14} strokeWidth={2.5} aria-hidden="true" />
          </QuickAction>
        </span>
      </div>
    </div>
  )
}

/**
 * BENTO — CARTE SECONDAIRE (Artistes / Groupes, Genres, Auteurs BD, Séries) :
 * AUCUNE photo de fond → FOND UNI THÉMATIQUE (dégradé discret du même thème du
 * haut vers le bas) selon la prop `theme` { card, glow, chip, arrow } :
 *   - marron/bordeaux chaud + accents AMBRE  → Artistes / Groupes,
 *   - violet/prune sombre + bordure assortie → Genres Musicaux,
 *   - vert sombre élégant + accents Émeraude → Auteurs BD,
 *   - bleu nuit sombre + accents bleus       → Séries BD.
 * Bordure du thème (border-*-900/40) qui s'éclaire au survol, flèche ArrowRight
 * du thème qui glisse en fin de ligne. La carte ENTIERE est un lien direct vers la
 * collection concernée (accessible au clavier, focus visible) — « Accès direct sur
 * chaque carte active » du spec. Fond UNI du domaine (hex dans `theme.card`),
 * contenu p-6, flèche masquée sur mobile étroit (sm:flex) pour préserver la
 * lisibilité de la grille 4 colonnes.
 */
function SecondaryStatCard({ to, icon, label, value, theme = { card: '', glow: '', chip: '', arrow: 'text-slate-300' }, className = '' }) {
  return (
    <div className={`group relative h-full rounded-2xl transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:shadow-black/50 ${className}`}>
      {/* Halo lumineux du thème (blur-2xl déporté hors du cadre). */}
      <span aria-hidden="true" className={`pointer-events-none absolute -inset-2.5 rounded-[20px] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-60 ${theme.glow}`} />
      <Link
        to={to}
        aria-label={`${label} — ${value}`}
        className={`relative flex h-full min-h-[120px] items-center gap-4 overflow-hidden rounded-2xl border p-6 transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-500/60 ${theme.card}`}
      >
        <span className={`relative flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border bg-[#0b0f18]/40 shadow-lg shadow-black/30 backdrop-blur-sm ${theme.chip}`}>
          {icon}
        </span>
        <span className="relative min-w-0">
          <span className="block truncate text-[11px] font-semibold uppercase tracking-wider text-slate-200">{label}</span>
          <span className="mt-0.5 block text-3xl font-extrabold leading-none text-white">{value}</span>
        </span>
        {/* Flèche « accès direct » du thème : apparaissant au survol (glisse à gauche). */}
        <span className="relative ml-auto hidden shrink-0 sm:flex">
          <ArrowRight size={16} aria-hidden="true" className={`-translate-x-2 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100 ${theme.arrow}`} />
        </span>
      </Link>
    </div>
  )
}

/**
 * BENTO — CARTE « À VENIR » (Jeux vidéo / Jeux de rôle-plateau / Livres-Mag) :
 * pile de la COLONNE DROITE (lg:col-span-1, flex-col gap-4). Style GLASSMORPHISME
 * SOMBRE — verre dépoli (bg-night-950/40 + BACKDROP-BLUR-MD sur la photo dédiée
 * posée dessous → bokeh), BORDURES SLATE subtiles, teintes NEUTRES : aucun accent
 * coloré tant que la collection est fermée. Icône du domaine en gris + cadenas
 * LUCIDE dans le badge distinctif « PROCHAINEMENT » (clé dashboard.soonTitle).
 * Chaque tuile est flex-1 → les 3 remplissent toute la hauteur de la colonne
 * droite (= hauteur de la colonne gauche, les deux colonnes de la grille étant
 * stretchées ensemble) ; il n'y a donc pas de place pour un trou.
 * Évolution prévue : quand la table existera, retirer ce composant au profit
 * d'une PrimaryStatCard du domaine — idem photo de fond.
 */
function SoonCard({ icon: Icon, label, bgImage }) {
  const { t } = useTranslation()
  return (
    <div className="group relative min-h-0 flex-1 rounded-xl transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:shadow-black/50">
      {/* Halo neutre discret (slate) — le « glow » des sections à venir. */}
      <span aria-hidden="true" className="pointer-events-none absolute -inset-2 rounded-[14px] bg-slate-500/25 opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-60" />
      {/* Tuile élastique (flex-1) : les 3 tuiles se partagent à égalité la hauteur
          de la colonne droite — toute la zone est remplie, rien ne déborde. */}
      <div className="relative flex h-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-xl border border-slate-700/70 bg-night-950/40 p-4 text-center backdrop-blur-md transition-colors duration-300 group-hover:border-slate-500/70">
        {/* Photo dédiée derrière le VERRE (backdrop-blur-md la dépolit → bokeh). */}
        <img src={bgImage} alt="" aria-hidden="true" loading="lazy" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-70" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-slate-950/40" />

        <span className="relative flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 bg-night-950/50 text-slate-300 shadow-lg shadow-black/40 backdrop-blur-md transition-colors duration-300 group-hover:text-slate-100">
          <Icon size={22} aria-hidden="true" />
        </span>
        <span className="relative text-[11px] font-semibold uppercase tracking-wider text-slate-300 drop-shadow-sm">{label}</span>

        {/* Badge distinctif PROCHAINEMENT + cadenas (cadenas LUCIDE). */}
        <span className="relative inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-night-950/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 backdrop-blur-sm">
          <Lock size={11} strokeWidth={2.25} aria-hidden="true" />
          {t('dashboard.soonTitle')}
        </span>
      </div>
    </div>
  )
}

/**
 * BOUTON D'ACTION RAPIDE des tuiles principales (pill compacte) : variante
 * `tone` = accent du domaine (ambre musique / teal littérature) ou NEUTRE pour
 * le lien « Tout voir ». Focus clavier visible ; stopPropagation inutile —
 * boutons et liens principaux sont des FRÈRES au DOM, pas imbriqués.
 */
function QuickAction({ to, tone = 'neutral', children }) {
  const tones = {
    amber: 'border-amber-500/40 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 hover:text-amber-100 focus-visible:ring-amber-500/60',
    teal: 'border-teal-500/40 bg-teal-500/15 text-teal-200 hover:bg-teal-500/25 hover:text-teal-100 focus-visible:ring-teal-500/60',
    neutral: 'border-white/10 bg-night-950/60 text-slate-300 hover:bg-night-800/80 hover:text-white focus-visible:ring-gold-500/60',
  }
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider shadow-sm shadow-black/40 backdrop-blur-md transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 ${tones[tone]}`}
    >
      {children}
    </Link>
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
 * Les types non prêts sont grisés + badge « à venir » : structure anticipée,
 * désactivés tant que le routeur n'expose pas leurs pages. Fermeture au clic
 * extérieur / touche Échap via `useDismiss`. Icônes LUCIDE (Plus / ChevronDown)
 * — le chevron pivote à l'ouverture ; le panneau porte z-50 impératif (sort du
 * stacking context des tuiles du dashboard, cf. ancien doc).
 */
function AddMediaDropdown() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))

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
        <Plus size={15} strokeWidth={2.75} aria-hidden="true" />
        {t('dashboard.addMedia.title')}
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`text-xs leading-none transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={t('dashboard.addMedia.title')}
          className="absolute right-0 top-full z-50 mt-1.5 w-72 max-w-[calc(100vw-2rem)] card !p-1.5 shadow-2xl shadow-black/50"
        >
          {options.map((opt) => (
            <button
              key={opt.to}
              type="button"
              role="menuitem"
              disabled={!opt.enabled}
              onClick={() => pick(opt)}
              title={opt.enabled ? undefined : t('dashboard.soonTitle')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                opt.enabled
                  ? 'text-slate-200 hover:bg-night-700/60 hover:text-white'
                  : 'cursor-not-allowed text-slate-500 hover:bg-transparent'
              }`}
            >
              {/* Icône Lucide par type + libellé + badge « prochainement ». */}
              <TypeIcon opt={opt} />
              <span className="truncate">{opt.label}</span>
              {!opt.enabled && (
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-night-700 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-500">
                  <Lock size={9} aria-hidden="true" />
                  {t('dashboard.soonTitle')}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Icône contextuelle Lucide par type de média dans le menu d'ajout. */
function TypeIcon({ opt }) {
  const cls = 'shrink-0'
  if (opt.to === '/vinyles/nouveau') return <Disc3 size={15} className={`${cls} text-gold-400`} aria-hidden="true" />
  if (opt.to === '/comics/nouveau') return <BookOpen size={15} className={`${cls} text-teal-400`} aria-hidden="true" />
  if (opt.to.startsWith('/livres')) return <Library size={15} className={`${cls}`} aria-hidden="true" />
  if (opt.to.startsWith('/jeux-de-mesa')) return <Dices size={15} className={`${cls}`} aria-hidden="true" />
  return <Gamepad2 size={15} className={`${cls}`} aria-hidden="true" />
}
