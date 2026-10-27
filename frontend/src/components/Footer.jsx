/**
 * Pied de page global : même fond sombre et uniforme que la barre de
 * navigation principale (Navbar.jsx — bg-night-950/85 + backdrop-blur),
 * pour fermer le « cadre » de l'application dans tous les thèmes, y compris
 * le thème « Médiathèque » (fond clair) où le pied reste foncé comme la nav.
 */
export default function Footer() {
  return (
    <footer className="border-t border-night-700/70 bg-night-950/85 backdrop-blur">
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
