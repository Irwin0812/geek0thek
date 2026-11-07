import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Barre de filtre alphabétique horizontale (#, A–Z) des pages de collections.
 *
 * - Disposition : UNE ligne horizontale, intégrée directement SOUS le bloc de
 *   recherche / sélection Grille-Liste (cf. pages Collection / ComicCollection).
 * - Boutons : `#` (chiffres + caractères spéciaux) puis A à Z, suivi d'un
 *   bouton de réinitialisation « Tous » qui lève le filtre actif et réaffiche
 *   la vue globale complète.
 * - Normalisation des accents : É/È/Ê → E, À/Â/Ä → A… via NFD + suppression des
 *   diacritiques — « Les Étrangers » correspond donc au bouton E, « À la page »
 *   au bouton A.
 * - Style : piloté par les variables CSS du thème actif (--accent-strong,
 *   --accent-contrast, --ring) ; les thèmes « Médiathèque » et « Comic Books »
 *   scellent leurs propres déclinaisons (cf. themes/library.css,
 *   themes/comic-books.css).
 *
 * Props :
 *  - labels    : liste de libellés à filtrer (noms d'artistes / de séries)
 *  - value     : lettre active ('A'…'Z', '#' ou null)
 *  - onChange  : callback(letterOrNull) — null = filtre levé
 */

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/** Normalise un libellé : minuscules, diacritiques retirés (É → e, À → a…). */
export function normalizeLabel(label) {
  return String(label || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Lettre de la barre correspondant à un libellé :
 *  - '#' si le premier caractère significatif est un chiffre ou un caractère
 *    spécial (ni lettre ni espace) ;
 *  - sinon la première LETTRE du libellé, accent normalisé.
 */
export function letterOf(label) {
  const clean = normalizeLabel(label).replace(/^[^a-z0-9]+/, '')
  if (!clean) return '#'
  return /^[0-9]/.test(clean) ? '#' : clean[0].toUpperCase()
}

/** Compteurs par lettre : { A: 3, B: 1, ... } — les lettres vides sont absentes. */
export function countLetters(labels) {
  const counts = {}
  for (const label of labels || []) {
    const letter = letterOf(label)
    counts[letter] = (counts[letter] || 0) + 1
  }
  return counts
}

export default function AlphabetFilterBar({ labels, value, onChange }) {
  const { t } = useTranslation()
  const counts = useMemo(() => countLetters(labels), [labels])

  const buttonCls = (letter) => {
    const active = value === letter
    const empty = !counts[letter]
    return `h-8 min-w-[2rem] shrink-0 rounded-lg px-1 text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
      active
        ? 'bg-[var(--accent-strong)] text-[var(--accent-contrast)] shadow-[0_8px_16px_-8px_var(--ring)]'
        : empty
          ? 'cursor-default text-slate-500/40'
          : 'text-slate-300 hover:bg-night-700 hover:text-white'
    }`
  }

  const titleFor = (letter) => {
    if (letter === '#') return t('collection.filterNumbers')
    if (!counts[letter]) return t('collection.filterEmpty', { letter })
    return t('collection.filterLetter', { letter, count: counts[letter] })
  }

  return (
    // cb-alphabet : ancre CSS des thèmes « Médiathèque » / « Comic Books ».
    <div className="cb-alphabet flex items-center gap-1 overflow-x-auto rounded-xl border border-night-600/70 bg-night-800/70 p-1.5 backdrop-blur" role="group" aria-label={t('collection.filterAlphabet')}>
      {['#', ...LETTERS].map((letter) => (
        <button
          key={letter}
          type="button"
          disabled={!counts[letter]}
          aria-pressed={value === letter}
          title={titleFor(letter)}
          onClick={() => onChange(value === letter ? null : letter)}
          className={buttonCls(letter)}
        >
          {letter}
        </button>
      ))}
      {/* Bouton de réinitialisation « Tous » : lève le filtre actif (null) et
          réaffiche la vue globale complète. Mis en évidence quand un filtre
          est actif ; inerte sinon. */}
      <button
        type="button"
        disabled={!value}
        aria-pressed={false}
        title={t('collection.filterAll')}
        onClick={() => onChange(null)}
        className={`h-8 shrink-0 rounded-lg px-2.5 text-xs font-bold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
          value
            ? 'bg-[var(--accent-strong)] text-[var(--accent-contrast)] shadow-[0_8px_16px_-8px_var(--ring)]'
            : 'cursor-default text-slate-500/40'
        }`}
      >
        {t('collection.filterAll')}
      </button>
    </div>
  )
}
