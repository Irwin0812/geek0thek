/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useEffect, useState } from 'react'
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
 * GRILLE RIGIDE À 3 COLONNES STRICTES (grid grid-cols-3 items-center w-full px-4) :
 *   - COLONNE 1 (gauche — justify-self-start / text-left) : « Soutenez le
 *     projet ! » (gras, couleur du thème actif via --accent-strong ; jaune
 *     moutarde pour le thème BD via comic.css) suivi immédiatement de
 *     l'image/bouton PayPal (/img/paypal.png). Aucun élément ne déborde.
 *   - COLONNE 2 (centre exact — justify-self-center / text-center) :
 *     UNIQUEMENT la mention « Geek0thek - Bibliothèque de collections par
 *     GERARTS Irwin - 2026 », parfaitement centrée au milieu de l'écran.
 *   - COLONNE 3 (droite — justify-self-end / text-right) : UNIQUEMENT le
 *     libellé de version « Version: <shortSha> » (jaune pour le thème BD),
 *     collé strictement à l'extrême droite.
 */

export default function Footer() {
  // Version de la webapp extraite de GitHub (shortSha du HEAD de la branche
  // par défaut). Une seule requête au montage ; jamais d'erreur affichée :
  // si l'API GitHub est injoignable / quota atteint, le champ reste vide.
  const [version, setVersion] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .version()
      .then((data) => {
        if (!cancelled && data && data.github && data.github.shortSha) {
          setVersion(data.github.shortSha)
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
  // libellés « Soutenez le projet ! » et « Version: <sha> » utilisent la
  // variable --accent-strong (inline), forcée en jaune moutarde par comic.css.
  return (
    <footer className="cb-footer fixed bottom-0 left-0 right-0 z-30 border-t border-night-700/70 bg-night-950/85 backdrop-blur">
      {/* GRILLE RIGIDE À 3 COLONNES STRICTES : chaque colonne occupe exactement
          1/3 de la largeur (grid-cols-3) — le centre est mathématiquement au
          milieu de l'écran, aucun chevauchement possible. */}
      <div className="w-full px-4 py-3 grid grid-cols-3 items-center text-xs text-slate-400">
        {/* COLONNE 1 — GAUCHE : « Soutenez le projet ! » + bouton PayPal,
            alignés strictement à gauche. Toujours visible. */}
        <a
          href="https://www.paypal.com/donate/?hosted_button_id=Y7LQW3UKPY5VN"
          target="_blank"
          rel="noopener noreferrer"
          className="cb-footer-donate justify-self-start text-left inline-flex items-center gap-3 min-w-0 transition-all duration-200 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-xl"
        >
          <span
            className="font-bold text-base whitespace-nowrap"
            style={{ color: 'var(--accent-strong)' }}
          >
            Soutenez le projet !
          </span>
          {/* Image locale du bouton PayPal : hauteur ajustée (h-9 = 36px) pour
              s'ajuster à la hauteur du footer, largeur proportionnelle
              (w-auto) — jamais de déformation. */}
          <img
            src="/img/paypal.png"
            alt="Bouton de don PayPal"
            className="h-9 w-auto shrink-0"
            loading="lazy"
          />
        </a>

        {/* COLONNE 2 — CENTRE EXACT : mention de crédit UNIQUEMENT, centrée au
            milieu de l'écran. */}
        <div className="justify-self-center text-center leading-relaxed whitespace-nowrap">
          Geek0thek - Bibliothèque de collections par{' '}
          <a href="mailto:webmaster@igerarts.be" className="text-slate-300 underline-offset-2 transition hover:text-gold-300 hover:underline">
            GERARTS Irwin
          </a>{' '}
          - 2026
        </div>

        {/* COLONNE 3 — DROITE : libellé de version UNIQUEMENT, collé strictement
            à l'extrême droite. */}
        <span
          className="cb-footer-version justify-self-end text-right font-bold text-sm whitespace-nowrap"
          style={{ color: 'var(--accent-strong)' }}
          title="Version (commit GitHub)"
        >
          {version ? `Version: ${version}` : ''}
        </span>
      </div>
    </footer>
  )
}
