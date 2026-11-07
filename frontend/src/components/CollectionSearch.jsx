/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchIcon } from './icons.jsx'

/**
 * Champ de recherche des pages de collection (« Mes Disques », « Mes BD »).
 *
 * - Icône loupe en retrait à gauche, centrée verticalement, teinte discrète
 *   (slate-500) adaptée au thème sombre ; `pointer-events-none` pour laisser
 *   le clic traverser vers le champ.
 * - Hauteur forcée à `h-12` (48px) pour coller exactement à celle de la
 *   toolbar et du bouton d'action, quelle que soit la disposition.
 * - `!px-10` à gauche laisse la place à l'icône sans que le placeholder
 *   ne la chevauche ; `!rounded-xl` reprend l'arrondi de la toolbar.
 * - `flex-1 min-w-[220px]` : le champ absorbe toute la largeur disponible de
 *   la barre d'actions au lieu de forcer le bouton « Ajouter » à passer sous
 *   la toolbar (et `sm:max-w-xs` plafonne sa largeur en desktop).
 * - Défilement au survol (marquee) : si le placeholder est tronqué, à
 *   l'entrée du pointer le texte défile vers la gauche (overflow-hidden +
 *   translateX), s'arrête, puis revient à sa position initiale à la fin du
 *   cycle (et instantanément si le survol s'arrête). Une copie mesurant du
 *   texte (invisible, mêmes contraintes de largeur que le champ) permet de
 *   calculer la distance et d'animer uniquement si le texte déborde.
 */
export default function CollectionSearch({ value, onChange, placeholder }) {
  const { t } = useTranslation()
  const effectivePlaceholder = placeholder ?? t('collection.searchPlaceholder')
  const measureRef = useRef(null)
  const [marquee, setMarquee] = useState(null) // { distance, duration } | null

  // Mesure au survol : distance réelle entre la largeur du texte et l'espace
  // disponible (left-10 / right-10, identiques au padding `!px-10` du champ). Pas de
  // défilement si le texte tient ou si la mesure est impossible.
  const handleMouseEnter = () => {
    const el = measureRef.current
    if (!el) return
    const distance = el.scrollWidth - el.clientWidth
    if (distance <= 0) return
    const duration = Math.max(4, Math.min(12, distance / 55))
    setMarquee({ distance, duration })
  }

  const style = marquee
    ? {
        '--marquee-distance': `${marquee.distance}px`,
        '--marquee-duration': `${marquee.duration}s`,
      }
    : null

  return (
    <div
      className="relative flex-1 min-w-[220px] sm:max-w-xs"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setMarquee(null)}
    >
      {/* Loupe intégrée à gauche du champ, centrée verticalement. */}
      <SearchIcon
        size={17}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500"
      />

      {/* Texte défilant (remplace le placeholder natif pendant l'animation) :
          même positionnement / même largeur disponible que le texte du champ.
          ⚠️ AFFICHÉ UNIQUEMENT QUAND LE CHAMP EST VIDE (`!value`) : avec un
          placeholder natif actif, le span défilant se superposait au texte saisi
          (les deux étaient peints en même temps). Dès le premier caractère,
          `value` n'est plus vide → le span disparaît et seul le texte saisi
          reste visible ; si le champ est vidé, le placeholder réapparaît. */}
      {marquee && !value && (
        <span aria-hidden="true" className="pointer-events-none absolute left-10 right-10 top-0 z-10 flex h-full items-center overflow-hidden">
          <span className="animate-marquee block w-max whitespace-nowrap text-sm text-slate-500" style={style}>
            {effectivePlaceholder}
          </span>
        </span>
      )}

      {/* h-12 (48px) : même hauteur que la toolbar et que le bouton d'action,
          quelle que soit la largeur disponible. Placeholder NATIF : l'attribut
          `placeholder` est actif dès que le span défilant n'est pas affiché —
          le navigateur efface le texte indicatif dès le premier caractère saisi
          et le réaffiche si le champ est vidé. Pendant l'animation marquee
          (survol, champ vide), c'est le span qui porte le texte : on vide alors
          l'attribut natif pour éviter un DOUBLE texte superposé. */}
      <input
        tabIndex={marquee ? -1 : undefined}
        className="input h-12 !px-10 !rounded-xl"
        placeholder={marquee && !value ? '' : effectivePlaceholder}
        value={value}
        onChange={onChange}
      />

      {/* Mesure : copie invisible du placeholder, largeur strictement égale à
          celle du champ — scrollWidth donne la largeur naturelle du texte. */}
      <span
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-10 right-10 top-1/2 -translate-y-1/2 overflow-hidden opacity-0"
      >
        <span className="block w-max whitespace-nowrap text-sm">{effectivePlaceholder}</span>
      </span>
    </div>
  )
}
