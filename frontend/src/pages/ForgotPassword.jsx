import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'

/**
 * « Mot de passe ou identifiant oublié ? » — page publique (sans session).
 * L'utilisateur saisit son IDENTIFIANT OU son e-mail ; le backend envoie
 * alors (si un compte actif correspond) un e-mail contenant :
 *   - l'IDENTIFIANT du compte (utile s'il a oublié lequel des deux saisir),
 *   - un LIEN DE RÉINITIALISATION temporaire (jeton à usage unique, 1 h) :
 *     ${APP_URL}/reset-password/<jeton> -> page /reset-password/:token.
 * SÉCURITÉ : la réponse est GÉNÉRIQUE dans tous les cas (compte existant ou
 * non, envoi réussi ou non) — jamais d'énumération d'utilisateurs.
 */
export default function ForgotPassword() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [identifier, setIdentifier] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // true après soumission réussie : on affiche le message générique (on ne
  // peut pas dire si un e-mail a réellement été envoyé — anti-énumération).
  const [sent, setSent] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!identifier.trim()) {
      setError(t('auth.forgotRequired'))
      return
    }
    setBusy(true)
    try {
      await api.forgotPassword(identifier.trim())
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-[100vh] grid place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 h-16 w-16 relative grid place-items-center">
            <span className="absolute inset-0 rounded-full border border-night-600 bg-night-800" />
            <span className="absolute inset-3 rounded-full border-2 border-gold-500" />
            <span className="h-3.5 w-3.5 rounded-full bg-gold-500" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-wide text-white">
            {t('auth.forgotTitle')}
          </h1>
          <p className="mt-2 text-sm text-slate-400">{t('auth.forgotSubtitle')}</p>
        </div>

        {sent ? (
          <div className="card p-6 space-y-4 shadow-2xl shadow-black/40">
            <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
              {t('auth.forgotSent')}
            </p>
            <button type="button" className="btn-primary w-full" onClick={() => navigate('/login', { replace: true })}>
              {t('auth.backToLogin')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-6 space-y-4 shadow-2xl shadow-black/40">
            <div>
              <label htmlFor="identifier" className="label">{t('auth.identifierOrEmail')}</label>
              <input
                id="identifier"
                className="input"
                autoComplete="username"
                placeholder="admin"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoFocus
              />
            </div>

            {error && (
              <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? t('auth.forgotBusy') : t('auth.forgotSubmit')}
            </button>

            <Link to="/login" className="block w-full text-center text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
              {t('auth.backToLogin')}
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}
