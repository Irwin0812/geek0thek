import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useDisplay, IMAGE_TYPES } from '../services/display.jsx'
import { GridIcon, ListIcon, GearIcon, CheckIcon } from './icons.jsx'

/** Interrupteur « carte » style switch, avec libellé + hint optionnel. */
function Toggle({ label, hint, checked, onChange }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-night-700/60 transition"
    >
      <span className="min-w-0">
        <span className="block truncate text-slate-200">{label}</span>
        {hint && <span className="block text-[11px] text-slate-500">{hint}</span>}
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full border transition ${
          checked ? 'bg-gold-500 border-gold-400' : 'bg-night-700 border-night-500'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-night-950 transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </span>
    </button>
  )
}

function LockGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-slate-600" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

/**
 * Barre d'outils de personnalisation d'affichage, partagée par toutes les
 * pages de collections. Prop `forceGrid` (dashboard) : le sélecteur reste
 * visible mais la grille est imposée ; l'onglet « Liste » est désactivé.
 *
 *  [ ▦ Grille | ▤ Liste ]  [ ⚙ Options ]
 *
 * Le menu ⚙ (vue grille uniquement) expose :
 *  - Type d'image : Principal (seul actif aujourd'hui), Bannière, Disque,
 *    Logo, Vignettes (verrouillés : les collections n'ont qu'un visuel)
 *  - Cartes : Afficher le titre · Afficher l'année · Carte à jouer
 */
