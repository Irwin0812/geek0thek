/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/**
 * Couleurs de galettes (vinyles) — source unique partagée entre le formulaire
 * d'ajout/édition (AddVinyl.jsx) et la modale de détails (ItemDetailModal.jsx).
 *
 * La colonne `vinyls.color` (TEXT) stocke une liste séparée par des virgules
 * (« Noir, Rouge ») ; les helpers ci-dessous normalisent cette valeur en
 * tableau, traduisent chaque libellé et rendent la pastille ronde de la teinte.
 */

import i18n from '../i18n/i18n.js'

/* Option « N/A » du menu « Couleur » : pas de couleur enregistrée
   (valeur stockée en base, colonne vinyls.color TEXT sans liste). */
export const COLOR_NA = 'N/A'

/* Couleurs de galettes proposées dans le menu « Couleur » (multi-select) :
   teintes de base, nuances / finitions (pâle, foncé, clair, fluo, mat, vif,
   flash, brillant, pailleté, métallisé…), transparent et finitions
   métallisées / spéciales, chacune avec la teinte (couleur CSS) de sa
   pastille ronde affichée à côté du libellé. */
export const DISC_COLORS = [
  { value: 'Noir', hex: '#17181b' },
  { value: 'Blanc', hex: '#f5f5f4' },
  { value: 'Rouge', hex: '#dc2626' },
  { value: 'Bleu', hex: '#2563eb' },
  { value: 'Vert', hex: '#16a34a' },
  { value: 'Jaune', hex: '#eab308' },
  { value: 'Violet', hex: '#7c3aed' },
  { value: 'Rose', hex: '#ec4899' },
  { value: 'Orange', hex: '#f97316' },
  { value: 'Mauve', hex: '#b07bb5' },
  { value: 'Turquoise', hex: '#14b8a6' },
  { value: 'Fuchsia', hex: '#d946ef' },
  { value: 'Beige', hex: '#e0cfa8' },
  { value: 'Crème', hex: '#f7f0d8' },
  { value: 'Brun', hex: '#6f4e37' },
  { value: 'Pâle', hex: '#d6d3e0' },
  { value: 'Foncé', hex: '#2f2f3a' },
  { value: 'Clair', hex: '#e5e7eb' },
  { value: 'Fluo', hex: '#39ff14' },
  { value: 'Mat', hex: '#9ca3af' },
  { value: 'Vif', hex: '#ff3b30' },
  { value: 'Flash', hex: 'linear-gradient(135deg, #f8fafc 0%, #cbd5e1 40%, #f8fafc 60%, #94a3b8 100%)' },
  { value: 'Brillant', hex: 'linear-gradient(135deg, #ffffff 0%, #e2e8f0 45%, #94a3b8 100%)' },
  { value: 'Pailleté', hex: 'radial-gradient(circle at 30% 30%, #f8fafc 0 12%, transparent 13%), radial-gradient(circle at 70% 60%, #e2e8f0 0 10%, transparent 11%), radial-gradient(circle at 50% 80%, #cbd5e1 0 9%, transparent 10%), #475569' },
  { value: 'Métallisé', hex: 'linear-gradient(135deg, #94a3b8 0%, #e2e8f0 35%, #64748b 65%, #cbd5e1 100%)' },
  { value: 'Transparent', hex: 'rgba(148, 163, 184, 0.3)' },
  { value: 'Or', hex: '#d4a017' },
  { value: 'Argent', hex: '#cbd5e1' },
  { value: 'Cuivre', hex: '#b87333' },
  { value: 'Bronze', hex: '#8c6239' },
  { value: 'Marbré', hex: 'linear-gradient(135deg, #17181b 0%, #17181b 45%, #cbd5e1 50%, #17181b 55%, #17181b 70%, #e2e8f0 75%, #17181b 100%)' },
  { value: 'Splatter', hex: 'radial-gradient(circle at 30% 35%, #dc2626 0 14%, transparent 15%), radial-gradient(circle at 62% 60%, #f8fafc 0 10%, transparent 11%), radial-gradient(circle at 75% 28%, #dc2626 0 8%, transparent 9%), radial-gradient(circle at 45% 78%, #f8fafc 0 7%, transparent 8%), #17181b' },
]

/* « Couleurs » (multi-select) : normalise la valeur reçue de l'API en TABLEAU
   de chaînes uniques. Tolère un tableau (nouveau format), une chaîne séparée
   par des virgules (format stocké en base, colonne vinyls.color TEXT) ou une
   valeur simple héritée (legacy mono-couleur). Valeur absente / invalide ->
   `fallback` (défaut ['Noir']). */
export const toColorList = (value, fallback = ['Noir']) => {
  const raw = Array.isArray(value) ? value : String(value || '').split(',')
  const out = []
  for (const part of raw) {
    const s = String(part || '').trim()
    if (s && !out.includes(s)) out.push(s)
  }
  return out.length ? out : fallback
}

/* Pastille d'accompagnement des choix du menu « Couleurs » (multi-select) :
   – couleur connue → petit cercle de la teinte (hex / dégradé de
     DISC_COLORS — « Marbré », « Splatter », « Flash », « Brillant »,
     « Pailleté » et « Métallisé » portent un gradient CSS) ;
   – « N/A » → cercle barré et vide (SVG : anneau + diagonale).
   Une discrète bordure rend visibles les teintes claires et transparentes. */
export function colorDot(value, size = 14) {
  if (value === COLOR_NA || !value) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="shrink-0 text-slate-500"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M5.64 18.36 18.36 5.64" />
      </svg>
    )
  }
  const c = DISC_COLORS.find((d) => d.value === value)
  return (
    <span
      className="inline-block shrink-0 rounded-full border border-slate-400/50"
      style={{ width: size, height: size, background: c ? c.hex : '#475569' }}
      aria-hidden="true"
    />
  )
}

/* Libellé d'une valeur de couleur traduit : les couleurs inconnues héritées
   (legacy) sont affichées telles quelles, avec leur pastille grise. Les clés
   i18n utilisent la valeur SANS ACCENT du code-barres (« Marbre » en base ->
   `vinylForm.colors.Marbre`, « Bande Dessinee » etc.) — valeur stockée en
   base (colonne vinyls.color, sans liste contrôlée). */
export const colorLabel = (value, t) => {
  const s = String(value || '')
  if (!s) return '—'
  // Valeur héritée inconnue : repli tel quel (le « é » de « Marbré » hérité
  // n'existe pas en clé ; on retire les accents — décomposition NFD pour les
  // formes précomposées — pour la recherche du libellé).
  const key = `vinylForm.colors.${s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')}`
  return i18n.exists(key) ? t(key) : s
}

/* Couleurs du menu « Couleur » triées ALPHABÉTIQUEMENT par libellé TRADUIT
   (langue d'affichage courante, localeCompare) : « N/A » reste en tête du
   menu (rendu séparément dans AddVinyl.jsx), les autres couleurs suivent
   dans l'ordre alphabétique de leur libellé traduit. */
export const sortedDiscColors = (t) =>
  [...DISC_COLORS].sort((a, b) => colorLabel(a.value, t).localeCompare(colorLabel(b.value, t)))
