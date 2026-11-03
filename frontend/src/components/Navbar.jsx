import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18n, { SUPPORTED_LANGUAGES } from '../i18n/i18n.js'
import { useAuth } from '../App'
import { ChevronDown } from 'lucide-react'
import { api, saveSession } from '../services/api.js'
import Avatar from './Avatar.jsx'
import { CheckIcon, GlobeIcon } from './icons.jsx'
import ThemeIcon from './ThemeIcon.jsx'
import { useDismiss, useHoverClose } from './hooks.js'
import { getAppliedTheme, isKnownTheme, switchTheme, THEMES } from '../services/theme.js'

/* « Autres Collections » — emplace structurellement prêt à accueillir les
   futurs types de collections (jeux, livres, figurines…). Pour ajouter un
   type : compléter la constante ci-dessous avec { id, to, label } ET créer
   sa route dans App.jsx. Tant que la liste est vide, le panneau (desktop et
   mobile) affiche automatiquement le placeholder « à venir »
   (clé i18n navbar.otherCollectionsEmpty). */
const OTHER_COLLECTIONS = []

/* Base commune des liens de la barre principale (NavLink actif ou non) et
   du bouton qui ouvre « Autres Collections ». */
/* cb-nav-link : accroche de charte « Comic Books » (thèmes/comic-books.css).
   Inerte sur les autres thèmes (aucune règle ne cibl .cb-nav-link). Elle porte
   le lettrage Bangers + l'état actif « tampon jaune » de la barre haute. */
const linkBase = 'cb-nav-link px-3 py-2 rounded-lg text-sm font-medium transition'
const linkCls =
  'text-slate-300 hover:bg-night-700/60 hover:text-white'
const linkClass = ({ isActive }) =>
  `${linkBase} ${isActive ? 'bg-night-700 text-gold-300' : linkCls}`

/* Classe de base des éléments cliquables du menu utilisateur (avatar) :
   même allure qu'un NavLink (gris → survol night-700), alignés à gauche. */
const menuItemCls =
  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-left text-slate-300 transition hover:bg-night-700/60 hover:text-white'

/* Rangée cliquable de bascule du dropdown utilisateur (« Thème », « Langue »)
   : elle ouvre un sous-menu indenté juste en dessous (état subMenu). */
const subToggleCls = (open) =>
  `flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-left transition ${
    open ? 'bg-night-700/60 text-white' : linkCls
  }`

