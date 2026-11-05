import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../App.jsx'
import { api } from '../services/api.js'
import PasswordInput from '../components/PasswordInput.jsx'

export default function Login() {
  const { t } = useTranslation()
  const { login, completeLogin } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ login: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // 2FA (Google Authenticator / TOTP) : quand le compte a la 2FA activée,
  // /login renvoie { needsTotp: true, tempToken } au lieu du JWT — on passe
  // alors à l'étape « code à 6 chiffres » (tempToken conservé ici).
  const [totpStep, setTotpStep] = useState(null) // null | { tempToken }
  const [totpCode, setTotpCode] = useState('')

  const finishLogin = (logged) => {
    // Sécurité à la première connexion : si le compte porte encore les
    // identifiants de première installation (drapeau must_change_password),
    // redirection OBLIGATOIRE vers l'onboarding (nouveau mot de passe +
    // pseudo personnalisable) avant tout accès à l'application.
    navigate(logged.mustChangePassword ? '/onboarding' : (location.state?.from || '/'), { replace: true })
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await api.login({ login: form.login.trim(), password: form.password })
      if (result.needsTotp) {
        // Identifiants valides + 2FA activée : on demande le code TOTP.
        setTotpStep({ tempToken: result.tempToken })
        return
      }
      completeLogin(result.token, result.user)
      finishLogin(result.user)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const submitTotp = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = await api.verifyTotp({ tempToken: totpStep.tempToken, code: totpCode.trim() })
      completeLogin(result.token, result.user)
      finishLogin(result.user)
    } catch (err) {
      setError(err.message)
      setTotpCode('')
    } finally {
      setBusy(false)
    }
  }

  const backToCredentials = () => {
    setTotpStep(null)
    setTotpCode('')
    setError('')
  }

  return (
    <div className="min-h-[100vh] grid place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="mx-auto mb-4 h-16 w-16 relative grid place-items-center">
            <span className="absolute inset-0 rounded-full border border-night-600 bg-night-800" />
            <span className="absolute inset-3 rounded-full border-2 border-night-500" />
            <span className="h-3.5 w-3.5 rounded-full bg-gold-500" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-wide text-white">
            GEEK<span className="text-gold-400">0THEK</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t('auth.tagline')}</p>
        </div>

        {!totpStep ? (
          <form onSubmit={submit} className="card p-6 space-y-4 shadow-2xl shadow-black/40">
            <div>
              <label htmlFor="login" className="label">{t('auth.identifierOrEmail')}</label>
              <input
                id="login"
                className="input"
                autoComplete="username"
                placeholder="admin"
                value={form.login}
                onChange={(e) => setForm({ ...form, login: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="password" className="label">{t('auth.password')}</label>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </div>

            {error && (
              <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? t('auth.loginBusy') : t('auth.login')}
            </button>

            {/* « Mot de passe ou identifiant oublié ? » — page dédiée qui
                envoie un e-mail (identifiant + lien de réinitialisation). */}
            <div className="text-center">
              <Link to="/forgot-password" className="text-[12px] text-slate-400 hover:text-gold-300 transition-colors">
                {t('auth.forgotPassword')}
              </Link>
            </div>

            <p className="text-[11px] text-slate-500 text-center">
              {t('auth.firstLoginHint')}
            </p>
          </form>
        ) : (
          // 2FA — deuxième étape : code à 6 chiffres (Google Authenticator).
          <form onSubmit={submitTotp} className="card p-6 space-y-4 shadow-2xl shadow-black/40">
            <div className="text-center">
              <p className="text-sm text-slate-300">{t('auth.totpTitle')}</p>
              <p className="mt-1 text-[11px] text-slate-500">{t('auth.totpHint')}</p>
            </div>

            <div>
              <label htmlFor="totpCode" className="label">{t('auth.totpCode')}</label>
              <input
                id="totpCode"
                className="input text-center tracking-[0.4em] font-mono text-lg"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                autoFocus
              />
            </div>

            {error && (
              <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy || totpCode.length !== 6}>
              {busy ? t('auth.totpBusy') : t('auth.totpVerify')}
            </button>

            <button
              type="button"
              onClick={backToCredentials}
              className="w-full text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
            >
              {t('auth.backToLogin')}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
