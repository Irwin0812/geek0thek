/*
 * Copyright (C) 2026 Irwin
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/**
 * Petits drapeaux nationaux (SVG inline, couleurs fixes) pour le sélecteur de
 * langue. SVG inline plutôt qu'emojis natifs : les emojis s'affichent mal /
 * inconstamment sur Windows (Segoe UI Emoji), alors que le SVG reste net et
 * identique dans tous les navigateurs.
 *
 * Usage : <FlagIcon code="fr" className="h-3 w-4" /> — la taille est pilotée
 * par le parent via className (ratio 3:2, viewBox 60×40). Un fin anneau
 * (ring) garantit la lisibilité des bords clairs sur les fonds sombres.
 */

const FLAGS = {
  /* France : tricolore bleu-blanc-rouge (bandes verticales). */
  fr: (
    <>
      <rect width="60" height="40" fill="#ED2939" />
      <rect width="40" height="40" fill="#FFFFFF" />
      <rect width="20" height="40" fill="#0055A4" />
    </>
  ),
  /* Royaume-Uni : Union Jack (simplifiée, lisible à 16 px). */
  en: (
    <>
      <rect width="60" height="40" fill="#012169" />
      <path d="M0 0l60 40M60 0L0 40" stroke="#FFFFFF" strokeWidth="8" />
      <path d="M0 0l60 40M60 0L0 40" stroke="#C8102E" strokeWidth="3.5" />
      <path d="M30 0v40M0 20h60" stroke="#FFFFFF" strokeWidth="13" />
      <path d="M30 0v40M0 20h60" stroke="#C8102E" strokeWidth="7.5" />
    </>
  ),
  /* Italie : tricolore vert-blanc-rouge (bandes verticales). */
  it: (
    <>
      <rect width="60" height="40" fill="#D7141A" />
      <rect width="40" height="40" fill="#FFFFFF" />
      <rect width="20" height="40" fill="#009246" />
    </>
  ),
  /* Espagne : rouge-jaune-rouge (bande jaune double hauteur). */
  es: (
    <>
      <rect width="60" height="40" fill="#AA1518" />
      <rect y="10" width="60" height="20" fill="#F1BF00" />
    </>
  ),
  /* Allemagne : noir-rouge-or (bandes horizontales). */
  de: (
    <>
      <rect width="60" height="40" fill="#FFCE00" />
      <rect width="60" height="26.67" fill="#DD0000" />
      <rect width="60" height="13.33" fill="#000000" />
    </>
  ),
  /* Pays-Bas : rouge-blanc-bleu (bandes horizontales). */
  nl: (
    <>
      <rect width="60" height="40" fill="#21468B" />
      <rect width="60" height="26.67" fill="#FFFFFF" />
      <rect width="60" height="13.33" fill="#AE1C28" />
    </>
  ),
}

export default function FlagIcon({ code, className = '', ...rest }) {
  const flag = FLAGS[String(code || '').toLowerCase()]
  if (!flag) return null
  return (
    <svg
      viewBox="0 0 60 40"
      aria-hidden="true"
      className={`shrink-0 rounded-sm ring-1 ring-white/15 ${className}`}
      {...rest}
    >
      {flag}
    </svg>
  )
}
