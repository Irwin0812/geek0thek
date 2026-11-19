/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
 * LAYOUT RESPONSIVE (flex flex-col md:flex-row, w-full px-4 sm:px-6,
 * items-center justify-between gap-3) :
 *   - MOBILE / TABLETTE (< md) : les 3 blocs s'empilent verticalement
 *     (flex-col), centrés (items-center / text-center) — aucun débordement.
 *   - DESKTOP (>= md) : répartition sur toute la largeur (justify-between) :
 *     BLOC 1 (gauche) : « Soutenez le projet ! » + image/bouton PayPal
 *     (/img/paypal.png), alignés à gauche.
 *     BLOC 2 (centre) : colonne centrée — ligne 1 : copyright
 *     (« Geek0thek - Bibliothèque de collections par GERARTS Irwin - 2026 »)
 *     suivi de « Commit: <sha commit local> » dans le MÊME flux typographique
 *     que le copyright (aucune couleur/graisse particulière — un seul style
 *     uniforme) ; le commit est masqué tant que le SHA local embarqué dans
 *     l'image Docker n'est pas connu. (Ligne 2 : bouton « Gestion des cookies »
 *     — uniquement sur la démo / selon la configuration active.)
 *     BLOC 3 (droite) : le lien « Version: <nom de la dernière release GitHub> »
 *     (footer.version + releaseName dynamique de /api/version, ex. « Version:
 *     Geek0thek v1.2 ») vers https://github.com/Irwin0812/geek0thek/releases/
 *     latest, aligné à droite (md:text-right), jamais tronqué, en accent doré
 *     (--accent-strong).
 *
 * TYPOGRAPHIE UNIFIÉE : « Soutenez le projet ! » et « Version: <release> »
 * partagent exactement les mêmes classes de taille/graisse (text-xs sm:text-sm
 * font-semibold) et la même couleur d'accent (--accent-strong). Le libellé
 * central « Commit: <sha> » est volontairement NEUTRE (même police, taille,
 * graisse et couleur que le copyright adjacent).
 *
 * TOUTES les chaînes visibles sont internationalisées via useTranslation()
 * (clé « footer.* » présente dans les 6 dictionnaires de langues).
 */

export default function Footer() {
  const { t } = useTranslation()
  // Version de la webapp = SHA du commit LOCAL embarqué dans l'image Docker
  // en cours d'exécution (ex. « a1b2c3d »). Une seule requête au montage ;
  // jamais d'erreur affichée : si le SHA local est inconnu, ou si l'API
  // GitHub est injoignable / quota atteint, le libellé « Commit: … » reste
  // totalement masqué.
  const [version, setVersion] = useState('')
  // Nom de la dernière release GitHub (ex. « Geek0thek v1.2 ») — fourni par
  // /api/version (releases/latest, cache mémoire 10 min côté backend).
  const [releaseName, setReleaseName] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .version()
      .then((data) => {
        if (cancelled || !data) return
        if (data.localCommit) {
          setVersion(data.localCommit.slice(0, 7))
        }
        if (data.releaseName) {
          setReleaseName(data.releaseName)
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
  // libellés « Soutenez le projet ! » et « Version: <release> » utilisent la
  // variable --accent-strong (inline), forcée en jaune moutarde par comic.css.
  // Le libellé central « Commit: <sha> » reste volontairement neutre (même
  // style que le copyright adjacent).
  return (
    <footer className="cb-footer fixed bottom-0 left-0 right-0 z-30 border-t border-night-700/70 bg-night-950/85 backdrop-blur">
      {/* RESPONSIVE : empilement vertical centré sur mobile/tablette,
          répartition pleine largeur (justify-between) en 3 blocs à partir de
          md — aucun débordement horizontal possible. */}
      <div className="w-full px-4 sm:px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-slate-400">
        {/* BLOC 1 — GAUCHE (desktop) : « Soutenez le projet ! » + bouton PayPal,
            alignés à gauche sur desktop, centrés sur mobile. Toujours visible. */}
        <a
          href="https://www.paypal.com/donate/?hosted_button_id=Y7LQW3UKPY5VN"
          target="_blank"
          rel="noopener noreferrer"
          className="cb-footer-donate inline-flex items-center gap-3 min-w-0 justify-center md:justify-start text-left transition-all duration-200 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-xl"
        >
          <span
            className="text-xs sm:text-sm font-semibold whitespace-nowrap"
            style={{ color: 'var(--accent-strong)' }}
          >
            {t('footer.support')}
          </span>
          {/* Image locale du bouton PayPal : hauteur ajustée (h-9 = 36px) pour
              s'ajuster à la hauteur du footer, largeur proportionnelle
              (w-auto) — jamais de déformation. */}
          <img
            src="/img/paypal.png"
            alt={t('footer.paypal')}
            className="h-9 w-auto shrink-0"
            loading="lazy"
          />
        </a>

        {/* BLOC 2 — CENTRE : colonne centrée. Ligne 1 : copyright + « Commit:
            <sha> » dans le MÊME flux typographique que le copyright (aucune
            classe de couleur/graisse supplémentaire — un seul style uniforme).
            Le commit est masqué tant que le SHA local n'est pas connu. */}
        <div className="flex flex-col items-center text-center gap-1">
          <span className="leading-relaxed">
            {t('footer.copyright')}
            {version ? (
              <>
                {' '}
                —{' '}
                <span title="Commit local embarqué dans l'image Docker">
                  {t('footer.commit')}: {version}
                </span>
              </>
            ) : ''}
          </span>
        </div>

        {/* BLOC 3 — DROITE (desktop) : lien « Version: <nom de la dernière
            release GitHub> » (ex. « Version: Geek0thek v1.2 ») vers la page
            releases/latest du dépôt, aligné à droite (md:text-right), jamais
            tronqué ; centré sur mobile. Accent doré (--accent-strong). */}
        <a
          href="https://github.com/Irwin0812/geek0thek/releases/latest"
          target="_blank"
          rel="noopener noreferrer"
          className="cb-footer-version text-center md:text-right text-xs sm:text-sm font-semibold whitespace-nowrap transition-all duration-200 hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-xl"
          style={{ color: 'var(--accent-strong)' }}
          title={t('footer.version')}
        >
          {t('footer.version')}: {releaseName}
        </a>
      </div>
    </footer>
  )
}
