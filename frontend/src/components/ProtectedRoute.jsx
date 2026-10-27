import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../App.jsx'

/**
 * Garde d'accès aux routes applicatives :
 *  - pas de compte connecté  -> /login (en mémorisant la page demandée)
 *  - adminOnly et rôle != admin -> /
 *
 * Utilisable des deux façons :
 *  - comme ROUTE LAYOUT  : <Route element={<ProtectedRoute />}>
 *    -> les routes imbriquées sont rendues via <Outlet />
 *  - comme ENVELOPPE     : <ProtectedRoute adminOnly><Page/></ProtectedRoute>
 *    -> on rend le composant enfant passé en `children`
 */
export default function ProtectedRoute({ adminOnly = false, children }) {
  const { user } = useAuth()
  const location = useLocation()

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (adminOnly && user.role !== 'admin') {
    return <Navigate to="/" replace />
  }
  return children ?? <Outlet />
}
