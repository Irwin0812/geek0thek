/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'

/**
 * Pied de page global : même fond sombre et uniforme que la barre de
 * navigation principale (Navbar.jsx — bg-night-950/85 + backdrop-blur),
 * pour fermer le « cadre » de l'application dans tous les thèmes, y compris
 * le thème « Médiathèque » (fond clair) où le pied reste foncé comme la nav.
 *
 * FIXÉ EN BAS DE FENÊTRE (fixed bottom-0) : ne suit plus le défilement des
 * pages, toujours visible en bas de la zone de visualisation. z-30 —
 * IMPÉRATIVEMENT sous le bouton « TOP » (z-40, cf. TopButton.jsx) et les
 * modales (z-50) : aucune collision de calque, le bouton reste cliquable
 * par-dessus. Le <main> du layout (App.jsx) porte un padding-bottom
 * compensatoire (pb-20) pour que le contenu ne passe jamais sous la barre.
 *
 * LAYOUT RESPONSIVE (flex flex-col md:flex-row, w-full px-4) :
 *   - MOBILE / TABLETTE (< md) : les 3 blocs s'empilent verticalement
 *     (flex-col), centrés (text-center) — aucun débordement horizontal.
 *   - DESKTOP (>= md) : disposition en une ligne (md:flex-row) :
 *     BLOC 1 (gauche) : « Soutenez le projet ! » (gras, couleur du thème
 *     actif via --accent-strong ; jaune moutarde pour le thème BD via
 *     comic.css) suivi immédiatement de l'image/bouton PayPal
 *     (/img/paypal.png). Aucun élément ne déborde.
 *     BLOC 2 (centre) : UNIQUEMENT la mention « Geek0thek - Bibliothèque de
 *     collections par GERARTS Irwin - 2026 », centrée au milieu de l'écran.
 *     BLOC 3 (droite) : UNIQUEMENT le libellé de version « Version: <tag
 *     release> » (jaune pour le thème BD), collé strictement à l'extrême
 *     droite. Masqué COMPLÈTEMENT tant qu'aucune Release GitHub officielle
 *     n'est publiée (« No releases published »).
 *
 * TOUTES les chaînes visibles sont internationalisées via useTranslation()
 * (clé « footer.* » présente dans les 6 dictionnaires de langues).
 */

export default function Footer() {
  const { t } = useTranslation()
  // Version de la webapp = tag de la dernière Release GitHub officielle
  // (ex. « v1.0.0 »). Une seule requête au montage ; jamais d'erreur affichée :
  // si aucune release n'est publiée, ou si l'API GitHub est injoignable /
  // quota atteint, le libellé « Version: … » reste totalement masqué.
  const [version, setVersion] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .version()
      .then((data) => {
        if (!cancelled && data && data.release && data.release.tag) {
          setVersion(data.release.tag)
        }
      })
      .catch(() => {
        /* jamais d'erreur affichée : version masquée en cas de doute */
      })
    return () => {
      cancelled = true
    }
  }, [])

  // cb-footer : accroche charte « Comic Books » (thèmes/comic.css) — pied de
  // page bordeaux qui s'accorde à la barre haute. Inerte ailleurs. Les thèmes
  // « Médiathèque » / « Comic Books » recolorent .cb-footer div / a ; les
  // libellés « Soutenez le projet ! » et « Version: <tag release> » utilisent la
  // variable --accent-strong (inline), forcée en jaune moutarde par comic.css.
  return (
    <footer className="cb-footer fixed bottom-0 left-0 right-0 z-30 border-t border-night-700/70 bg-night-950/85 backdrop-blur">
      {/* RESPONSIVE : empilement vertical centré sur mobile/tablette,
          disposition en une ligne (3 blocs) à partir de md — aucun
          débordement horizontal possible. */}
      <div className="w-full px-4 py-3 flex flex-col md:flex-row md:items-center gap-3 text-xs text-slate-400">
        {/* BLOC 1 — GAUCHE (desktop) : « Soutenez le projet ! » + bouton PayPal,
            alignés à gauche sur desktop, centrés sur mobile. Toujours visible. */}
        <a
          href="https://www.paypal.com/donate/?hosted_button_id=Y7LQW3UKPY5VN"
          target="_blank"
          rel="noopener noreferrer"
          className="cb-footer-donate justify-self-start inline-flex items-center gap-3 min-w-0 justify-center md:justify-start text-left transition-all duration-200 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-xl"
        >
          <span
            className="font-bold text-base whitespace-nowrap"
            style={{ color: 'var(--accent-strong)' }}
          >
            {t('footer.support')}
          </span>
          {/* Image locale du bouton PayPal : hauteur ajustée (h-9 = 36px) pour
              s'ajuster à la hauteur du footer, largeur proportionnelle
              (w-auto) — jamais de déformation. */}
          <img
            src="/img/paypal.png"
            alt={t('footer.paypal')}
            className="h-9 w-auto shrink-0"
            loading="lazy"
          />
        </a>

        {/* BLOC 2 — CENTRE : mention de crédit UNIQUEMENT (footer.copyright),
            centrée ; le texte peut passer à la ligne sur mobile. */}
        <div className="text-center leading-relaxed">
          {t('footer.copyright')}
        </div>

        {/* BLOC 3 — DROITE (desktop) : libellé de version UNIQUEMENT, collé
            strictement à l'extrême droite ; centré sur mobile. */}
        <span
          className="cb-footer-version text-center md:text-right font-bold text-sm whitespace-nowrap"
          style={{ color: 'var(--accent-strong)' }}
          title="Version (release GitHub)"
        >
          {version ? `Version: ${version}` : ''}
        </span>
      </div>
    </footer>
  )
}
