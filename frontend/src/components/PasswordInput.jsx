/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Champ de mot de passe avec bouton d'affichage (œil) à droite du champ.
 *
 * Ergonomie : un clic sur l'œil bascule dynamiquement le type du champ entre
 * « password » (masqué) et « text » (en clair), puis re-bascule au second clic.
 * L'icône Eye/EyeOff (lucide-react) indique l'état courant :
 *   - œil ouvert  (Eye)    → le mot de passe est MASQUÉ, un clic l'affiche ;
 *   - œil barré   (EyeOff) → le mot de passe est AFFICHÉ, un clic le masque.
 *
 * Le bouton est `type="button"` (il ne soumet jamais le formulaire) et
 * `tabIndex={-1}` (il reste accessible au clavier via l'input lui-même).
 *
 * Props : mêmes attributs qu'un <input> standard (id, value, onChange,
 * placeholder, autoComplete, minLength, required, autoFocus, disabled).
 */
export default function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  minLength,
  required,
  autoFocus,
  disabled,
}) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <input
        id={id}
        className="input pr-10"
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
        autoFocus={autoFocus}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t('common.hidePassword') : t('common.showPassword')}
        title={visible ? t('common.hidePassword') : t('common.showPassword')}
        tabIndex={-1}
        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200 focus:outline-none focus:ring-2 focus:ring-gold-500/30 rounded"
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}
