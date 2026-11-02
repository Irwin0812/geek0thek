import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'
import { useAuth } from '../App.jsx'
import Avatar, { AvatarCropModal, revokePreviewUrl } from '../components/Avatar.jsx'

// « H » et « F » restent des libellés universels (une lettre) ;
// « O » est traduit ici via t('profile.genderOther').
const GENDERS = ['H', 'F', 'O']

// Contrôles client des images de profil (le backend refait les mêmes
// vérifications ; ces messages s'affichent immédiatement, avant l'envoi)
const AVATAR_ACCEPTED = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/gif': 'GIF',
}
const AVATAR_MAX_MB = 10

function validateAvatarFile(file, t) {
  if (!AVATAR_ACCEPTED[file.type]) {
    return t('profile.formatNotAccepted', { type: file.type || 'inconnu' })
  }
  if (file.size > AVATAR_MAX_MB * 1024 * 1024) {
    return t('profile.fileTooLarge', {
      size: (file.size / 1024 / 1024).toFixed(1),
      max: AVATAR_MAX_MB,
    })
  }
  return null
}

const EMPTY_FORM = {
  lastName: '',
  firstName: '',
  email: '',
  login: '',
  phone: '',
  bio: '',
  gender: '',
  birthDate: '',
  address: '',
  country: '',
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
}

