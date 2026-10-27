import { createContext, useCallback, useContext, useMemo, useState } from 'react'

const STORAGE_KEY = 'geek0thek_display'

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

function readStored() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null
  }
}

function persist(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    /* stockage indisponible : les préférences restent en mémoire */
  }
}

const DisplayContext = createContext(null)

/**
 * Préférences d'affichage partagées par toutes les pages de collections
 * (mode grille/liste, type d'image, options de la carte). Persistées en
 * localStorage sous `geek0thek_display`.
 *
 * Note : le dashboard ignore volontairement le mode d'affichage
 * (toujours en grille, dimensions réduites) — cf. pages/Dashboard.jsx.
 */
export function DisplayProvider({ children }) {
  const [settings, setSettings] = useState(() => sanitize(readStored()))

  const update = useCallback((patch) => {
    setSettings((prev) => {
      const next = sanitize({ ...prev, ...patch })
      persist(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    persist({ ...DEFAULT_DISPLAY })
    setSettings({ ...DEFAULT_DISPLAY })
  }, [])

  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset])
  return <DisplayContext.Provider value={value}>{children}</DisplayContext.Provider>
}

export function useDisplay() {
  const ctx = useContext(DisplayContext)
  if (!ctx) throw new Error('useDisplay() doit être utilisé à l’intérieur de <DisplayProvider>.')
  return ctx
}
