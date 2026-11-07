/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/**
 * Pied de page global : même fond sombre et uniforme que la barre de
 * navigation principale (Navbar.jsx — bg-night-950/85 + backdrop-blur),
 * pour fermer le « cadre » de l'application dans tous les thèmes, y compris
 * le thème « Médiathèque » (fond clair) où le pied reste foncé comme la nav.
 */
export default function Footer() {
  // cb-footer : accroche charte « Comic Books » (thèmes/comic-books.css) —
  // pied de page rouge comic qui s'accorde à la barre haute. Inerte ailleurs.
  return (
    <footer className="cb-footer border-t border-night-700/70 bg-night-950/85 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 py-6 text-center text-xs text-slate-400">
        Geek0thek - Bibliothèque de collections par{' '}
        <a href="mailto:webmaster@igerarts.be" className="text-slate-300 underline-offset-2 transition hover:text-gold-300 hover:underline">
          GERARTS Irwin
        </a>{' '}
        - 2026
      </div>
    </footer>
  )
}
