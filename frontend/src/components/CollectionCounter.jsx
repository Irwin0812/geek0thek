import { useTranslation } from 'react-i18next'

/**
 * Badge compteur de collection (« X artistes — Y disques » / « X séries BD — Y albums BD ») :
 * positionné à GAUCHE de la barre de recherche, sur une seule ligne (shrink-0),
 * hauteur harmonisée h-12 comme le reste de la barre d'actions.
 *
 * Le type de collection est EXPLICITE (prop `type`, « disks » ou « comics ») —
 * jamais déduit de la présence d'`items` : la page « Mes BD » transmet bien
 * `items={comics.length}` et un `type` incertain affichait les libellés disques.
 *
 * Typographie imposée :
 *  - thème « Comic Books » → police JAUNE VIF (--cb-yellow) avec OMBRAGE NOIR,
 *    définie à la fin de src/themes/comic-books.css (bloc [data-theme='comic-books']
 *    .collection-badge, !important pour écraser le gris d'origine) ;
 *  - tous les autres thèmes (notamment « Geek0thek ») → police GRIS TRÈS CLAIR,
 *    GRAS (bold), avec OMBRAGE NOIR (halo dur noir multi-directionnel).
 * Les variables (--badge-foreground / --badge-outline / --badge-outline-size)
 * sont définies dans index.css (@layer components → gagne sur les utilitaires
 * Tailwind text-* du JSX lors du tie-break source).
 */
export default function CollectionCounter({ groups, items, type = 'comics' }) {
  const { t } = useTranslation()
  const isDisks = type === 'disks' // « Mes Disques » / « Mes BD »
  const value = t(
    isDisks ? 'collection.collectionBadge' : 'collection.comicBadge',
    isDisks
      ? { artists: groups, vinyls: items }
      : { series: groups, albums: items },
  )
  return (
    <span className="collection-badge h-12 shrink-0" role="status">
      {value}
    </span>
  )
}
