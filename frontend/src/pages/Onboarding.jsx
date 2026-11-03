import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../App.jsx'
import { api } from '../services/api.js'

/**
 * SÉCURITÉ À LA PREMIÈRE CONNEXION (onboarding forcé).
 * Rendu par App.jsx dès que le compte connecté porte le drapeau
 * must_change_password = TRUE (admin seedé « Admin »/« Admin » ou compte
 * créé via l'API) : la modification du mot de passe est OBLIGATOIRE
 * (double saisie) et le pseudo de login peut être personnalisé.
 * Une fois validé, l'API remet le drapeau à FALSE, renvoie un nouveau JWT
 * et le profil mis à jour : la session est renouvelée puis redirection
 * vers le tableau de bord.
 */
export default function Onboarding() {
  const { t } = useTranslation()
  const { user, completeOnboarding, logout } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    login: user?.login || '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.newPassword.length < 8) {
      setError(t('onboarding.passwordTooShort'))
      return
    }
    if (form.newPassword !== form.confirmPassword) {
      setError(t('onboarding.passwordMismatch'))
      return
    }
    setBusy(true)
    try {
      const { token, user: onboarded } = await api.onboarding({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
        login: form.login.trim() || undefined,
      })
      completeOnboarding({ token, user: onboarded })
      navigate('/', { replace: true })
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
            {t('onboarding.title')}
          </h1>
          <p className="mt-2 text-sm text-slate-400">{t('onboarding.subtitle')}</p>
        </div>

        <form onSubmit={submit} className="card p-6 space-y-4 shadow-2xl shadow-black/40">
          <div>
            <label htmlFor="currentPassword" className="label">{t('onboarding.currentPassword')}</label>
            <input
              id="currentPassword"
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={form.currentPassword}
              onChange={(e) => setForm({ ...form, currentPassword: e.target.value })}
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="newPassword" className="label">{t('onboarding.newPassword')}</label>
            <input
              id="newPassword"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={form.newPassword}
              onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-slate-500">{t('onboarding.passwordHint')}</p>
          </div>

          <div>
            <label htmlFor="confirmPassword" className="label">{t('onboarding.confirmPassword')}</label>
            <input
              id="confirmPassword"
              className="input"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={form.confirmPassword}
              onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
            />
          </div>

          <div>
            <label htmlFor="login" className="label">{t('onboarding.login')}</label>
            <input
              id="login"
              className="input"
              autoComplete="username"
              placeholder={user?.login || 'Admin'}
              value={form.login}
              onChange={(e) => setForm({ ...form, login: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-slate-500">{t('onboarding.loginHint')}</p>
          </div>

          {error && (
            <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? t('onboarding.busy') : t('onboarding.submit')}
          </button>

          <button
            type="button"
            onClick={() => { logout(); navigate('/login', { replace: true }) }}
            className="w-full text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
          >
            {t('onboarding.backToLogin')}
          </button>
        </form>
      </div>
    </div>
  )
}
