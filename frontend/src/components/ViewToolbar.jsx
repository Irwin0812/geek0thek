import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDisplay, IMAGE_TYPES } from '../services/display.jsx'
import { GridIcon, ListIcon, GearIcon, CheckIcon } from './icons.jsx'

/**
 * Ferme au clic à l'extérieur / touche Échap.
 * Retourne une ref à poser sur le conteneur du panneau (bouton inclus).
 */
function useDismiss(open, onClose) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  return ref
}

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
  const optionsRef = useDismiss(optionsOpen, setOptionsOpen)

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

      {/* Options (pertinent pour la vue en grille uniquement) */}
      {isGrid && (
        <div className="relative" ref={optionsRef}>
          <button
            className={`btn-ghost !px-2.5 !py-1.5 ${optionsOpen ? '!bg-night-600 text-gold-300' : ''}`}
            onClick={() => setOptionsOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={optionsOpen}
            title={t('settings.options')}
          >
            <GearIcon size={16} />
          </button>

          {optionsOpen && (
            /* z-50 : le panneau doit FLOTER AU-DESSUS des tuiles de la grille de
               collection — à z-30 il était peint DERRIÈRE les cartes (les .card /
               tuiles créant leurs propres strates). z-50 = même strate que les
               menus ItemList et le modal de suppression, qui ne coexistent jamais. */
            <div className="absolute right-0 z-50 mt-2 w-72 card p-1.5 shadow-2xl shadow-black/50">
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
          )}
        </div>
      )}
    </div>
  )
}
