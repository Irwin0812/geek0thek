/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import fr from './locales/fr.json'
import en from './locales/en.json'
import it from './locales/it.json'
import es from './locales/es.json'
import de from './locales/de.json'
import nl from './locales/nl.json'

export const SUPPORTED_LANGUAGES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'it', label: 'Italiano' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'nl', label: 'Nederlands' },
]

const resources = {
  fr: { translation: fr },
  en: { translation: en },
  it: { translation: it },
  es: { translation: es },
  de: { translation: de },
  nl: { translation: nl },
}

/**
 * Réduit le code détecté (« fr-FR », « en-US »…) au code de langue de base.
 * Retourne null si la langue détectée ne fait pas partie des langues
 * supportées : le fallback `en` s'applique alors.
 */
function convertDetectedLanguage(detected) {
  if (!detected || typeof detected !== 'string') return null
  const base = detected.split('-')[0].split('_')[0].toLowerCase()
  return SUPPORTED_LANGUAGES.some((l) => l.code === base) ? base : null
}

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    // en = langue par défaut au premier chargement (et fallback de toutes
    // les autres) : sans choix explicite enregistré (localStorage ou profil),
    // l'interface s'initialise en anglais.
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: SUPPORTED_LANGUAGES.map((l) => l.code),
    // « fr-FR » détecté → accepté comme « fr » (géré aussi ci-dessus)
    nonExplicitSupportedLngs: true,
    detection: {
      // Lecture UNIQUE du choix explicite conservé dans localStorage
      // (clé `geek0thek_lang`). La langue du navigateur n'est PAS utilisée :
      // première visite sans préférence enregistrée → anglais (lng ci-dessus).
      order: ['localStorage'],
      lookupLocalStorage: 'geek0thek_lang',
      caches: ['localStorage'],
      convertDetectedLanguage,
    },
    interpolation: {
      // React gère déjà l'échappement du HTML
      escapeValue: false,
      prefix: '{{',
      suffix: '}}',
    },
    returnNull: false,
  })

export default i18n
