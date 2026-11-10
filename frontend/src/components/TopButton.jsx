/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp } from 'lucide-react'

/**
 * BOUTON GLOBAL « TOP » — RETOUR EN HAUT DE LA PAGE.
 *
 *  - Montage UNIQUE au level du layout principal (App.jsx, frère de
 *    <Navbar /> et <Footer />) : présent sur TOUTES les pages authentifiées
 *    (Tableau de bord, Mes Disques, Mes BD, formulaires d'ajout / édition,
 *    Profil, Utilisateurs), MASQUÉ sur l'écran de connexion (pas de Navbar)
 *    et JAMAIS à l'intérieur des modales — les modales existent en overlay
 *    au-dessus de la page ; le bouton reste sous elles (z-40 < z-50) et, dès
 *    qu'une modale est ouverte, le défilement de la page est bloqué
 *    (overflow:hidden sur <html>, cf. ItemDetailModal / BarcodeModal /
 *    IsbnModal / AdminUsers / Avatar), donc aucun repliement visible.
 *  - Visible UNIQUEMENT dès que le défilement vertical de la fenêtre
 *    dépasse 300 px (window.scrollY > 300) : invisible en haut de page.
 *    L'état de remontée automatique de App.jsx (scrollTo top à chaque route)
 *    s'accompagne donc toujours d'un bouton masqué au rendu de la page.
 *    Écouteur PASSIF : addEventListener('scroll', …, { passive: true }).
 *  - Forme PARFAITEMENT RONDE : dimensions fixes égales (w-14 h-14) +
 *    rounded-full, contenu (flèche « ^ » + mention textuelle « TOP »)
 *    centré en flexbox.
 *  - Tons AMBRE / OR CHAUD du thème Geek0thek : bg-amber-500
 *    hover:bg-amber-400 text-slate-950 — la teinte s'éclaircit au survol,
 *    lueurs comprises.
 *  - BRILLANCE DYNAMIQUE au survol : halo lumineux flou (blur-xl, amber-400)
 *    qui s'allume en fondu sous la main + ombre dorée
 *    hover:shadow-[0_0_20px_rgba(251,191,36,0.6)].
 *  - Clic : window.scrollTo({ top: 0, behavior: 'smooth' }) — la page remonte
 *    tout en haut en flux doux (saut immédiat si `prefers-reduced-motion`).
 */

/** Respecte `prefers-reduced-motion: reduce` (saut immédiat si actif). */
function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (e) => setReduced(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export default function TopButton() {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  const reducedMotion = useReducedMotion()

  /* Apparition / disparition à partir du SEUIL DE 300 PX de défilement. */
  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <button
      id="top-button"
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })}
      aria-label={t('common.backToTop')}
      title={t('common.backToTop')}
      tabIndex={visible ? 0 : -1}
      className={`group fixed bottom-20 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-slate-950 shadow-[0_10px_25px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.18)_inset] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-amber-400 hover:shadow-[0_0_20px_rgba(251,191,36,0.6),0_4px_14px_rgba(251,191,36,0.4),0_0_0_1px_rgba(255,255,255,0.35)_inset] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 ${
        visible ? 'scale-100 opacity-100' : 'pointer-events-none scale-90 opacity-0'
      }`}
    >
      {/* HALO DORÉ de brillance dynamique : flou amber-400 derrière la pastille,
          allumé en fondu au survol (transition-opacity portée par le group). */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -inset-1.5 rounded-full bg-amber-400/60 opacity-0 blur-xl transition-opacity duration-300 ease-out group-hover:opacity-70"
      />
      {/* Contenu centré en flexbox : flèche « ^ » + mention textuelle « TOP ». */}
      <span className="relative flex flex-col items-center justify-center gap-[1px]">
        <ArrowUp size={16} strokeWidth={2.75} aria-hidden="true" />
        <span className="text-[9px] font-extrabold leading-none tracking-wider">TOP</span>
      </span>
    </button>
  )
}