export default function Profile() {
  const { t } = useTranslation()
  const { user, refresh } = useAuth()
  const [form, setForm] = useState(EMPTY_FORM)
  const [avatar, setAvatar] = useState(null) // { url } — avatar actuel
  const [avatarFile, setAvatarFile] = useState(null) // { url, file } — nouveau fichier choisi
  const [avatarRemoving, setAvatarRemoving] = useState(false)
  const [avatarError, setAvatarError] = useState('')
  const [cropOpen, setCropOpen] = useState('') // URL en cours d'ajustement ('' = fermé)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const fileInput = useRef(null)
  // Valeurs initiales chargées depuis le backend (référentiel du bouton
  // « Annuler ») : re-synchronisé à chaque chargement et à chaque
  // enregistrement réussi.
  const initialSnapshot = useRef(null)

  useEffect(() => {
    api.users
      .me()
      .then(({ user }) => {
        const initialForm = {
          lastName: user.lastName || '',
          firstName: user.firstName || '',
          email: user.email || '',
          login: user.login || '',
          phone: user.phone || '',
          bio: user.bio || '',
          gender: user.gender || '',
          birthDate: user.birthDate ? String(user.birthDate).slice(0, 10) : '',
          address: user.address || '',
          country: user.country || '',
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        }
        const initialAvatar = { url: user.avatarUrl || null }
        setForm(initialForm)
        setAvatar(initialAvatar)
        initialSnapshot.current = { form: initialForm, avatarValue: initialAvatar }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  // Nettoyage au DÉMONTAGE uniquement : URLs en cours (ref actualisé à
  // chaque rendu, lu par cet effet à dépendances vides). Chaque object URL
  // a UN point de révocation unique à son remplacement/retrait — ceci
  // n'attrape que ce qui est resté en vie (page quittée en plein
  // aperçu). revokePreviewUrl : blob: uniquement, jamais de double-révocation.
  const cleanupRef = useRef({ avatarFile: null, cropOpen: '' })
  cleanupRef.current = { avatarFile, cropOpen }
  useEffect(
    () => () => {
      const { avatarFile: f, cropOpen: c } = cleanupRef.current
      if (c && c.url) revokePreviewUrl(c.url)
      if (f) revokePreviewUrl(f.url)
    },
    [],
  )

  const flash = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(''), 3500)
  }

  // « Annuler » du formulaire : revient aux valeurs initiales (chargées du
  // backend) — même comportement que le bouton du modal de modification
  // d'un autre utilisateur (AdminUsers). Le fichier d'avatar en cours est
  // révoqué PROPREMENT ici (un seul point de révocation par object URL) ;
  // l'object URL de la fenêtre d'ajustement est, elle, révoquée par cancelCrop.
  const resetForm = () => {
    if (saving) return
    setError('')
    if (initialSnapshot.current) {
      const snapshot = initialSnapshot.current
      setForm({ ...snapshot.form })
      setAvatar(snapshot.avatarValue)
    }
    if (avatarFile) {
      revokePreviewUrl(avatarFile.url)
      setAvatarFile(null)
    }
    // Fenêtre d'ajustement ouverte : fermeture simple (sa propre révoke).
    if (cropOpen && cropOpen.url) cancelCrop()
    setAvatarRemoving(false)
    setAvatarError('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const set = (key) => (e) =>
    setForm((f) => ({
      ...f,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }))

  const onAvatarFile = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // permet de re-sélectionner le même fichier
    if (!file) return
    setAvatarError('')
    const problem = validateAvatarFile(file, t)
    if (problem) {
      setAvatarError(problem)
      return
    }
    // Le nouveau fichier DEVIENT la preview immédiatement (il sera
    // enregistré tel quel si la fenêtre d'ajustement est annulée).
    // L'ancienne preview (déjà affichée/rendue) est libérée ici.
    if (avatarFile) revokePreviewUrl(avatarFile.url)
    const objectUrl = URL.createObjectURL(file)
    setAvatarFile({ url: objectUrl, file })
    setAvatarRemoving(false)
    // La fenêtre d'ajustement reçoit une object URL DÉDIÉE, jamais celle
    // de la preview : une annulation ne peut pas casser l'aperçu.
    setCropOpen({ url: URL.createObjectURL(file), file })
  }

  // « Ajuster / recentrer » sur l'avatar DÉJÀ enregistré (pas de File en
  // main) : on recadre l'image servie (fetch depuis le cache du navigateur).
  const openExistingCrop = () => {
    const current = avatar && avatar.url ? avatar.url : null
    if (!current) return
    setCropOpen({ url: current, existingUrl: current, existingName: current.split('/').pop() || 'avatar.jpg' })
  }

  // Fermeture de la fenêtre d'ajustement — unique point de révocation de
  // sa object URL :
  //  - appel simple (Échap / « Annuler » / voile) -> révocation immédiate
  //    (revokePreviewUrl : no-op automatique sur l'URL http d'un avatar
  //    existant, jamais de double révocation) ;
  //  - appelé AVEC fonction (après « Valider le cadrage ») -> la fermeture
  //    est déléguée à onAdjust, seul habilité à poser l'état final.
  const cancelCrop = (nextOnClose = null) => {
    if (typeof nextOnClose === 'function') {
      nextOnClose()
      return
    }
    const { url } = cropOpen
    setCropOpen('')
    if (url) revokePreviewUrl(url)
  }

  // Fenêtre d'ajustement validée : le fichier recadré DEVIENT la preview
  // (nouvelle object URL — l'image réellement recadrée, plus de preview
  // obsolète montrant le fichier brut). L'URL de la fenêtre est révoquée
  // (no-op si c'est l'URL http de l'avatar existant) ; l'ancienne URL de
  // preview (déjà affichée/rendue) est libérée.
  const onAdjustAvatar = (croppedFile) => {
    const { url } = cropOpen
    const previous = avatarFile
    setCropOpen('')
    if (url) revokePreviewUrl(url)
    if (previous) revokePreviewUrl(previous.url)
    setAvatarFile({ url: URL.createObjectURL(croppedFile), file: croppedFile })
    setAvatarRemoving(false)
    setAvatarError('')
  }

  // « Annuler le nouveau fichier » : révocation PROPRE de l'URL de la
  // preview ICI (un seul point de révocation par object URL — l'effet de
  // démontage, qui lit cleanupRef, ne la voit plus : jamais de double-
  // révocation), sinon on marque l'avatar existant comme « à supprimer »
  // (confirmé à l'enregistrement).
  const removeAvatarFile = () => {
    if (avatarFile) {
      revokePreviewUrl(avatarFile.url)
      setAvatarFile(null)
    } else {
      setAvatarRemoving(!avatarRemoving)
    }
    setAvatarError('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.newPassword && form.newPassword !== form.confirmPassword) {
      setError(t('profile.passwordMismatch'))
      return
    }
    setSaving(true)
    try {
      // Un fichier d'avatar (ou sa suppression) => envoi multipart, sinon JSON simple.
      let payload
      if (avatarFile || avatarRemoving) {
        payload = new FormData()
        payload.append('lastName', form.lastName.trim())
        payload.append('firstName', form.firstName.trim())
        payload.append('email', form.email.trim())
        payload.append('login', form.login.trim())
        payload.append('phone', form.phone.trim())
        payload.append('bio', form.bio.trim())
        payload.append('gender', form.gender)
        payload.append('birthDate', form.birthDate)
        payload.append('address', form.address.trim())
        payload.append('country', form.country.trim())
        if (avatarFile) payload.append('avatar', avatarFile.file)
        if (avatarRemoving) payload.append('removeAvatar', 'true')
        if (form.newPassword) {
          // Le backend exige le mot de passe actuel pour tout changement de mot de passe
          payload.append('currentPassword', form.currentPassword)
          payload.append('newPassword', form.newPassword)
        }
      } else {
        payload = {
          lastName: form.lastName.trim(),
          firstName: form.firstName.trim(),
          email: form.email.trim(),
          login: form.login.trim(),
          phone: form.phone.trim() || null,
          bio: form.bio.trim() || null,
          gender: form.gender || null,
          birthDate: form.birthDate || null,
          address: form.address.trim() || null,
          country: form.country.trim() || null,
        }
        if (form.newPassword) {
          payload.currentPassword = form.currentPassword
          payload.newPassword = form.newPassword
        }
      }

      const { user } = await api.users.updateMe(payload)
      await refresh()
      const hadAvatarFile = Boolean(avatarFile)
      if (avatarFile) {
        revokePreviewUrl(avatarFile.url)
        setAvatarFile(null)
      }
      setAvatarRemoving(false)
      setAvatarError('')
      if (fileInput.current) fileInput.current.value = ''
      setAvatar({ url: user.avatarUrl || null })
      // Ré-synchronisation de la référence du bouton « Annuler » sur les
      // valeurs maintenant enregistrées (updates fonctionnels : pas de
      // fermeture sur un état obsolète).
      setForm((f) => {
        initialSnapshot.current = {
          form: { ...f, currentPassword: '', newPassword: '', confirmPassword: '' },
          avatarValue: { url: user.avatarUrl || null },
        }
        return { ...f, currentPassword: '', newPassword: '', confirmPassword: '' }
      })
      flash(hadAvatarFile ? t('profile.toastUpdatedAvatar') : t('profile.toastUpdated'))
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const previewUrl = avatarFile ? avatarFile.url : avatar ? avatar.url : null

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 text-slate-400">
        {t('profile.loading')}
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <header>
        {/* Nomenclature officielle (i18n profile.title / navbar.myProfile) : « Mon profil ». */}
        <h1 className="text-2xl font-extrabold text-white">{t('profile.title')}</h1>
      </header>

      {toast && (
        <p className="text-sm text-amber-800 bg-amber-100 border border-amber-500/30 rounded-lg px-3 py-2">
          {toast}
        </p>
      )}

      <form onSubmit={submit} className="card p-6 space-y-4">
        {error && <p className="text-sm text-rose-600">{error}</p>}

        {/* --- Image de profil --- */}
        <h2 className="font-bold text-white">{t('profile.avatarSection')}</h2>
        <div className="flex items-center gap-4">
          <Avatar
            user={{ firstName: form.firstName, lastName: form.lastName, avatarUrl: previewUrl }}
            size={72}
            onImageError={() => setAvatarError(t('profile.imageLoadError'))}
          />
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-ghost !py-1.5 !px-3"
                onClick={() => fileInput.current && fileInput.current.click()}
                disabled={saving}
              >
                {previewUrl ? t('profile.changeImage') : t('profile.chooseImage')}
              </button>
              {avatarFile && !(cropOpen && cropOpen.url) && (
                <button
                  type="button"
                  className="btn-ghost !py-1.5 !px-3"
                  onClick={() => {
                    // object URL dédiée à la fenêtre : l'URL de la preview
                    // n'est jamais révoquée à l'annulation.
                    setCropOpen({ url: URL.createObjectURL(avatarFile.file), file: avatarFile.file })
                  }}
                  disabled={saving}
                >
                  {t('profile.adjustCrop')}
                </button>
              )}
              {!avatarFile && avatar && avatar.url && !(cropOpen && cropOpen.url) && (
                <button
                  type="button"
                  className="btn-ghost !py-1.5 !px-3"
                  onClick={openExistingCrop}
                  disabled={saving}
                >
                  {t('profile.adjustCrop')}
                </button>
              )}
              {(previewUrl || avatarRemoving) && (
                <button
                  type="button"
                  className="btn-danger !py-1.5 !px-3"
                  onClick={removeAvatarFile}
                  disabled={saving}
                >
                  {avatarFile
                    ? t('profile.cancelNewFile')
                    : avatarRemoving
                      ? t('profile.cancelRemoval')
                      : t('profile.removeImage')}
                </button>
              )}
            </div>
            {avatarFile && (
              <p className="text-[11px] text-amber-700">{t('profile.newAvatarAdjusted')}</p>
            )}
            {avatarRemoving && !avatarFile && (
              <p className="text-[11px] text-rose-600">{t('profile.imageWillBeRemoved')}</p>
            )}
            <p className="text-[11px] text-slate-500">
              {t('profile.acceptedFormats', { max: AVATAR_MAX_MB })}
            </p>
            {avatarError && <p className="text-[11px] text-rose-600">{avatarError}</p>}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              onChange={onAvatarFile}
            />
          </div>
        </div>

        <h2 className="font-bold text-white pt-2">{t('profile.personalInfo')}</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t('profile.lastName')}>
            <input className="input" value={form.lastName} onChange={set('lastName')} required minLength={2} />
          </Field>
          <Field label={t('profile.firstName')}>
            <input className="input" value={form.firstName} onChange={set('firstName')} required minLength={2} />
          </Field>
          <Field label={t('profile.email')}>
            <input className="input" type="email" value={form.email} onChange={set('email')} required />
          </Field>
          <Field label={t('profile.login')}>
            <input className="input" value={form.login} onChange={set('login')} required minLength={2} />
          </Field>
          <Field label={t('profile.phone')}>
            <input className="input" value={form.phone} onChange={set('phone')} placeholder={t('profile.phonePlaceholder')} />
          </Field>
          <Field label={t('profile.gender')}>
            <select className="input" value={form.gender} onChange={set('gender')}>
              <option value="">{t('profile.genderChoose')}</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {g === 'O' ? t('profile.genderOther') : g}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('profile.birthDate')}>
            <input className="input" type="date" value={form.birthDate} onChange={set('birthDate')} />
          </Field>
          <Field label={t('profile.country')}>
            <input className="input" value={form.country} onChange={set('country')} placeholder={t('profile.countryPlaceholder')} />
          </Field>
        </div>
        <Field label={t('profile.address')}>
          <input className="input" value={form.address} onChange={set('address')} placeholder={t('profile.addressPlaceholder')} />
        </Field>
        <Field label={t('profile.bio')}>
          <textarea
            className="input min-h-[90px]"
            value={form.bio}
            onChange={set('bio')}
            maxLength={500}
            placeholder={t('profile.bioPlaceholder')}
          />
        </Field>

        {/* Le choix du THEME a été centralisé dans le menu déroulant de
            l'avatar (Navbar.jsx) — cette page ne le gère plus. */}

        <h2 className="font-bold text-white pt-2">{t('profile.password')}</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2 text-xs text-slate-400 -mt-2">{t('profile.keepPassword')}</div>
          <Field label={t('profile.currentPassword')}>
            <input
              className="input"
              type="password"
              value={form.currentPassword}
              onChange={set('currentPassword')}
              autoComplete="current-password"
              placeholder={t('profile.currentPasswordPlaceholder')}
            />
          </Field>
          <div />
          <Field label={t('profile.newPassword')}>
            <input
              className="input"
              type="password"
              value={form.newPassword}
              onChange={set('newPassword')}
              minLength="8"
              autoComplete="new-password"
              placeholder={t('profile.minChars')}
            />
          </Field>
          <Field label={t('profile.confirmPassword')}>
            <input
              className="input"
              type="password"
              value={form.confirmPassword}
              onChange={set('confirmPassword')}
              minLength="8"
              autoComplete="new-password"
              placeholder={t('profile.confirmPasswordPlaceholder')}
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-ghost" onClick={resetForm} disabled={saving}>{t('common.cancel')}</button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>

        {/* Fenêtre d'ajustement / recentrage manuel avant validation */}
        {cropOpen && cropOpen.url && (
          <AvatarCropModal
            file={cropOpen.file}
            url={cropOpen.url}
            existingUrl={cropOpen.existingUrl}
            existingName={cropOpen.existingName || ''}
            label={t('profile.cropLabel')}
            onClose={cancelCrop}
            onAdjust={onAdjustAvatar}
            disabled={saving}
          />
        )}
      </form>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
    </div>
  )
}