export default function ViewToolbar({ forceGrid = false }) {
  const { t } = useTranslation()
  const { settings, update, reset } = useDisplay()
  const [optionsOpen, setOptionsOpen] = useState(false)

  /* ------------------------------------------------------------------
     CORRECTION STRUCTURELLE DU MENU D'OPTIONS (superposition z-index /
     overflow). Le panneau n'est PLUS un enfant absolu de la barre : il est
     PORTALÉ dans <body> et positionné en `fixed` + `z-[9999]`.

     Pourquoi le simple `z-50` absolu ne suffisait pas :
       - La barre `.cb-viewtoolbar` porte `backdrop-blur` → elle crée un
         CONTEXTE D'EMPILEMENT. Tout descendant positionné (le menu) est
         CONFINÉ dans ce contexte : son z-index ne peut jamais s'échapper au-
         dessus des éléments peints plus tard dans le DOM.
       - Chaque tuile de la grille (`.card`) porte aussi `backdrop-blur-sm` →
         contexte d'empilement propre, peint par-dessus la barre (DOM postérieur).
     Résultat : le menu passait DERRIÈRE les cartes, quel que soit le z-index.

     Le portail + `position: fixed` sort le panneau de TOUS les contextes
     d'empilement ET de tout `overflow` (hidden/clip) des conteneurs parents :
     il plane de manière totalement indépendante au-dessus de toute la page.
     ------------------------------------------------------------------ */
  // triggerRef : conteneur du bouton ⚙ — sert à ancrer le panneau ET à
  //              détecter le « clic extérieur » (racine n°1).
  const triggerRef = useRef(null)
  // panelRef   : racine du panneau PORTALÉ dans <body> (racine n°2 du test
  //              de clic extérieur).
  const panelRef = useRef(null)
  // Position viewport (px) du panneau, recalculée à l'ouverture puis au
  // scroll / resize pour rester collé au bouton ⚙.
  const [pos, setPos] = useState({ top: 0, left: 0 })

  /** Recalcule la position du panneau à partir du rectangle du bouton ⚙ :
      aligné à droite (équivalent `right-0`) sous le bouton, replié vers le
      haut si le bas de l'écran est trop proche, et borné aux marges du
      viewport (jamais de débordement horizontal). */
  const computePos = () => {
    const btn = triggerRef.current
    if (!btn) return
    const r = btn.getBoundingClientRect()
    const panel = panelRef.current
    const panelW = panel ? panel.offsetWidth : 288 // w-72 = 18rem
    const panelH = panel ? panel.offsetHeight : 0
    const gap = 8 // équivalent de l'ancien `mt-2`
    const margin = 12
    let left = r.right - panelW
    if (left < margin) left = margin
    const maxLeft = window.innerWidth - panelW - margin
    if (left > maxLeft) left = Math.max(margin, maxLeft)
    let top = r.bottom + gap
    if (panelH && top + panelH > window.innerHeight - margin) {
      top = Math.max(margin, r.top - panelH - gap)
    }
    setPos({ top, left })
  }

  // Recalcule dès que le panneau est monté dans le DOM (portail), puis suit
  // le scroll (capture : aussi les conteneurs imbriqués) et le resize.
  useLayoutEffect(() => {
    if (!optionsOpen) return
    computePos()
    const onReflow = () => computePos()
    window.addEventListener('scroll', onReflow, true)
    window.addEventListener('resize', onReflow)
    return () => {
      window.removeEventListener('scroll', onReflow, true)
      window.removeEventListener('resize', onReflow)
    }
  }, [optionsOpen])

  // Fermeture au clic extérieur / touche Échap. Le panneau étant PORTALÉ dans
  // <body>, le « clic extérieur » est testé contre DEUX racines : le bouton ⚙
  // (triggerRef) ET le panneau (panelRef).
  useEffect(() => {
    if (!optionsOpen) return
    const onPointer = (e) => {
      const inTrigger = triggerRef.current && triggerRef.current.contains(e.target)
      const inPanel = panelRef.current && panelRef.current.contains(e.target)
      if (!inTrigger && !inPanel) setOptionsOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOptionsOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [optionsOpen])

  const isGrid = forceGrid || settings.view === 'grid'

  /* Bouton actif du sélecteur : même teinte que les boutons d'action
     principaux (.btn-primary) — l'accant est piloté par les variables CSS du
     thème en cours, donc or (#d4a24e) sur les thèmes sombres et chaude/
     cuivrée (#92400e) sous « Médiathèque ». */
  const segCls = (active) =>
    `inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold transition ${
      active
        ? 'bg-[var(--accent-strong)] text-[var(--accent-contrast)] shadow-[0_8px_16px_-8px_var(--ring)]'
        : 'text-slate-300 hover:bg-night-700 hover:text-white'
    }`

  /* Contenu du panneau d'options — rendu dans le PORTAIL (cf. fin du return).
     `fixed` + `z-[9999]` : il plane au-dessus de toute la page, hors de tout
     contexte d'empilement / overflow. La position viewport vient de `pos`. */
  const optionsPanel = optionsOpen ? (
    <div
      ref={panelRef}
      style={{ top: pos.top, left: pos.left }}
      className="fixed z-[9999] w-72 card p-1.5 shadow-2xl shadow-black/50"
    >
      <div className="flex items-center justify-between px-3 pb-1.5 pt-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
          {t('settings.options')}
        </span>
        <button
          className="text-[11px] font-semibold text-gold-400 hover:text-gold-300"
          onClick={reset}
          title={t('settings.resetTitle')}
        >
          {t('settings.reset')}
        </button>
      </div>

      <div className="my-1 h-px bg-night-600/60" />

      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {t('settings.imageType')}
      </p>
      <div className="flex flex-col gap-0.5 px-1.5">
        {IMAGE_TYPES.map((type) => {
          // Libellé traduit : `main` → settings.imageTypeMain, etc.
          const typeLabel = t(
            `settings.imageType${type.value.charAt(0).toUpperCase()}${type.value.slice(1)}`,
          )
          const active = settings.imageType === type.value
          return (
            <button
              key={type.value}
              disabled={!type.available}
              onClick={() => update({ imageType: type.value })}
              title={
                type.available
                  ? t('settings.showType', { type: typeLabel })
                  : t('settings.typeUnavailable', { type: typeLabel })
              }
              className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition ${
                type.available
                  ? active
                    ? 'bg-gold-500/15 text-gold-300'
                    : 'text-slate-300 hover:bg-night-700/60'
                  : 'cursor-not-allowed text-slate-600'
              }`}
            >
              <span>{typeLabel}</span>
              {active ? <CheckIcon size={14} className="text-gold-400" /> : !type.available ? <LockGlyph /> : null}
            </button>
          )
        })}
      </div>
      <p className="px-3 pb-1 pt-1.5 text-[11px] leading-snug text-slate-500">
        {t('settings.oneVisualNote')}
      </p>

      <div className="my-1 h-px bg-night-600/60" />

      <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {t('settings.card')}
      </p>
      <div className="flex flex-col gap-0.5 px-1.5 pb-1">
        <Toggle
          label={t('settings.showTitle')}
          checked={settings.showTitle}
          onChange={(v) => update({ showTitle: v })}
        />
        <Toggle
          label={t('settings.showYear')}
          checked={settings.showYear}
          onChange={(v) => update({ showYear: v })}
        />
        <Toggle
          label={t('settings.showBadges')}
          hint={t('settings.badgesHint')}
          checked={settings.showBadges}
          onChange={(v) => update({ showBadges: v })}
        />
        <Toggle
          label={t('settings.jukebox')}
          hint={t('settings.jukeboxHint')}
          checked={settings.jukebox}
          onChange={(v) => update({ jukebox: v })}
        />
      </div>
    </div>
  ) : null

  return (
    // h-12 : même hauteur que le champ de recherche et le bouton d'action ;
    // shrink-0 : jamais écrasé par le champ flex-1 de la barre d'actions.
    // cb-viewtoolbar : accroche charte « Comic Books » (thèmes/comic-books.css)
    // qui passe la barre en papier + encre + ombre décalée « case de BD ».
    <div className="cb-viewtoolbar flex h-12 shrink-0 items-center gap-1.5 rounded-xl border border-night-600/70 bg-night-800/70 p-1.5 backdrop-blur">
      {/* Mode d'affichage : Grille / Liste */}
      <div className="flex items-center gap-0.5 rounded-lg bg-night-900/70 p-0.5" role="group" aria-label={t('settings.displayMode')}>
        <button
          className={segCls(isGrid)}
          onClick={() => update({ view: 'grid' })}
          aria-pressed={isGrid}
          title={t('settings.gridView')}
        >
          <GridIcon size={15} />
          <span className="hidden sm:inline">{t('settings.grid')}</span>
        </button>
        <button
          className={`${segCls(!isGrid)} ${forceGrid ? 'cursor-not-allowed opacity-50' : ''}`}
          disabled={forceGrid}
          onClick={() => update({ view: 'list' })}
          aria-pressed={!isGrid}
          title={forceGrid ? t('settings.listDisabled') : t('settings.listView')}
        >
          <ListIcon size={15} />
          <span className="hidden sm:inline">{t('settings.list')}</span>
        </button>
      </div>

      {/* Options (pertinent pour la vue en grille uniquement). Le bouton ⚙ reste
          ici ; le PANNEAU qu'il ouvre est PORTALÉ dans <body> (cf. fin du
          return) pour échapper au contexte d'empilement de la barre. */}
      {isGrid && (
        <div className="relative" ref={triggerRef}>
          <button
            className={`btn-ghost !px-2.5 !py-1.5 ${optionsOpen ? '!bg-night-600 text-gold-300' : ''}`}
            onClick={() => setOptionsOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={optionsOpen}
            title={t('settings.options')}
          >
            <GearIcon size={16} />
          </button>
        </div>
      )}

      {/* Panneau d'options PORTALÉ dans <body> : `position: fixed` + `z-[9999]`
          le sort de TOUS les contextes d'empilement (backdrop-blur de la barre,
          .card des tuiles) et de tout overflow — il plane au-dessus de toute la
          page sans être coupé ni masqué par les cartes de disques/BD. */}
      {optionsPanel && createPortal(optionsPanel, document.body)}
    </div>
  )
}
