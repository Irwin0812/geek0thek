/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react'

/* Clés localStorage SÉPARÉES par section : les préférences d'affichage de
   « Mes disques » (SCOPE_DISKS) et de « Mes BD » (SCOPE_COMICS) sont
   totalement indépendantes — changer le mode grille/liste d'une page ne
   modifie jamais l'autre. L'ancien stockage monolithique (STORAGE_KEY_LEGACY,
   « geek0thek_display ») est migré une fois vers les deux scopes à la
   première visite, puis abandonné (le dashboard force sa grille : il n'a pas
   de scope dédié). */
const STORAGE_KEY_DISKS = 'geek0thek_display_disks'
const STORAGE_KEY_COMICS = 'geek0thek_display_comics'
const STORAGE_KEY_LEGACY = 'geek0thek_display'

/** Scopes d'affichage reconnus (pages de collection « Mes disques » / « Mes BD »). */
export const DISPLAY_SCOPES = Object.freeze({ disks: 'disks', comics: 'comics' })

const STORAGES = Object.freeze({
  [DISPLAY_SCOPES.disks]: STORAGE_KEY_DISKS,
  [DISPLAY_SCOPES.comics]: STORAGE_KEY_COMICS,
})

/**
 * Types d'image proposés dans les options de la vue en grille.
 * Seuls les éléments disposant de plusieurs visuels pourraient les
 * utiliser ; aujourd'hui un disque/une BD n'a qu'une image (cover_url),
 * donc seul « Principal » est disponible (les autres restent verrouillés).
 */
export const IMAGE_TYPES = [
  { value: 'main', label: 'Principal', available: true },
  { value: 'banner', label: 'Bannière', available: false },
  { value: 'disc', label: 'Disque', available: false },
  { value: 'logo', label: 'Logo', available: false },
  { value: 'thumbnails', label: 'Vignettes', available: false },
]

export const DEFAULT_DISPLAY = Object.freeze({
  view: 'grid',
  imageType: 'main',
  showTitle: true,
  showYear: true,
  showBadges: true,
  jukebox: false,
})

const VIEWS = ['grid', 'list']
const IMAGE_VALUES = IMAGE_TYPES.map((t) => t.value)

/** Normalise une valeur stockée / partiellement fournie. */
function sanitize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    view: VIEWS.includes(src.view) ? src.view : DEFAULT_DISPLAY.view,
    imageType: IMAGE_VALUES.includes(src.imageType) ? src.imageType : DEFAULT_DISPLAY.imageType,
    showTitle: typeof src.showTitle === 'boolean' ? src.showTitle : DEFAULT_DISPLAY.showTitle,
    showYear: typeof src.showYear === 'boolean' ? src.showYear : DEFAULT_DISPLAY.showYear,
    showBadges: typeof src.showBadges === 'boolean' ? src.showBadges : DEFAULT_DISPLAY.showBadges,
    jukebox: typeof src.jukebox === 'boolean' ? src.jukebox : DEFAULT_DISPLAY.jukebox,
  }
}

function readStored(storageKey) {
  try {
    return JSON.parse(localStorage.getItem(storageKey))
  } catch {
    return null
  }
}

function persist(settings, storageKey) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings))
  } catch {
    /* stockage indisponible : les préférences restent en mémoire */
  }
}

/**
 * Initialise le scope demandé : lit sa propre clé localStorage ; sans
 * donnée, reprend l'ancienne valeur MONOLITHIQUE si elle existe (migration
 * d'un ancien profil : les deux sections héritent alors de la vue unique
 * d'avant), sinon valeurs par défaut.
 */
function loadForScope(scope) {
  const storageKey = STORAGES[scope] || STORAGE_KEY_LEGACY
  return sanitize(readStored(storageKey) ?? readStored(STORAGE_KEY_LEGACY))
}

const DisplayContext = createContext(null)

/**
 * Préférences d'affichage par section (mode grille/liste, type d'image,
 * options de la carte), persistées en localStorage — chaque scope possède sa
 * propre clé :
 *   scope 'disks'  → « geek0thek_display_disks »  (page « Mes disques »)
 *   scope 'comics' → « geek0thek_display_comics » (page « Mes BD »)
 * `scope` par défaut : 'disks' — le dashboard force sa grille (il ne lit que
 * showTitle/showYear/jukebox) et partage donc le scope disques.
 *
 * Changer le mode d'affichage dans une section n'a AUCUN effet sur l'autre :
 * `update({ view: 'list' })` sur le scope 'disks' ne touche jamais la clé
 * « comics » (et inversement).
 */
export function DisplayProvider({ children, scope = DISPLAY_SCOPES.disks }) {
  const storageKey = STORAGES[scope] || STORAGE_KEY_LEGACY
  const [settings, setSettings] = useState(() => loadForScope(scope))

  const update = useCallback(
    (patch) => {
      setSettings((prev) => {
        const next = sanitize({ ...prev, ...patch })
        persist(next, storageKey)
        return next
      })
    },
    [storageKey],
  )

  const reset = useCallback(() => {
    persist({ ...DEFAULT_DISPLAY }, storageKey)
    setSettings({ ...DEFAULT_DISPLAY })
  }, [storageKey])

  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset])
  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>
}

export function useDisplay() {
  const ctx = useContext(DisplayContext)
  if (!ctx) throw new Error('useDisplay() doit être utilisé à l’intérieur de <DisplayProvider>.')
  return ctx
}
