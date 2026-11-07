/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { api } from '../services/api.js'

/**
 * BOUTON GLOBAL « MISE À JOUR DISPONIBLE » — coin supérieur droit.
 *
 *  - Montage UNIQUE au niveau du layout principal (App.jsx, frère de
 *    <TopButton />) : présent sur TOUTES les pages authentifiées, MASQUÉ sur
 *    l'écran de connexion (pas de Navbar) et JAMAIS à l'intérieur des modales.
 *  - CONDITION D'AFFICHAGE : le bouton n'apparaît QUE si l'API /api/version
 *    indique updateAvailable = TRUE, c'est-à-dire que le commit du code
 *    DÉPLOYÉ (dépôt git monté en lecture seule dans le conteneur backend)
 *    DIFFÈRE du dernier commit de la branche par défaut du dépôt GitHub
 *    (Irwin0812/geek0thek). Tant que les deux versions sont identiques, le
 *    bouton reste invisible — et il DISPARAÎT AUTOMATIQUEMENT après une mise
 *    à jour effective (`git pull && docker compose up -d --build`), car les
 *    deux SHA redeviennent alors égaux.
 *  - Vérification au CHARGEMENT de l'application (une seule requête) +
 *    re-vérification discrète toutes les 5 minutes : si l'admin met à jour
 *    pendant que la page reste ouverte, le bouton disparaît sans rechargement.
 *  - Jamais d'erreur affichée : API GitHub injoignable, quota atteint ou dépôt
 *    local absent → updateAvailable = false (bouton masqué, jamais de faux
 *    positif).
 *  - Forme RECTANGULAIRE À BORDS ARRONDIS (rounded-xl), tons AMBRE / OR CHAUD
 *    du thème Geek0thek — cohérent avec le bouton « TOP » (bg-amber-500,
 *    halo amber-400, texte slate-950) ; le thème « Comic Books » le repasse
 *    en BLEU FLASHY via l'ID `#update-button` (cf. themes/comic-books.css).
 *  - INFOBULLE AU SURVOL : petite bulle explicative (tooltip) indiquant la
 *    marche à suivre pour effectuer la mise à jour — « Faire un git pull +
 *    docker compose up -d --build pour mettre à jour ».
 */

export default function UpdateButton() {
  const { t } = useTranslation()
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [tooltipOpen, setTooltipOpen] = useState(false)

  /* Vérification de version au CHARGEMENT + re-vérification discrète toutes
     les 5 minutes (le bouton disparaît de lui-même après une mise à jour
     effective, sans recharger la page). */
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const data = await api.version()
        if (!cancelled) setUpdateAvailable(Boolean(data && data.updateAvailable))
      } catch {
        /* jamais d'erreur affichée : bouton masqué en cas de doute */
      }
    }
    check()
    const timer = setInterval(check, 5 * 60 * 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  /* Fermeture de l'infobulle à la sortie du survol (bouton OU bulle). */
  const closeTooltip = () => setTooltipOpen(false)

  if (!updateAvailable) return null

  return (
    <div
      id="update-button-wrap"
      className="group fixed right-5 top-5 z-40"
      onMouseEnter={() => setTooltipOpen(true)}
      onMouseLeave={closeTooltip}
    >
      {/* INFOBULLE : petite bulle d'information au survol — marche à suivre
          pour effectuer la mise à jour. Ancre sous le bouton, alignée à droite.
          Le pont invisible ::before (h-2 au-dessus de la bulle) couvre l'écart
          de 8 px entre le bouton et la bulle : le curseur peut traverser la
          zone sans déclencher mouseleave (la bulle reste ouverte). */}
      <div
        role="tooltip"
        className={`absolute right-0 top-full w-max max-w-[280px] rounded-lg border border-night-600 bg-night-800/95 px-3 py-2 text-left text-xs leading-relaxed text-slate-200 shadow-xl shadow-black/50 backdrop-blur-sm transition-all duration-150 ease-out before:pointer-events-auto before:absolute before:-top-2 before:left-0 before:h-2 before:w-full before:content-[''] ${
          tooltipOpen ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
        }`}
      >
        <span className="mb-1 block font-semibold text-gold-300">{t('update.tooltipTitle')}</span>
        {t('update.tooltipSteps')}
        <code className="mt-1.5 block rounded bg-night-950/80 px-2 py-1 font-mono text-[11px] leading-snug text-gold-200">
          git pull &amp;&amp; docker compose up -d --build
        </code>
      </div>

      {/* BOUTON RECTANGULAIRE À BORDS ARRONDIS — même charte que « TOP ». */}
      <button
        id="update-button"
        type="button"
        onClick={() => window.location.reload()}
        aria-label={t('update.available')}
        tabIndex={0}
        className="relative flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-[0_10px_25px_rgba(0,0,0,0.45),0_0_0_1px_rgba(255,255,255,0.18)_inset] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-amber-400 hover:shadow-[0_0_20px_rgba(251,191,36,0.6),0_4px_14px_rgba(251,191,36,0.4),0_0_0_1px_rgba(255,255,255,0.35)_inset] focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300"
      >
        {/* HALO DORÉ de brillance dynamique : flou amber-400 derrière le bouton,
            allumé en fondu au survol (transition-opacity portée par le group). */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-1.5 rounded-xl bg-amber-400/60 opacity-0 blur-xl transition-opacity duration-300 ease-out group-hover:opacity-70"
        />
        <RefreshCw size={16} strokeWidth={2.75} aria-hidden="true" className="relative" />
        <span className="relative whitespace-nowrap">{t('update.available')}</span>
      </button>
    </div>
  )
}
