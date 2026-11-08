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
 * BARRE À TROIS ZONES :
 *   - EXTRÊME GAUCHE : bouton « Soutenez le projet » (logo PayPal + lien
 *     officiel du bouton de don hébergé PayPal, nouvel onglet). Toujours
 *     visible — jamais masqué après un don. Style / icône / texte pilotés par
 *     les variables CSS du thème actif (--accent-strong / --accent-contrast) :
 *     le bouton s'accorde donc automatiquement aux 6 thèmes (icône en
 *     currentColor).
 *   - CENTRE : mention de crédit (inchangée).
 *   - EXTRÊME DROITE : version de la webapp EXTRAITE DE GITHUB (shortSha du
 *     dernier commit de la branche par défaut, via GET /api/version — cf.
 *     utils/githubClient.js). Absente proprement si l'API GitHub est injoignable.
 */

/**
 * Logo PayPal (monogramme « PP ») en currentColor : s'adapte à la couleur du
 * texte du bouton (var(--accent-contrast)) et donc au thème actif. Deux « P »
 * superposés (le second décalé + atténué) pour le rendu « couches » de la
 * marque, sans aucune dépendance externe ni image distante.
 */
function PayPalMark({ size = 18 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      {/* « P » arrière : décalé en haut à droite, atténué (effet de profondeur). */}
      <path
        opacity="0.5"
        transform="translate(2.5 -1.5)"
        fillRule="evenodd"
        d="M6 3h5a4 4 0 0 1 0 8h-3v10H6zM9 6h1.5a1.5 1.5 0 0 1 0 3H9z"
      />
      {/* « P » avant : pleine opacité. */}
      <path fillRule="evenodd" d="M6 3h5a4 4 0 0 1 0 8h-3v10H6zM9 6h1.5a1.5 1.5 0 0 1 0 3H9z" />
    </svg>
  )
}

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

  // cb-footer : accroche charte « Comic Books » (thèmes/comic-books.css) —
  // pied de page rouge comic qui s'accorde à la barre haute. Inerte ailleurs.
  // Les thèmes « Médiathèque » / « Comic Books » recolorent .cb-footer div / a ;
  // le bouton PayPal et l'icône utilisent les variables --accent-strong /
  // --accent-contrast (inline) pour rester harmonisés dans les 6 thèmes.
  return (
    <footer className="cb-footer fixed bottom-0 left-0 right-0 z-30 border-t border-night-700/70 bg-night-950/85 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-x-3 gap-y-1 flex-wrap text-xs text-slate-400">
        {/* EXTRÊME GAUCHE — bouton de soutien (PayPal). Toujours visible. */}
        <a
          href="https://www.paypal.com/donate/?hosted_button_id=Y7LQW3UKPY5VN"
          target="_blank"
          rel="noopener noreferrer"
          className="cb-footer-donate inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 font-semibold shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
          style={{ background: 'var(--accent-strong)', color: 'var(--accent-contrast)' }}
        >
          <PayPalMark />
          <span className="whitespace-nowrap">Soutenez le projet</span>
        </a>

        {/* CENTRE — mention de crédit (inchangée). */}
        <div className="flex-1 min-w-[180px] text-center leading-relaxed">
          Geek0thek - Bibliothèque de collections par{' '}
          <a href="mailto:webmaster@igerarts.be" className="text-slate-300 underline-offset-2 transition hover:text-gold-300 hover:underline">
            GERARTS Irwin
          </a>{' '}
          - 2026
        </div>

        {/* EXTRÊME DROITE — version de la webapp extraite de GitHub. */}
        <span
          className="font-bold text-lg whitespace-nowrap"
          style={{ color: 'var(--accent-strong)' }}
          title="Version (commit GitHub)"
        >
          {version ? `Version: ${version}` : ''}
        </span>
      </div>
    </footer>
  )
}
