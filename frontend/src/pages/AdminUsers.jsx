import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'
import { useAuth } from '../App.jsx'
import { SUPPORTED_LANGUAGES } from '../i18n/i18n.js'
import Avatar, { AvatarCropModal, revokePreviewUrl } from '../components/Avatar.jsx'

// Valeurs stockées (colonnes `users.gender`) ; H / F sont des valeurs de
// données affichées telles quelles — seul « Autre » passe par i18n.
const GENDER_VALUES = ['H', 'F', 'O']

// Contrôles client des images de profil (re-faits côté backend)
const AVATAR_ACCEPTED = {
  'image/jpeg': 'JPG',
  'image/png': 'PNG',
  'image/webp': 'WEBP',
  'image/gif': 'GIF',
}
const AVATAR_MAX_MB = 10

function validateAvatarFile(file) {
  // Renvoie { key, params } — la traduction est faite par l'appelant (t()).
  if (!AVATAR_ACCEPTED[file.type]) {
    return { key: 'profile.formatNotAccepted', params: { type: file.type || 'inconnu' } }
  }
  if (file.size > AVATAR_MAX_MB * 1024 * 1024) {
    return {
      key: 'profile.fileTooLarge',
      params: { size: (file.size / 1024 / 1024).toFixed(1), max: AVATAR_MAX_MB },
    }
  }
  return null
}

const EMPTY = {
  lastName: '',
  firstName: '',
  email: '',
  login: '',
  password: '',
  role: 'user',
  phone: '',
  bio: '',
  // Langue préférée du compte créé (colonne `users.language`) : défaut 'fr'
  // (identique au défaut backend). Valeurs : SUPPORTED_LANGUAGES (i18n.js).
  language: 'fr',
}

