import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../App.jsx'

export default function Login() {
  const { t } = useTranslation()
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ login: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login({ login: form.login.trim(), password: form.password })
      navigate(location.state?.from || '/', { replace: true })
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
            <span className="absolute inset-3 rounded-full border-2 border-night-500" />
            <span className="h-3.5 w-3.5 rounded-full bg-gold-500" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-wide text-white">
            GEEK<span className="text-gold-400">0THEK</span>
          </h1>
          <p className="mt-1 text-sm text-slate-400">{t('auth.tagline')}</p>
        </div>

        <form onSubmit={submit} className="card p-6 space-y-4 shadow-2xl shadow-black/40">
          <div>
            <label htmlFor="login" className="label">{t('auth.identifierOrEmail')}</label>
            <input
              id="login"
              className="input"
              autoComplete="username"
              placeholder="Admirwin"
              value={form.login}
              onChange={(e) => setForm({ ...form, login: e.target.value })}
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="password" className="label">{t('auth.password')}</label>
            <input
              id="password"
              className="input"
              type="password"
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

          <p className="text-[11px] text-slate-500 text-center">
            {t('auth.firstLoginHint')}
          </p>
        </form>
      </div>
    </div>
  )
}
