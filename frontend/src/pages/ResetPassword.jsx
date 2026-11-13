/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'
import PasswordInput from '../components/PasswordInput.jsx'

/**
 * Réinitialisation du mot de passe — page publique cible du lien envoyé par
 * e-mail (« Mot de passe ou identifiant oublié ? ») : /reset-password/:token.
 * Le jeton est à USAGE UNIQUE et expire après 1 h (vérifié côté backend,
 * table password_resets). Le nouveau mot de passe est imposé par la règle
 * standard (8 caractères minimum) ; la double saisie est vérifiée ici ET le
 * backend remet must_change_password = FALSE (l'utilisateur a choisi SON mot
 * de passe via un lien sécurisé — pas d'onboarding forcé ensuite).
 */
export default function ResetPassword() {
  const { t } = useTranslation()
  const { token } = useParams()
  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.newPassword.length < 8) {
      setError(t('auth.resetTooShort'))
      return
    }
    if (form.newPassword !== form.confirmPassword) {
      setError(t('auth.resetMismatch'))
      return
    }
    setBusy(true)
    try {
      // Le jeton de l'URL est transmis dans le CORPS de la requête POST (le
      // backend ne lit que req.body). « password » est envoyé en plus de
      // « newPassword » : les deux clés sont acceptées par le backend, la
      // concordance du payload est donc garantie quel que soit le contrat.
      await api.resetPassword({ token, newPassword: form.newPassword, password: form.newPassword })
      setDone(true)
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
            {t('auth.resetTitle')}
          </h1>
          <p className="mt-2 text-sm text-slate-400">{t('auth.resetSubtitle')}</p>
        </div>

        {done ? (
          <div className="card p-6 space-y-4 shadow-2xl shadow-black/40">
            <p className="text-sm text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
              {t('auth.resetDone')}
            </p>
            <Link to="/login" className="btn-primary w-full inline-block text-center">
              {t('auth.login')}
            </Link>
          </div>
        ) : (
          <form onSubmit={submit} className="card p-6 space-y-4 shadow-2xl shadow-black/40">
            <div>
              <label htmlFor="newPassword" className="label">{t('auth.resetNewPassword')}</label>
              <PasswordInput
                id="newPassword"
                autoComplete="new-password"
                placeholder="••••••••"
                value={form.newPassword}
                onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                autoFocus
              />
              <p className="mt-1 text-[11px] text-slate-500">{t('auth.resetHint')}</p>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="label">{t('auth.resetConfirm')}</label>
              <PasswordInput
                id="confirmPassword"
                autoComplete="new-password"
                placeholder="••••••••"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              />
            </div>

            {error && (
              <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? t('auth.resetBusy') : t('auth.resetSubmit')}
            </button>

            <Link to="/forgot-password" className="block w-full text-center text-[11px] text-slate-500 hover:text-slate-300 transition-colors">
              {t('auth.forgotTitle')}
            </Link>
          </form>
        )}
      </div>
    </div>
  )
}
