/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/**
 * Icônes par thème du sous-menu « Thème » (menu déroulant de l'utilisateur).
 * Une icône GRAPHIQUE et distincte par thème — les pastilles de palette restent
 * le repère secondaire (cf. Navbar) mais l'icône devient le repère principal :
 *
 *  - « dark »        (Geek0thek, défaut) → la favicon du site : cercle encre
 *    + point or (identique au <link rel="icon"> de index.html, couleurs fixes).
 *  - 'library'       (Médiathèque)       → casque d'écoute + livre ouvert.
 *  - 'vinyl'         (Disquaire)         → vinyle : cercles concentriques néon.
 *  - 'comic'         (Bande dessinée)    → bulle de dialogue / pensée BD.
 *  - 'comic-books'   (Comic Books)       → explosion « BOOM » rétro (étoile à
 *    pics jaune + triangle noir, façon splash-page US).
 *  - 'neon'          (Néon, ex-« Pastel ») → bouton play lumineux : cercle +
 *    triangle central, dégradé bleu/violet → fuchsia, halo (blur CSS).
 *
 * Chaque icône accepte `size` (px) et `className` ; les gradients portent un id
 * unique par composant (id = "gi-…" + suffixe de thème) pour éviter toute
 * collision lors du rendu des 6 entrées côte à côte.
 */

/* Cercle encre + point or : la favicon, dans son contexte propre (couleurs
   fixes — c'est UN logo, pas un glyphe courant qui suivrait le thème). */
export function ThemeFaviconIcon({ size = 16, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="11" fill="#121826" />
      <circle cx="12" cy="12" r="3.5" fill="#d4a24e" />
    </svg>
  )
}

/* Médiathèque : casque d'écoute (arche + oreillettes) au-dessus d'un livre ouvert. */
export function ThemeLibraryIcon({ size = 16, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 13v-2a8 8 0 0 1 16 0v2" />
      <rect x="2.5" y="12.5" width="3.6" height="6" rx="1.4" fill="currentColor" stroke="none" />
      <rect x="17.9" y="12.5" width="3.6" height="6" rx="1.4" fill="currentColor" stroke="none" />
      <path d="M4 20.5c4.4-1.5 11.6-1.5 16 0" />
    </svg>
  )
}

/* Disquaire : vinyle (cercles concentriques + encre centrale) en néon ambre
   rétro sur un disque sombre. */
export function ThemeVinylIcon({ size = 16, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10.5" fill="#1a1108" stroke="#d18a3e" strokeWidth="1.6" />
      <circle
        cx="12"
        cy="12"
        r="7"
        fill="none"
        stroke="#d18a3e"
        strokeWidth="1"
        opacity="0.85"
      />
      <circle
        cx="12"
        cy="12"
        r="4.2"
        fill="none"
        stroke="#ffb35c"
        strokeWidth="1"
        opacity="0.75"
      />
      <circle cx="12" cy="12" r="1.8" fill="#ffd9a0" />
    </svg>
  )
}

/* Bande dessinée : bulle de dialogue (avec sa queue) + petits points « pensée ». */
export function ThemeComicIcon({ size = 16, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 2.6c5.2 0 9 3.3 9 7.2s-3.8 7.2-9 7.2a10 10 0 0 1-3-.5L5 21l.4-3.4C3.1 16.2 2 14 2 12.4c0-3.9 3.8-7.2 9-7.2z"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="12" r="1.15" fill="currentColor" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" />
      <circle cx="16" cy="12" r="1.15" fill="currentColor" />
    </svg>
  )
}

/* Comic Books : explosion « BOOM » à la rétro US — étoile à pics (jaune),
   anneau intérieur (crème) et triangle noir. Couleurs fixes : l'icône DOIT
   rester lisible quel que soit le thème appliqué (comme la favicon). */
export function ThemeComicBooksIcon({ size = 16, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <polygon fill="#f2d94e" points="1.70 12.00 6.48 11.03 1.93 8.34 6.86 9.03 4.11 5.38 8.31 7.60 6.95 3.26 9.90 6.23 10.18 1.65 12.00 5.40 13.52 3.38 14.35 5.55 16.63 3.97 16.24 6.94 18.86 6.24 17.60 8.77 21.00 8.72 18.63 10.83" />
      <polygon fill="#fffdf5" points="5.00 12.01 8.36 11.46 5.56 9.71 8.53 10.19 6.88 7.65 9.71 9.18 8.94 5.80 10.96 7.87 11.12 4.42 12.30 7.33 13.28 5.90 13.83 7.63 15.39 6.62 15.14 8.71 16.92 8.24 15.70 9.96 18.07 9.90 16.36 11.21" />
      <polygon fill="#191105" points="9.2 8.6 16.2 12.0 9.2 15.4 9.2 8.6" />
    </svg>
  )
}

/* Néon (ex-« Pastel ») : bouton play lumineux — cercle + triangle central,
   dégradé bleu/indigo → fuchsia, halo néon par CSS (filtre flou sur le même
   tracé, identifiant de gradient unique). */
export function ThemeNeonPlayIcon({ size = 16, className = '' }) {
  const gradId = 'gi-neon-play'
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="0.55" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#e879f9" />
        </linearGradient>
      </defs>
      {/* Halo : la même forme en flou (CSS filter, supporte userSpaceOnUse) */}
      <g style={{ filter: 'blur(3px)' }} opacity="0.9">
        <circle cx="12" cy="12" r="8.6" fill={`url(#${gradId})`} />
      </g>
      <circle cx="12" cy="12" r="8.6" fill={`url(#${gradId})`} />
      <polygon points="9.4,7.3 17.3,12 9.4,16.7" fill="#ffffff" />
    </svg>
  )
}

/**
 * Icône correspondant à une clé de thème (fallback : favicon, le plus neutre).
 * Les glyphes « courant » (casque, bulle) suivent `className` via currentColor ;
 * les icônes aux couleurs fixes (favicon, vinyle, explosion, play néon) l'ignorent.
 */
export default function ThemeIcon({ theme, size, className = '', ...rest }) {
  const p = { size: size || 18, className }
  switch (theme) {
    case 'dark':
      return <ThemeFaviconIcon {...p} {...rest} />
    case 'library':
      return <ThemeLibraryIcon {...p} {...rest} />
    case 'vinyl':
      return <ThemeVinylIcon {...p} {...rest} />
    case 'comic':
      return <ThemeComicIcon {...p} {...rest} />
    case 'comic-books':
      return <ThemeComicBooksIcon {...p} {...rest} />
    case 'neon':
      return <ThemeNeonPlayIcon {...p} {...rest} />
    default:
      return <ThemeFaviconIcon {...p} {...rest} />
  }
}
