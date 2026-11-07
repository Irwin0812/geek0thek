/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/**
 * Icônes SVG inline (trait 1.75, style régulier) utilisées par la toolbar
 * de vue, le menu d'options, la vue liste et les menus contextuels.
 * Toutes acceptent `size` (px) et `className` pour le coloris.
 */
const base = (size, className, children) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const GridIcon = (p) =>
  base(p.size || 16, p.className, (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
    </>
  ))

export const ListIcon = (p) =>
  base(p.size || 16, p.className, (
    <>
      <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
      <path d="M13.5 6h7.5" />
      <path d="M13.5 10h4.5" />
      <path d="M13.5 16.5h7.5" />
      <path d="M13.5 20.5h4.5" />
    </>
  ))

export const GearIcon = (p) =>
  base(p.size || 16, p.className, (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5a.6.6 0 0 0 .1-.8l-2-3.4a.6.6 0 0 0-.7-.3l-2.4.9a7.6 7.6 0 0 0-2.6-1.5l-.4-2.5a.6.6 0 0 0-.6-.5h-4a.6.6 0 0 0-.6.5l-.4 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.4-.9a.6.6 0 0 0-.7.3l-2 3.4a.6.6 0 0 0 .1.8l2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5a.6.6 0 0 0-.1.8l2 3.4c.1.3.5.4.8.3l2.3-.9a7.6 7.6 0 0 0 2.6 1.5l.4 2.5c0 .3.3.5.6.5h4c.3 0 .6-.2.6-.5l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3.9c.3.1.7 0 .8-.3l2-3.4a.6.6 0 0 0-.1-.8z" />
    </>
  ))

export const CheckIcon = (p) =>
  base(p.size || 16, p.className, <path d="M20 6 9 17l-5-5" />)

export const StarIcon = ({ size = 16, className = '', filled = true }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.6l-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9z" />
  </svg>
)

export const CCIcon = ({ size = 16, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    className={className}
    aria-label="Sous-titres"
  >
    <rect x="1.5" y="4.5" width="21" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.75" />
    <path d="M10 10.4a2.2 2.2 0 1 0 0 3.2M17.4 10.4a2.2 2.2 0 1 0 0 3.2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
  </svg>
)

export const HeartIcon = ({ size = 16, className = '', filled = true }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 20.8 4.2 13a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1a4.8 4.8 0 0 1 6.8 6.8z" />
  </svg>
)

export const PencilIcon = (p) =>
  base(p.size || 16, p.className, (
    <>
      <path d="M12.5 6.5 17.5 11.5" />
      <path d="M4 20l1.2-4.2L16.4 4.6a1.8 1.8 0 0 1 2.6 0l.4.4a1.8 1.8 0 0 1 0 2.6L8.2 18.8z" />
    </>
  ))

export const TrashIcon = (p) =>
  base(p.size || 16, p.className, (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
      <path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ))

/** Petite planète / globe (menu « Langue » du dropdown utilisateur, couleur cyan). */
export const GlobeIcon = (p) =>
  base(p.size || 16, p.className, (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9z" />
    </>
  ))

export const MoreIcon = ({ size = 16, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </svg>
)

export const EyeIcon = (p) =>
  base(p.size || 16, p.className, (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ))

export const SearchIcon = (p) =>
  base(p.size || 16, p.className, (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20.5 20.5-4.5-4.5" />
    </>
  ))

/** Cadenas (tuiles « PROCHAINEMENT » du tableau de bord). */
export const LockIcon = (p) =>
  base(p.size || 16, p.className, (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
    </>
  ))