export default function AdminUsers() {
  const { user: me, refresh } = useAuth()
  const { t } = useTranslation()
  const [users, setUsers] = useState([])
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null) // { key, params } → traduit via t()
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [editAvatarFile, setEditAvatarFile] = useState(null) // { url, file }
  const [editAvatarRemoving, setEditAvatarRemoving] = useState(false)
  const [editAvatarError, setEditAvatarError] = useState(null) // { key, params }
  const [editCropOpen, setEditCropOpen] = useState(false)
  const editFileInput = useRef(null)

  // États les plus récents pour le nettoyage au DÉMONTAGE (ref actualisé à
  // chaque rendu, lu par un effet à dépendances vides) : l'URL de preview
  // et l'URL dédiée de la fenêtre d'ajustement y sont libérées — sauf si
  // elle est la même (jamais de double-révocation d'URL encore servie).
  const cleanupRef = useRef({ editAvatarFile: null, editCropOpen: false })
  cleanupRef.current = { editAvatarFile, editCropOpen }
  useEffect(
    () => () => {
      const { editAvatarFile: f, editCropOpen: c } = cleanupRef.current
      if (c && c.url) revokePreviewUrl(c.url)
      if (f) revokePreviewUrl(f.url)
    },
    [],
  )

  const load = async () => {
    try {
      const { users: data } = await api.users.list()
      setUsers(data)
    } catch (err) {
      setLoadError(err.message)
    }
  }
  useEffect(() => { load() }, [])

  // Toast structural { key, params } : traduit via t() au rendu (la
  // langue est celle en vigueur à l'affichage, pas au déclenchement).
  const flash = (key, params = null) => {
    setToast({ key, params })
    setTimeout(() => setToast(null), 3500)
  }

  const set = (key) => (e) =>
    setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const submitCreate = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      const { user: created } = await api.users.create({
        lastName: form.lastName.trim(),
        firstName: form.firstName.trim(),
        email: form.email.trim(),
        login: form.login.trim(),
        password: form.password,
        role: form.role,
        language: form.language || 'fr',
        phone: form.phone.trim() || null,
        bio: form.bio.trim() || null,
      })
      setForm(EMPTY)
      setFormOpen(false)
      flash('adminUsers.toastCreated', { login: created.login })
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (u) => {
    setEditTarget(u)
    setEditForm({
      lastName: u.lastName,
      firstName: u.firstName,
      email: u.email,
      login: u.login,
      role: u.role,
      isActive: Boolean(u.isActive),
      phone: u.phone || '',
      bio: u.bio || '',
      gender: u.gender || '',
      birthDate: u.birthDate ? String(u.birthDate).slice(0, 10) : '',
      address: u.address || '',
      country: u.country || '',
      // Langue préférée : valeur stockée (mapUser garantit 'fr' si null)
      language: u.language || 'fr',
      newPassword: '',
    })
    setEditAvatarFile(null)
    setEditAvatarRemoving(false)
    setEditAvatarError(null)
    setEditCropOpen(false)
    setError('')
  }

  const closeEdit = () => {
    // object URLs libérées ici (preview + URL dédiée de la fenêtre, si
    // elle est encore ouverte). revokePreviewUrl : no-op sur une URL
    // http, jamais une URL déjà libérée ailleurs (un point de révocation
    // unique par object URL).
    if (editAvatarFile) revokePreviewUrl(editAvatarFile.url)
    if (editCropOpen && editCropOpen.url) revokePreviewUrl(editCropOpen.url)
    setEditCropOpen(false)
    setEditTarget(null)
    setEditAvatarFile(null)
    setEditAvatarRemoving(false)
    setEditAvatarError(null)
    setError('')
  }

  const setEdit = (key) => (e) =>
    setEditForm((f) => ({
      ...f,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }))

  // Fichier validé type/taille : il DEVIENT la preview du formulaire, et la
  // fenêtre d'ajustement s'ouvre sur une object URL DÉDIÉE (jamais celle de
  // la preview : une annulation ne peut pas casser l'aperçu).
  // « Valider le cadrage » recadre le fichier avant l'upload final ;
  // « Annuler » conserve le fichier non recadré en preview.
  const onEditAvatarFile = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // permet de re-sélectionner le même fichier
    if (!file) return
    setEditAvatarError(null)
    setError('')
    const problem = validateAvatarFile(file)
    if (problem) {
      setEditAvatarError(problem)
      return
    }
    if (editAvatarFile) revokePreviewUrl(editAvatarFile.url)
    setEditAvatarFile({ url: URL.createObjectURL(file), file })
    setEditAvatarRemoving(false)
    setEditCropOpen({ url: URL.createObjectURL(file), file })
  }

  // « Ajuster / recentrer » sur l'avatar DÉJÀ enregistré (pas de File en
  // main) : on recadre l'image servie (fetch depuis le cache du navigateur).
  const openExistingCrop = () => {
    const current = editTarget && editTarget.avatarUrl ? editTarget.avatarUrl : null
    if (!current) return
    setEditCropOpen({ url: current, existingUrl: current, existingName: current.split('/').pop() || 'avatar.jpg' })
  }

  // Fenêtre d'ajustement validée : le fichier recadré DEVIENT la preview
  // (nouvelle object URL — l'image réellement recadrée, plus de preview
  // obsolète montrant le fichier brut). L'URL de la fenêtre est révoquée
  // (no-op si c'est l'URL http de l'avatar existant) ; l'ancienne URL de
  // preview (déjà affichée/rendue) est libérée. Un seul point de
  // révocation par object URL : jamais de double-révocation, jamais de
  // révocation d'une URL encore servie.
  const onAdjustEditAvatar = (croppedFile) => {
    const { url } = editCropOpen
    const previous = editAvatarFile
    setEditCropOpen(false)
    if (url) revokePreviewUrl(url)
    if (previous) revokePreviewUrl(previous.url)
    setEditAvatarFile({ url: URL.createObjectURL(croppedFile), file: croppedFile })
    setEditAvatarRemoving(false)
    setEditAvatarError(null)
    if (editFileInput.current) editFileInput.current.value = ''
  }

  // Fermeture de la fenêtre d'ajustement — unique point de révocation de
  // sa object URL dédiée :
  //  - appel simple (Échap / « Annuler » / voile) -> révocation immédiate
  //    (revokePreviewUrl : no-op sur l'URL http d'un avatar existant,
  //    jamais de double révocation) ; l'URL de la preview n'est JAMAIS
  //    touchée ici ;
  //  - appelé AVEC fonction (après « Valider le cadrage ») -> la fermeture
  //    est déléguée à onAdjustEditAvatar, seul habilité à poser l'état
  //    final (c'est lui qui révoque l'URL de la fenêtre et l'ancienne
  //    preview : le recadrage n'est jamais perdu ni révoqué deux fois).
  const cancelEditCrop = (nextOnClose = null) => {
    if (typeof nextOnClose === 'function') {
      nextOnClose()
      return
    }
    const { url } = editCropOpen
    setEditCropOpen(false)
    if (url) revokePreviewUrl(url)
  }

  // « Annuler le nouveau fichier » : révocation PROPRE de l'URL de la
  // preview ICI (point unique — l'effet de démontage qui lit
  // cleanupRef ne la voit plus : jamais de double-révocation) ; sinon
  // bascule du marquage « avatar existant à supprimer » (confirmé à
  // l'enregistrement).
  const removeEditAvatarFile = () => {
    if (editAvatarFile) {
      revokePreviewUrl(editAvatarFile.url)
      setEditAvatarFile(null)
    } else {
      setEditAvatarRemoving(!editAvatarRemoving)
    }
    setEditAvatarError(null)
    setError('')
    if (editFileInput.current) editFileInput.current.value = ''
  }

  const editPreviewUrl = editAvatarFile
    ? editAvatarFile.url
    : editAvatarRemoving
      ? null
      : editTarget
        ? editTarget.avatarUrl || null
        : null

  const submitEdit = async (e) => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      let payload
      // Avatar (nouveau fichier ou suppression) → multipart ; sinon JSON.
      if (editAvatarFile || editAvatarRemoving) {
        payload = new FormData()
        payload.append('lastName', editForm.lastName.trim())
        payload.append('firstName', editForm.firstName.trim())
        payload.append('email', editForm.email.trim())
        payload.append('login', editForm.login.trim())
        payload.append('role', editForm.role || 'user')
        payload.append('isActive', editForm.isActive ? 'true' : 'false')
        payload.append('phone', editForm.phone.trim())
        payload.append('bio', editForm.bio.trim())
        payload.append('gender', editForm.gender)
        payload.append('language', editForm.language || 'fr')
        payload.append('birthDate', editForm.birthDate)
        payload.append('address', editForm.address.trim())
        payload.append('country', editForm.country.trim())
        if (editAvatarFile) payload.append('avatar', editAvatarFile.file)
        if (editAvatarRemoving) payload.append('removeAvatar', 'true')
        if (editForm.newPassword) payload.append('newPassword', editForm.newPassword)
      } else {
        payload = {
          lastName: editForm.lastName.trim(),
          firstName: editForm.firstName.trim(),
          email: editForm.email.trim(),
          login: editForm.login.trim(),
          role: editForm.role || 'user',
          isActive: Boolean(editForm.isActive),
          phone: editForm.phone.trim() || null,
          bio: editForm.bio.trim() || null,
          gender: editForm.gender || null,
          language: editForm.language || 'fr',
          birthDate: editForm.birthDate || null,
          address: editForm.address.trim() || null,
          country: editForm.country.trim() || null,
        }
        if (editForm.newPassword) payload.newPassword = editForm.newPassword
      }
      const { user: updated } = await api.users.update(editTarget.id, payload)
      // Nettoyage du preview local (object URL de la preview conservée
      // après un recentrage d'avatar existant : révoquée seulement si
      // c'est bien une object URL).
      if (editAvatarFile) {
        revokePreviewUrl(editAvatarFile.url)
        setEditAvatarFile(null)
      }
      setEditTarget(null)
      setEditAvatarRemoving(false)
      setError('')
      setEditAvatarError(null)
      if (editFileInput.current) editFileInput.current.value = ''
      flash('adminUsers.accountUpdated')
      load()
      // L'admin a modifié ses propres infos (nom, email, avatar…) ?
      if (updated.id === me.id) refresh()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    try {
      await api.users.remove(deleteTarget.id)
      flash('adminUsers.toastDeleted', { login: deleteTarget.login })
      setDeleteTarget(null)
      load()
      if (deleteTarget.id === me.id) refresh()
    } catch (err) {
      alert(err.message)
    }
  }

  // Corps de la modale de suppression : fragments traduits via deleteBody{count}
  // (tableau — login isolé dans [1] pour `<span>`), pluriel disques géré par i18n.
  const deleteAccountParts = deleteTarget
    ? t('adminUsers.deleteBody', {
        login: deleteTarget.login,
        count: deleteTarget.vinylCount || 0,
        returnObjects: true,
      }) || []
    : []

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          {/* cb-page-title : lettrage « case de BD » sous le thème Comic Books. */}
          <h1 className="cb-page-title text-2xl font-extrabold text-white">{t('adminUsers.title')}</h1>
          {/* Sous-titre explicatif en gras + halo blanc lumineux (.subtitle-glow). */}
          <p className="text-sm text-slate-400 mt-1 subtitle-glow">
            {t('adminUsers.subtitle', { count: users.length })}
          </p>
        </div>
        <button className="btn-primary" onClick={() => setFormOpen((v) => !v)}>
          {t('adminUsers.newUser')}
        </button>
      </header>

      {toast && (
        <p className="text-sm text-gold-300 bg-gold-500/10 border border-gold-500/30 rounded-lg px-3 py-2">{t(toast.key, toast.params ?? {})}</p>
      )}

      {formOpen && (
        <form onSubmit={submitCreate} className="card p-6 space-y-4">
          <h2 className="font-bold text-white">{t('adminUsers.createTitle')}</h2>
          {error && <p className="text-sm text-rose-400">{error}</p>}
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t('profile.lastName')}><input className="input" value={form.lastName} onChange={set('lastName')} required /></Field>
            <Field label={t('profile.firstName')}><input className="input" value={form.firstName} onChange={set('firstName')} required /></Field>
            <Field label={t('profile.email')}><input className="input" type="email" value={form.email} onChange={set('email')} required /></Field>
            <Field label={t('adminUsers.loginField')}><input className="input" value={form.login} onChange={set('login')} required /></Field>
            <Field label={t('adminUsers.passwordField')}>
              <input className="input" type="password" value={form.password} onChange={set('password')} minLength="8" required placeholder={t('profile.minChars')} />
            </Field>
            <Field label={t('adminUsers.role')}>
              <select className="input" value={form.role} onChange={set('role')}>
                <option value="user">{t('navbar.roleUser')}</option>
                <option value="admin">{t('navbar.roleAdmin')}</option>
              </select>
            </Field>
            <Field label={t('adminUsers.preferredLanguage')}>
              <select className="input" value={form.language} onChange={set('language')}>
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang.code} value={lang.code}>{lang.label}</option>
                ))}
              </select>
            </Field>
            <Field label={t('adminUsers.phoneOptional')}><input className="input" value={form.phone} onChange={set('phone')} /></Field>
            <Field label={t('adminUsers.bioOptional')}><input className="input" value={form.bio} onChange={set('bio')} /></Field>
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? t('adminUsers.creating') : t('adminUsers.createBtn')}</button>
            <button type="button" className="btn-ghost" onClick={() => { setFormOpen(false); setError('') }}>{t('common.cancel')}</button>
          </div>
        </form>
      )}

      {loadError ? (
        <p className="text-sm text-rose-400">{loadError}</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500 border-b border-night-600/60">
                <th className="px-4 py-3">{t('adminUsers.colMember')}</th>
                <th className="px-4 py-3">{t('adminUsers.colLogin')}</th>
                <th className="px-4 py-3">{t('adminUsers.colRole')}</th>
                <th className="px-4 py-3">{t('adminUsers.colCollection')}</th>
                <th className="px-4 py-3">{t('adminUsers.colStatus')}</th>
                <th className="px-4 py-3">{t('adminUsers.colVinyls')}</th>
                <th className="px-4 py-3">{t('adminUsers.colComics')}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className={`border-b border-night-700/50 hover:bg-night-700/20${u.isActive ? '' : ' opacity-60'}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar user={u} size={36} />
                      <div>
                        <div className="font-semibold text-slate-100">
                          {u.firstName} {u.lastName}
                          {u.id === me.id && <span className="ml-2 text-xs text-slate-500">{t('adminUsers.you')}</span>}
                        </div>
                        <div className="text-xs text-slate-500">{u.email}{u.phone ? ` · ${u.phone}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-300">{u.login}</td>
                  <td className="px-4 py-3">
                    <span className={`badge ${u.role === 'admin' ? 'bg-gold-500/15 text-gold-300 border border-gold-500/30' : 'bg-night-700 text-slate-400'}`}>
                      {u.role === 'admin' ? 'admin' : 'user'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${u.isPublic ? 'bg-emerald-500/15 text-emerald-300' : 'bg-night-700 text-slate-400'}`}>
                      {t(u.isPublic ? 'adminUsers.collectionPublic' : 'adminUsers.collectionPrivate')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${u.isActive ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
                      {t(u.isActive ? 'adminUsers.statusActive' : 'adminUsers.statusDisabled')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{u.vinylCount ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{u.comicCount ?? '—'}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {u.id !== me.id ? (
                      <>
                        <button className="btn-ghost !py-1 !px-2 mr-1" onClick={() => openEdit(u)}>{t('common.edit')}</button>
                        <button className="btn-danger !py-1 !px-2" onClick={() => setDeleteTarget(u)}>{t('common.delete')}</button>
                      </>
                    ) : (
                      <span className="text-xs text-slate-600">{t('adminUsers.yourAccount')}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal édition */}
      {editTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-night-950/80 backdrop-blur-sm overflow-y-auto">
          {/* role=dialog + aria-modal : semantic modal + hook du liseré tricolore
              du thème Comic Books. */}
          <form onSubmit={submitEdit} role="dialog" aria-modal="true" className="card w-full max-w-xl p-6 space-y-4">
            <h2 className="font-bold text-white">{t('adminUsers.editModalTitle', { login: editTarget.login })}</h2>
            {error && <p className="text-sm text-rose-400">{error}</p>}

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label={t('adminUsers.lastName')}><input className="input" value={editForm.lastName} onChange={setEdit('lastName')} /></Field>
              <Field label={t('adminUsers.firstName')}><input className="input" value={editForm.firstName} onChange={setEdit('firstName')} /></Field>
              <Field label={t('adminUsers.emailLabel')}><input className="input" type="email" value={editForm.email} onChange={setEdit('email')} /></Field>
              <Field label={t('adminUsers.loginLabel')}><input className="input" value={editForm.login} onChange={setEdit('login')} /></Field>
              <Field label={t('adminUsers.phoneLabel')}><input className="input" value={editForm.phone} onChange={setEdit('phone')} /></Field>
              <Field label={t('adminUsers.genderField')}>
                <select className="input" value={editForm.gender} onChange={setEdit('gender')}>
                  <option value="">{t('adminUsers.genderIndiff')}</option>
                  {GENDER_VALUES.filter((g) => g !== 'O').map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                  <option value="O">{t('profile.genderOther')}</option>
                </select>
              </Field>
              <Field label={t('adminUsers.birthDate')}>
                <input className="input" type="date" value={editForm.birthDate} onChange={setEdit('birthDate')} />
              </Field>
              <Field label={t('adminUsers.country')}><input className="input" value={editForm.country} onChange={setEdit('country')} /></Field>
            </div>
            <Field label={t('adminUsers.address')}><input className="input" value={editForm.address} onChange={setEdit('address')} /></Field>
            <Field label={t('adminUsers.bioLabel')}><input className="input" value={editForm.bio} onChange={setEdit('bio')} /></Field>

            <div className="grid sm:grid-cols-2 gap-4">
              <Field label={t('adminUsers.role')}>
                <select className="input" value={editForm.role} onChange={setEdit('role')}>
                  <option value="user">{t('navbar.roleUser')}</option>
                  <option value="admin">{t('navbar.roleAdmin')}</option>
                </select>
              </Field>
              <Field label={t('adminUsers.preferredLanguage')}>
                <select className="input" value={editForm.language} onChange={setEdit('language')}>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>{lang.label}</option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Image de profil */}
            <div className="flex items-center gap-4">
              <Avatar
                user={{ firstName: editForm.firstName, lastName: editForm.lastName, avatarUrl: editPreviewUrl }}
                size={48}
                onImageError={() =>
                  setEditAvatarError({ key: 'profile.imageLoadError', params: {} })
                }
              />
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="btn-ghost !py-1 !px-2"
                    onClick={() => editFileInput.current && editFileInput.current.click()}
                    disabled={saving}
                  >
                    {t(editPreviewUrl ? 'profile.changeImage' : 'profile.chooseImage')}
                  </button>
                  {editAvatarFile && !(editCropOpen && editCropOpen.url) && (
                    <button
                      type="button"
                      className="btn-ghost !py-1 !px-2"
                      onClick={() => {
                        // object URL dédiée à la fenêtre : l'URL de la
                        // preview n'est jamais révoquée à l'annulation.
                        setEditCropOpen({ url: URL.createObjectURL(editAvatarFile.file), file: editAvatarFile.file })
                      }}
                      disabled={saving}
                    >
                      {t('profile.adjustCrop')}
                    </button>
                  )}
                  {!editAvatarFile && editTarget && editTarget.avatarUrl && !(editCropOpen && editCropOpen.url) && (
                    <button
                      type="button"
                      className="btn-ghost !py-1 !px-2"
                      onClick={openExistingCrop}
                      disabled={saving}
                    >
                      {t('profile.adjustCrop')}
                    </button>
                  )}
                  {(editPreviewUrl || editAvatarRemoving) && (
                    <button
                      type="button"
                      className="btn-danger !py-1 !px-2"
                      onClick={removeEditAvatarFile}
                      disabled={saving}
                    >
                      {t(editAvatarFile ? 'profile.cancelNewFile' : editAvatarRemoving ? 'profile.cancelRemoval' : 'profile.removeImage')}
                    </button>
                  )}
                </div>
                {editAvatarFile && (
                  <p className="text-[11px] text-gold-300">
                    {t('profile.newAvatarAdjusted')}
                  </p>
                )}
                {editAvatarRemoving && !editAvatarFile && (
                  <p className="text-[11px] text-rose-400">{t('profile.imageWillBeRemoved')}</p>
                )}
                <p className="text-[11px] text-slate-500">
                  {t('profile.acceptedFormats', { max: AVATAR_MAX_MB })}
                </p>
                {editAvatarError && (
                  <p className="text-[11px] text-rose-400">{t(editAvatarError.key, editAvatarError.params ?? {})}</p>
                )}
                <input
                  ref={editFileInput}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={onEditAvatarFile}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input type="checkbox" checked={Boolean(editForm.isActive)} onChange={setEdit('isActive')} className="accent-gold-500" />
                {t('adminUsers.activeAccount')}
              </label>
            </div>

            <Field label={t('adminUsers.newPasswordField')}>
              <input className="input" type="password" value={editForm.newPassword || ''} onChange={setEdit('newPassword')} minLength="8" placeholder={t('profile.minChars')} />
            </Field>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={closeEdit} disabled={saving}>{t('common.cancel')}</button>
              <button type="submit" className="btn-primary" disabled={saving}>{t('common.save')}</button>
            </div>
          </form>

          {/* Fenêtre d'ajustement / recentrage manuel avant validation */}
          {editCropOpen && editCropOpen.url && (
            <AvatarCropModal
              file={editCropOpen.file}
              url={editCropOpen.url}
              existingUrl={editCropOpen.existingUrl}
              existingName={editCropOpen.existingName || ''}
              label={t('adminUsers.adjustAvatarLabel', { login: editTarget.login })}
              onClose={cancelEditCrop}
              onAdjust={onAdjustEditAvatar}
              disabled={saving}
            />
          )}
        </div>
      )}

      {/* Modal suppression */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-night-950/80 backdrop-blur-sm">
          {/* role=dialog + aria-modal : semantic modal + hook du liseré tricolore. */}
          <div role="dialog" aria-modal="true" className="card w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-white">{t('adminUsers.deleteTitle')}</h2>
            <p className="mt-2 text-sm text-slate-400">
              {deleteAccountParts[0]}<span className="text-slate-200">{deleteAccountParts[1]}</span>{deleteAccountParts[2] || ''}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</button>
              <button className="btn-danger" onClick={remove}>{t('common.delete')}</button>
            </div>
          </div>
        </div>
      )}
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
