import { useTranslation } from 'react-i18next'

/**
 * Badge compteur de collection (« X artistes — Y disques » / « X séries — Y albums ») :
 * positionné à GAUCHE de la barre de recherche, sur une seule ligne (shrink-0),
 * hauteur harmonisée h-12 comme le reste de la barre d'actions.
 *
 * Typographie imposée :
 *  - thème « Comic Books » ([data-theme='comic-books']) → police JAUNE (--cb-yellow)
 *    liserée d'encre NOIRE (cf. .collection-badge--comic à la fin de
 *    src/themes/comic-books.css — !important pour écraser le gris d'origine) ;
 *  - tous les autres thèmes (notamment « Geek0thek ») → police GRIS TRÈS CLAIR,
 *    GRAS (bold), avec OMBRAGE NOIR (halo dur noir multi-directionnel).
 * Les variables (--badge-foreground / --badge-outline / --badge-outline-size)
 * sont définies dans index.css (@layer components → gagne sur les utilitaires
 * Tailwind text-* du JSX lors du tie-break source).
 */
export default function CollectionCounter({ groups, items }) {
  const { t } = useTranslation()
  const isDisks = items !== undefined // true → disques, false → albums (BD)
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