export default function Navbar() {
  const { t } = useTranslation()
  const { user, isAdmin, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Menu mobile global (bouton ☰) : uniquement les liens de navigation,
  // sous la barre. (Le profil / la langue / le thème passent désormais par
  // le menu déroulant de l'avatar, toujours visible.)
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileOthersOpen, setMobileOthersOpen] = useState(false)

  /* Menu déroulant « Autres Collections » : prêt pour les futurs types —
     placeholder vide aujourd'hui (constante OTHER_COLLECTIONS). */
  const [othersOpen, setOthersOpen] = useState(false)
  const othersRef = useDismiss(othersOpen, () => setOthersOpen(false))
  /* Survol STABLE du panneau « Autres Collections » : délai 200 ms annulé à
     toute ré-entrée dans la zone (bouton + panneau) — cf. useHoverClose. */
  const othersHover = useHoverClose(() => setOthersOpen(false))

  /* Menu déroulant de l'utilisateur (déclencheur : avatar + nom + chevron).
     Contenu, en ordre :
        - EN-TÊTE      : avatar, nom et rôle de l'utilisateur connecté
        - « Mon profil » → /profil
        - « Thème »    → SOUS-MENU indenté : choix direct parmi les 6 thèmes
                         (bascule immédiate + sauvegarde du profil via PATCH)
        - « Langue »   → SOUS-MENU indenté : choix direct parmi les langues
                         supportées (i18n.changeLanguage + PATCH du profil)
        - « Utilisateurs » → /admin/users, NE S'AFFICHE QUE si l'utilisateur
                           connecté est administrateur (isAdmin)
        - « Déconnexion »  → tout en bas.
     Fermeture au clic extérieur / touche Échap via useDismiss — la ref est
     posée sur le conteneur englobant déclencheur + panneau (sous-menus
     inclus). */
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useDismiss(userMenuOpen, () => setUserMenuOpen(false))
  /* Survol STABLE du menu utilisateur (déclencheur + panneau + sous-menus
     Thème/Langue) : délai 200 ms annulé à toute ré-entrée dans la zone. Le
     sous-menu ouvert est refermé automatiquement par l'effet ci-dessous dès
     que userMenuOpen passe à false (idempotent avec setSubMenu(null)). */
  const userHover = useHoverClose(() => setUserMenuOpen(false))

  /* Sous-menu indenté ouvert dans le menu utilisateur : 'theme' | 'language'
     | null — au plus UN à la fois ; refermé automatiquement dès que le
     menu principal se ferme (clic extérieur, Échap, navigation…). */
  const [subMenu, setSubMenu] = useState(null)
  useEffect(() => {
    if (!userMenuOpen) setSubMenu(null)
  }, [userMenuOpen])

  /* États transitoires des actions du menu : l'UI ne JAMAIS bloquée (la
     bascule de thème / le changement de langue s'appliquent instantanément,
     la sauvegarde file en arrière-plan et les indicateurs ci-dessous le font
     savoir). */
  const [langBusy, setLangBusy] = useState(false)
  const [themeSaving, setThemeSaving] = useState(false)

  /* Utilisateur courant tenu en ref : les handlers async (changement de
     langue / thème) ne lisent jamais une closure périmée. */
  const userRef = useRef(user)
  userRef.current = user
  const syncingRef = useRef(false)

  /* Thème appliqué : suit l'attribut data-theme réellement posé sur <html>
     (source de vérité UI — services/theme.js). Re-synchronisé à chaque
     changement d'utilisateur : App.jsx peut basculer le thème pendant la
     synchronisation de session / la connexion, AVANT la mise à jour du
     contexte — l'état local suit alors le DOM. */
  const [appliedTheme, setAppliedTheme] = useState(() => getAppliedTheme())

  useEffect(() => {
    setAppliedTheme(getAppliedTheme())
  }, [user])

  /**
   * Change la langue de l'interface, dans l'ordre demandé :
   *  1. `i18n.changeLanguage(code)` — le détecteur (caches: ['localStorage'])
   *     conserve ensuite le code automatiquement dans localStorage
   *     (clé `geek0thek_lang` — c'est l'« étape » localStorage).
   *  2. Requête PATCH vers l'API pour mettre à jour la colonne `language`
   *     de l'utilisateur connecté, puis mise à jour du profil en session.
   */
  const handleLangChange = async (code) => {
    setUserMenuOpen(false)
    const current = i18n.resolvedLanguage || i18n.language
    if (!code || code === current) return

    // 1 + 2 : change l'interface ET persiste dans localStorage (detector)
    await i18n.changeLanguage(code)

    // 3 : synchronise le profil côté backend (ne bloque pas le rendu :
    // l'interface s'est déjà retournée, la sauvegarde file en arrière-plan)
    const u = userRef.current
    if (!u) return
    setLangBusy(true)
    try {
      const { user: updated } = await api.users.patchLanguage(code)
      // Rafraîchit le profil en session : le token n'est pas touché
      // (saveSession ne l'écrit que s'il est fourni).
      saveSession({ user: updated })
    } catch {
      // Échec réseau : l'UI reste sur la langue choisie (déjà appliquée
      // localement + localStorage), le profil sera resynchronisé au prochain
      // changement de langue ou rechargement de session.
    } finally {
      setLangBusy(false)
    }
  }

  /**
   * Sélection d'un thème dans le SOUS-MENU « Thème » du menu utilisateur
   * (gestion centralisée ici — la page profil ne le propose plus). Ordre :
   *  1. `switchTheme(key)` — bascule IMMÉDIATE de la palette : l'attribut
   *     data-theme est posé sur <html> (les sélecteurs [data-theme=…] des
   *     6 fichiers src/themes/*.css re-dessinent l'application) et la
   *     préférence est retenue dans localStorage (survit à déconnexion /
   *     rechargement).
   *  2. PATCH /api/users/profile/theme — met à jour le champ `theme` en
   *     base. L'UI ne bloque PAS : on resynchronise ensuite le profil en
   *     session ; en cas d'échec réseau, l'application reste sur le thème
   *     choisi (ré-essayer suffit).
   */
  const handleThemeChange = (key) => {
    setUserMenuOpen(false)
    if (!isKnownTheme(key) || key === appliedTheme) return
    switchTheme(key)
    setAppliedTheme(key)
    if (!userRef.current) return
    setThemeSaving(true)
    api.users
      .patchTheme(key)
      .then(({ user: updated }) => saveSession({ user: updated }))
      .catch(() => {
        /* Échec réseau : le thème est déjà appliqué localement (data-theme +
           localStorage) ; le profil sera resynchronisé au prochain choix ou
           au rechargement. */
      })
      .finally(() => setThemeSaving(false))
  }

  /**
   * Au chargement initial / à la connexion : initialise la langue depuis le
   * profil de l'utilisateur connecté. Sans profil (visiteur, écran de
   * connexion), la langue vient du localStorage (ou du navigateur) via le
   * LanguageDetector déjà configuré dans i18n.js.
   */
  useEffect(() => {
    if (!user || syncingRef.current) return
    const desired = String(user.language || '').toLowerCase()
    if (!SUPPORTED_LANGUAGES.some((l) => l.code === desired)) return
    const current = i18n.resolvedLanguage || i18n.language
    if (desired === current) return
    syncingRef.current = true
    i18n.changeLanguage(desired)
  }, [user])

  // Ferme les menus à chaque navigation : clic sur « Mon profil » /
  // « Utilisateurs », ou arrière/avant du navigateur.
  useEffect(() => {
    setUserMenuOpen(false)
    setOthersOpen(false)
  }, [location.pathname])

  // Le menu mobile refermé renferme aussi sa liste « Autres Collections ».
  useEffect(() => {
    if (!menuOpen) setMobileOthersOpen(false)
  }, [menuOpen])

  const handleLogout = () => {
    // Ferme avant la navigation (le Navbar se démonte de toute façon avec
    // `user` → null), puis purge la session et retourne à l'écran de login.
    setUserMenuOpen(false)
    logout()
    navigate('/login')
  }

  /* Valeurs courantes affichées sur les rangées de bascule (sans ouvrir le
     sous-menu) : thème appliqué + langue active. */
  const activeTheme = THEMES.find((th) => th.id === appliedTheme) || THEMES[0]
  const currentLang = i18n.resolvedLanguage || i18n.language
  const activeLangLabel = SUPPORTED_LANGUAGES.find((l) => l.code === currentLang)?.label

  // cb-navbar : accroche de la charte « Comic Books » (thèmes/comic-books.css)
  // — barre jaune/rouge/cyan, lettrage Bangers, boutons harmonisés au message
  // de bienvenue. Inerte ailleurs (aucune règle ne cible .cb-navbar).
  return (
    <header className="cb-navbar sticky top-0 z-40 border-b border-night-700/70 bg-night-950/85 backdrop-blur">
      {/* BLOC DE NAVIGATION PRINCIPAL RECENTRÉ dans le header :
          LOGO → « Tableau de bord » / « Mes Disques » / « Mes BD » /
          « Autres Collections » → MENU UTILISATEUR (avatar, à droite).
          h-24 (anc. h-20) : barre encore légèrement plus haute pour le confort. */}
      <div className="w-full px-4 h-24 flex items-center justify-center gap-4">
        <div className="flex min-w-0 max-w-full items-center gap-3 md:gap-4">
          {/* --- Logo --- */}
          <Link to="/" className="flex shrink-0 items-center gap-2.5 group">
            <span className="relative h-9 w-9 grid place-items-center rounded-full bg-night-800 border border-night-600 group-hover:border-gold-500/50 transition">
              <span className="absolute inset-1.5 rounded-full border-2 border-night-500" />
              <span className="h-2.5 w-2.5 rounded-full bg-gold-500" />
            </span>
            <span className="leading-tight">
              {/* cb-logo : lettrage « case de BD » du nom sous le thème Comic Books. */}
              <span className="cb-logo block font-extrabold tracking-wide text-white">
                GEEK<span className="text-gold-400">0THEK</span>
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.2em] text-white">
                {t('navbar.collections')}
              </span>
            </span>
          </Link>

          {/* --- Liens principaux (masqués sur mobile : menu ☰ sous la barre) --- */}
          <nav className="hidden md:flex items-center gap-1">
            <NavLink to="/" end className={linkClass}>{t('navbar.dashboard')}</NavLink>
            <NavLink to="/collection" className={linkClass}>{t('navbar.myVinyls')}</NavLink>
            <NavLink to="/comics" className={linkClass}>{t('navbar.myComics')}</NavLink>

            {/* « Autres Collections » : déroulant PRÊT pour les futurs types
                de collections. Aucune entrée aujourd'hui → placeholder
                « à venir » (le map ci-dessous active directement la liste
                dès qu'OTHER_COLLECTIONS sera renseignée). */}
            {/* Survol : fermeture ANIMÉE via useHoverClose (état React + délai
                200 ms, annulé dès la ré-entrée) au lieu d'un onMouseLeave brut
                qui refermait au moindre micro-mouvement de la souris — OU ne se
                refermait jamais (bloqué ouvert). La zone englobée = bouton +
                panneau ; le pont transparent avant: ci-dessous rend le trajet
                vertical bouton → panneau géométriquement CONTINU à travers l'
                espace mt-1.5, et le délai absorbe le reste. */}
            <div
              className="relative"
              ref={othersRef}
              onMouseEnter={othersHover.onMouseEnter}
              onMouseLeave={othersHover.onMouseLeave}
            >
              <button
                type="button"
                onClick={() => setOthersOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={othersOpen}
                className={`${linkBase} ${linkCls}`}
              >
                {t('navbar.otherCollections')}
                <span
                  aria-hidden="true"
                  className={`ml-1.5 text-xs transition-transform duration-200 ${othersOpen ? 'rotate-180' : ''}`}
                >
                  ▾
                </span>
              </button>
              {/* z-50 IMPÉRATIF : le panneau doit se peindre AU-DESSUS de la
                  bande décorative du thème (ex: .cb-navbar::after, z-index 30
                  dans comic-books.css) ; sans lui, il passait sous la ligne.
                  avant:absolute -top-1.5 h-1.5 : strip transparent qui comble
                  la marge mt-1.5 (zone de survol continue pour onMouseLeave). */}
              {othersOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-full z-50 mt-1.5 w-64 max-w-[calc(100vw-2rem)] card !p-1.5 shadow-2xl shadow-black/50 before:absolute before:-top-1.5 before:left-0 before:h-1.5 before:w-full before:content-['']"
                >
                  {OTHER_COLLECTIONS.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-500">
                      {t('navbar.otherCollectionsEmpty')}
                    </p>
                  ) : (
                    OTHER_COLLECTIONS.map((c) => (
                      <Link
                        key={c.id}
                        to={c.to}
                        role="menuitem"
                        onClick={() => setOthersOpen(false)}
                        className={menuItemCls}
                      >
                        {c.label}
                      </Link>
                    ))
                  )}
                </div>
              )}
            </div>
          </nav>

          {/* --- Menu utilisateur (à l'extrême droite du bloc) + ☰ mobile --- */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Déclencheur du menu utilisateur : avatar + nom + rôle (nom
                masqué sous sm — seul l'avatar reste visible sur mobile).
                Chevron qui pivote à l'ouverture. */}
            {/* Survol : fermeture ANIMÉE via useHoverClose (état React + délai
                200 ms, annulé dès la ré-entrée) sur la zone COMBINÉE déclencheur
                + panneau (+ sous-menus Thème/Langue imbriqués) — remplace le
                ancien onMouseLeave brut qui refermait au moindre micro-mouvement
                OU restait collé ouvert. Le sous-menu ouvert est refermé à sa
                suite par l'effet ci-dessus (userMenuOpen → setSubMenu(null)). */}
            <div
              className="relative"
              ref={userMenuRef}
              onMouseEnter={userHover.onMouseEnter}
              onMouseLeave={userHover.onMouseLeave}
            >
              <button
                type="button"
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2.5 rounded-lg pr-1.5 pl-0.5 py-0.5 group hover:bg-night-800/60 transition"
                title={t('navbar.userMenuTitle')}
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
              >
                <Avatar user={user} size={36} />
                <span className="hidden sm:block text-right leading-tight">
                  <span className="block max-w-40 truncate text-sm font-semibold text-slate-100 group-hover:text-gold-300 transition">
                    {user.firstName} <span className="text-slate-400 group-hover:text-gold-400/80">{user.lastName}</span>
                  </span>
                  <span className={`block text-[11px] font-medium ${isAdmin ? 'text-gold-400' : 'text-slate-500'}`}>
                    {isAdmin ? t('navbar.roleAdmin') : t('navbar.roleUser')}
                  </span>
                </span>
                {/* Chevron « V » épuré (lucide ChevronDown) — même allure que le
                    chevron du bouton « + AJOUTER UN MÉDIA » (Dashboard) : w-4 h-4,
                    blanc contrasté sur la navbar, pivote à l'ouverture. */}
                <ChevronDown
                  size={16}
                  strokeWidth={2.5}
                  aria-hidden="true"
                  className={`ml-1.5 h-4 w-4 text-white transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {/* --- Panneau déroulant — z-50 IMPÉRATIF : au-dessus de la bande
                  décorative du thème (.cb-navbar::after, z-index 30) qui
                  couvrait sinon le menu (cf. « Autres Collections »).
                  avant:absolute -top-1.5 h-1.5 : pont transparent comblant la
                  marge mt-1.5 — le passage vertical avatar → panneau reste CONTINU
                  dans la zone de survol (avec le délai useHoverClose, aucun
                  clignotement open/close sur les micro-mouvements). --- */}
              {userMenuOpen && (
                <div className="absolute top-full right-0 z-50 mt-1.5 w-80 max-w-[calc(100vw-2rem)] card !p-1.5 shadow-2xl shadow-black/50 before:absolute before:-top-1.5 before:left-0 before:h-1.5 before:w-full before:content-['']">
                  {/* En-tête du menu : avatar, nom et rôle de l'utilisateur
                      connecté (conservés depuis la barre de navigation). */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <Avatar user={user} size={44} />
                    <div className="min-w-0 leading-tight">
                      <p className="truncate text-sm font-semibold text-slate-100">
                        {user.firstName}{' '}
                        <span className="text-slate-400">{user.lastName}</span>
                      </p>
                      <p className={`text-[11px] font-medium ${isAdmin ? 'text-gold-400' : 'text-slate-500'}`}>
                        {isAdmin ? t('navbar.roleAdmin') : t('navbar.roleUser')}
                      </p>
                    </div>
                  </div>

                  <div className="mx-2 border-t border-night-700/70" />

                  {/* « Mon profil » : accès direct à la page de profil. */}
                  <div className="px-1.5 pt-1.5">
                    <Link to="/profil" className={menuItemCls} title={t('navbar.editProfileTitle')}>
                      {t('navbar.myProfile')}
                    </Link>
                  </div>

                  {/* « Thème » : rangée de bascule → SOUS-MENU indenté listant les
                      6 thèmes (ICÔNE spécifique par thème + coche sur le thème actif,
                      cf. src/components/ThemeIcon.jsx). La rangée affiche l'icône +
                      le nom du thème ACTUELLEMENT ACTIF (à droite du libellé, sur le
                      modèle de la rangée « Langue » qui montre Globe + langue courante).
                      Bascule IMMÉDIATE (switchTheme) + sauvegarde du profil via
                      PATCH, non bloquante (indicateur « Enregistrement… »). */}
                  <div className="px-1.5">
                    <button
                      type="button"
                      onClick={() => setSubMenu((s) => (s === 'theme' ? null : 'theme'))}
                      aria-expanded={subMenu === 'theme'}
                      title={t('navbar.themeMenu')}
                      className={subToggleCls(subMenu === 'theme')}
                    >
                      {/* Icône + nom du thème actuellement actif, à droite du
                          libellé (même modèle que la rangée « Langue » qui affiche
                          l'icône Globe + la langue courante). Le sous-menu déroulant
                          reste accessible pour changer de thème. */}
                      <span className="flex items-center gap-2">
                        <ThemeIcon theme={appliedTheme} size={20} className="shrink-0" />
                        {t('navbar.theme')}
                        <span className="text-xs font-normal text-cyan-300">{activeTheme.label}</span>
                      </span>
                      {themeSaving && (
                        <span className="text-[10px] font-normal tracking-normal text-slate-500">
                          {t('common.saving')}
                        </span>
                      )}
                    </button>

                    {subMenu === 'theme' && (
                      <div
                        className="ml-3 my-1 flex flex-col gap-0.5 border-l border-night-700/70 pl-2"
                        role="group"
                        aria-label={t('navbar.themeMenu')}
                      >
                        {THEMES.map((th) => {
                          const active = th.id === appliedTheme
                          return (
                            <button
                              key={th.id}
                              type="button"
                              onClick={() => handleThemeChange(th.id)}
                              disabled={themeSaving}
                              aria-pressed={active}
                              title={`${th.label}${th.id === 'dark' ? ` (${t('navbar.themeDefault')})` : ''}`}
                              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition disabled:opacity-60 ${
                                active
                                  /* Élément ACTIF : fond clair contrasté (jaune vif) +
                                     texte noir bien visible — sur un fond sombre
                                     (bg-night-700), le texte sombre était illisible ;
                                     la coche dorée passe à l'encre qu'il faut alors
                                     garder lisible. */
                                  ? 'bg-gold-400 text-slate-950'
                                  : 'text-slate-300 hover:bg-night-700/60 hover:text-white'
                              }`}
                            >
                               {/* Icône graphique dédiée au thème (favicon du site pour « Geek0thek »,
                                   explosion rétro « BOOM » pour Comic Books, bouton play néon pour Néon…) :
                                   les glyphes courants (casque, bulle) suivent currentColor et passent à l'encre sombre
                                   sur la ligne active ; favicon, vinyle, explosion et play sont à couleurs fixes. */}
                               <ThemeIcon
                                 theme={th.id}
                                 size={20}
                                 className={`shrink-0 ${active ? 'text-slate-950' : 'text-slate-300'}`}
                               />
                              {th.label}
                              {th.id === 'dark' ? ` (${t('navbar.themeDefault')})` : ''}
                              {active && <CheckIcon size={12} className="ml-auto shrink-0 text-slate-950" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* « Langue » : rangée de bascule → SOUS-MENU indenté listant
                      les 6 langues actives (coche sur la langue en cours).
                      Le changement s'applique immédiatement :
                      i18n.changeLanguage + PATCH du profil, non bloquant. La
                      rangée affiche la langue courante comme repère. */}
                  <div className="px-1.5">
                    <button
                      type="button"
                      onClick={() => setSubMenu((s) => (s === 'language' ? null : 'language'))}
                      aria-expanded={subMenu === 'language'}
                      title={t('navbar.languageMenu')}
                      className={subToggleCls(subMenu === 'language')}
                    >
                      {/* Petite planète (Globe) cyan à gauche du libellé, et la
                          langue courante affichée dans le même cyan : repère
                          visuel unique de la rangée « Langue ». */}
                      <span className="flex items-center gap-2">
                        <GlobeIcon size={14} className="shrink-0 text-cyan-300" />
                        {t('navbar.language')}
                        {activeLangLabel && (
                          <span className="text-xs font-normal text-cyan-300">{activeLangLabel}</span>
                        )}
                      </span>
                      {/* Plus d'indicateur au repos (puce retirée) ; seul le
                          « Enregistrement… » transitoire subsiste. */}
                      {langBusy && (
                        <span className="text-[10px] font-normal tracking-normal text-slate-500">
                          {t('common.saving')}
                        </span>
                      )}
                    </button>

                    {subMenu === 'language' && (
                      <div
                        className="ml-3 my-1 flex flex-col gap-0.5 border-l border-night-700/70 pl-2"
                        role="group"
                        aria-label={t('navbar.languageMenu')}
                      >
                        {SUPPORTED_LANGUAGES.map((lang) => {
                          const active = lang.code === currentLang
                          return (
                            <button
                              key={lang.code}
                              type="button"
                              onClick={() => handleLangChange(lang.code)}
                              disabled={langBusy}
                              aria-pressed={active}
                              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition disabled:opacity-60 ${
                                active
                                  /* Élément ACTIF : fond clair contrasté (jaune vif) +
                                     texte noir bien visible — sur un fond sombre
                                     (bg-night-700), le texte sombre était illisible ;
                                     la coche dorée passe à l'encre noire de même. */
                                  ? 'bg-gold-400 text-slate-950'
                                  : 'text-slate-300 hover:bg-night-700/60 hover:text-white'
                              }`}
                            >
                              {lang.label}
                              {active && <CheckIcon size={12} className="ml-auto shrink-0 text-slate-950" />}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* « Utilisateurs » : réservé aux administrateurs — l'élément
                      (et son séparateur) est masqué complètement pour les autres rôles. */}
                  {isAdmin && (
                    <>
                      <div className="mx-2 my-1.5 border-t border-night-700/70" />
                      <button
                        type="button"
                        onClick={() => navigate('/admin/users')}
                        className={`w-full ${menuItemCls}`}
                      >
                        {t('navbar.users')}
                      </button>
                    </>
                  )}

                  {/* « Déconnexion » : tout en bas du menu. */}
                  <div className="mx-2 my-1.5 border-t border-night-700/70" />
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-left transition text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                  >
                    {t('navbar.logout')}
                  </button>
                </div>
              )}
            </div>

            {/* Menu mobile (bouton ☰) : sous la barre — profil, langue et thème
                passent par le menu déroulant de l'avatar, accessible sur toutes
                les tailles d'écran. */}
            <button
              className="md:hidden btn-ghost !py-1.5 !px-3"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={t('navbar.menu')}
            >
              ☰
            </button>
          </div>
        </div>
      </div>

      {menuOpen && (
        <nav className="md:hidden border-t border-night-700/70 px-4 py-3 flex flex-col gap-1 bg-night-900/95">
          <NavLink to="/" end className={linkClass}>{t('navbar.dashboard')}</NavLink>
          <NavLink to="/collection" className={linkClass}>{t('navbar.myVinyls')}</NavLink>
          <NavLink to="/comics" className={linkClass}>{t('navbar.myComics')}</NavLink>

          {/* « Autres Collections » : même structure prête pour les futurs
              types, ici dépliée en ligne (pas de panneau flottant sur mobile). */}
          <button
            type="button"
            onClick={() => setMobileOthersOpen((v) => !v)}
            aria-expanded={mobileOthersOpen}
            className={`${linkBase} text-left ${linkCls}`}
          >
            <span className="flex items-center justify-between gap-2">
              {t('navbar.otherCollections')}
              <span
                aria-hidden="true"
                className={`text-xs transition-transform duration-200 ${mobileOthersOpen ? 'rotate-180' : ''}`}
              >
                ▾
              </span>
            </span>
          </button>
          {mobileOthersOpen && (
            <div className="flex flex-col gap-1 pb-1">
              {OTHER_COLLECTIONS.length === 0 ? (
                <p className="text-xs text-slate-500">{t('navbar.otherCollectionsEmpty')}</p>
              ) : (
                OTHER_COLLECTIONS.map((c) => (
                  <Link
                    key={c.id}
                    to={c.to}
                    onClick={() => setMenuOpen(false)}
                    className={`${linkBase} text-left ${linkCls}`}
                  >
                    {c.label}
                  </Link>
                ))
              )}
            </div>
          )}
        </nav>
      )}
    </header>
  )
}
