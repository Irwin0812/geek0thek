import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { api, clearSession, getToken, saveSession } from './services/api.js'
import Navbar from './components/Navbar.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import Login from './pages/Login.jsx'
import Onboarding from './pages/Onboarding.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Collection from './pages/Collection.jsx'
import AddVinyl from './pages/AddVinyl.jsx'
import AdminUsers from './pages/AdminUsers.jsx'
import ComicCollection from './pages/ComicCollection.jsx'
import AddComic from './pages/AddComic.jsx'
import Profile from './pages/Profile.jsx'
import { DisplayProvider } from './services/display.jsx'
import { switchTheme } from './services/theme.js'
import Footer from './components/Footer.jsx'
import TopButton from './components/TopButton.jsx'
import UpdateButton from './components/UpdateButton.jsx'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export default function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(Boolean(getToken()))
  const location = useLocation()

  // RETOUR AUTOMATIQUE EN HAUT DE PAGE : à CHAQUE changement de route
  // (navigation Navbar / liens internes / clic sur les tuiles « À venir » /
  // retour Dashboard / retour vers l'avant-arrière du navigateur), la page se
  // réinitialise et défle TOUT EN HAUT, en flux doux :
  //   window.scrollTo({ top: 0, behavior: 'smooth' })
  // (les pages qui ne remplissent pas un écran restent trivialement au
  // sommet ; les pages collections défilent longuement → la réinitialisation
  // y est indispensable). Un seul cas d'exclusion : une URL portant un
  // ancre (#id) qui désigne un élément réellement présent s'y repositionne,
  // conformément au comportement standard des ancres. Exécuté dès que le
  // nouvel emplacement est résolu (avant le rendu complet de la page cible).
  useEffect(() => {
    const { hash } = location
    if (hash && document.getElementById(hash.slice(1))) {
      requestAnimationFrame(() => {
        document.querySelector(hash)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
      return
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [location])

  useEffect(() => {
    async function bootstrap() {
      if (!getToken()) {
        setLoading(false)
        return
      }
      try {
        const { user: current } = await api.users.me()
        // Thème enregistré dans le profil : appliqué immédiatement (avant la
        // première mise à jour du contexte de session) pour éviter un retour
        // aux couleurs de l'ancienne session pendant le chargement des pages.
        switchTheme(current.theme)
        saveSession({ token: getToken(), user: current })
        setUser(current)
      } catch {
        // session invalide -> déjà purgée par le service api
      } finally {
        setLoading(false)
      }
    }
    bootstrap()
  }, [])

  const auth = useMemo(
    () => ({
      user,
      isAdmin: Boolean(user && user.role === 'admin'),
      // Sécurité à la première connexion : le compte doit-il passer par
      // l'onboarding forcé (nouveau mot de passe + pseudo personnalisable) ?
      mustChangePassword: Boolean(user && user.mustChangePassword),
      login: async (payload) => {
        const { token, user: logged } = await api.login(payload)
        // Thème enregistré dans le profil du compte qui se connecte :
        // appliqué immédiatement (le theme.js retient aussi localStorage).
        switchTheme(logged.theme)
        saveSession({ token, user: logged })
        setUser(logged)
        return logged
      },
      // Onboarding validé : la session est renouvelée avec le NOUVEAU jeton
      // renvoyé par l'API (le drapeau must_change_password est remis à FALSE
      // côté base) et le profil mis à jour (nouveau login éventuel).
      completeOnboarding: ({ token: newToken, user: onboarded }) => {
        saveSession({ token: newToken || getToken(), user: onboarded })
        switchTheme(onboarded.theme)
        setUser(onboarded)
        return onboarded
      },
      refresh: async () => {
        const { user: current } = await api.users.me()
        saveSession({ token: getToken(), user: current })
        // Thème du nouvel état : ré-applique si le serveur en indique un
        // différent (ex. : profil synchronisé depuis un autre appareil).
        switchTheme(current.theme)
        setUser(current)
        return current
      },
      logout: () => {
        clearSession()
        setUser(null)
      },
    }),
    [user],
  )

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <VinylSpinner />
        <p className="text-sm text-slate-400">Chargement de votre médiathèque…</p>
      </div>
    )
  }

  // SÉCURITÉ À LA PREMIÈRE CONNEXION (onboarding forcé) : un compte dont le
  // drapeau must_change_password est encore TRUE ne peut accéder à AUCUNE
  // page applicative — il est redirigé vers /onboarding, où la modification
  // du mot de passe est OBLIGATOIRE (double saisie) et le pseudo de login
  // personnalisable. Le backend applique le même garde côté API (403
  // « must-change-password » sur toutes les routes protégées).
  if (user && user.mustChangePassword) {
    return (
      <AuthContext.Provider value={auth}>
        <DisplayProvider>
          <Onboarding />
        </DisplayProvider>
      </AuthContext.Provider>
    )
  }

  return (
    <AuthContext.Provider value={auth}>
      <DisplayProvider>
      <div className="min-h-screen flex flex-col">
        {user && <Navbar />}
        <main className="flex-1">
          <div key={location.pathname} className="animate-fadein">
            <Routes>
              <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
              {/* Route défensive : l'onboarding est déjà rendu ci-dessus dès
                  que user.mustChangePassword est TRUE (avant le layout). */}
              <Route path="/onboarding" element={<Onboarding />} />

              <Route element={<ProtectedRoute />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/collection" element={<Collection />} />
                <Route path="/profil" element={<Profile />} />
                <Route path="/comics" element={<ComicCollection />} />
                <Route path="/comics/nouveau" element={<AddComic />} />
                <Route path="/comics/:id" element={<AddComic />} />
                <Route path="/vinyles/nouveau" element={<AddVinyl />} />
                <Route path="/vinyles/:id" element={<AddVinyl />} />
                <Route path="/admin/users" element={
                  <ProtectedRoute adminOnly><AdminUsers /></ProtectedRoute>
                } />
              </Route>

              <Route path="*" element={<Navigate to={user ? '/' : '/login'} replace />} />
            </Routes>
          </div>
        </main>
        {/* BOUTON « TOP » GLOBAL : monté une SEULE fois dans le layout, au
            niveau de la page (frère de main/Footer) — présent sur toutes les
            pages et sections (Mes Disques, Mes BD, …), JAMAIS à l'intérieur
            d'une modale. Visible uniquement après 300 px de défilement. */}
        {user && <TopButton />}
        <Footer />
      </div>
      </DisplayProvider>
    </AuthContext.Provider>
  )
}

function VinylSpinner() {
  return (
    <div className="relative h-14 w-14">
      <div className="absolute inset-0 rounded-full border-4 border-night-600" />
      <div className="absolute inset-0 rounded-full border-4 border-transparent border-t-gold-500 animate-spin" />
      <div className="absolute inset-0 m-auto h-3 w-3 rounded-full bg-gold-500" />
    </div>
  )
}
