import { useEffect, useRef, useState } from 'react'
import { getAppliedTheme } from '../services/theme.js'

/**
 * Thème appliqué RÉACTIF : suit l'attribut data-theme de <html> via un
 * MutationObserver — le composant se re-rend INSTANTANÉMENT à chaque
 * changement de thème (sans attendre un F5 ni une navigation).
 * Remplace les lectures statiques `getAppliedTheme()` qui figent la valeur
 * au premier rendu et ne se mettent à jour qu'au prochain montage.
 */
export function useAppliedTheme() {
  const [theme, setTheme] = useState(() => getAppliedTheme())

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(getAppliedTheme())
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return theme
}

/**
 * Ferme au clic à l'extérieur / touche Échap.
 * Retourne une ref à poser sur le conteneur du panneau (bouton déclencheur inclus).
 * Pour la fermeture au RETRAIT DE LA SOURIS (survol), préférer `useHoverClose`.
 */
export function useDismiss(open, onClose) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onPointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose()
    }
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])
  return ref
}

/**
 * Fermeture au SURVOL « stable » d'un menu déroulant (état React + délai) :
 * remplace les `onMouseLeave` instantanés qui fermaient le menu dès le premier
 * faux mouvement de la souris (et ce que l'absence totale de fermeture au survol
 * laissait bloqué ouvert en attendant un clic extérieur).
 *
 * À brancher sur le CONTEUR englobant bouton déclencheur + panneau (+
 * sous-menus) :
 *   <div ref={ref} onMouseEnter={hover.onMouseEnter} onMouseLeave={hover.onMouseLeave}>
 *
 *  - Délai avant fermeture (par défaut 200 ms) : le trajet de la souris ENTRE le
 *    bouton et le panneau (le petit espace `mt-1.5`) ne déclenche plus rien, et
 *    même un départ réel n'a d'effet qu'après ce délai → fermeture « fluide ».
 *  - Toute ré-entrée dans la zone (bouton OU panneau) ANNULE le délai en cours :
 *    aucun clignotement open/close quand la souris frôle la bordure.
 *  - À combiner avec une zone de survol CONTINUE : le panneau comble sa marge
 *    `mt-1.5` par un fond transparent (`before:-top-1.5 before:h-1.5 ...`) pour
 *    que le passage bouton → panneau reste géométriquement DANS la zone.
 *  - Curseur véritablement sorti de la zone (bouton + panneau) → fermeture
 *    garantie après le délai : plus de menu « collé ouvert ».
 *  - Le clic extérieur / la touche Échap restent du ressort de `useDismiss`.
 */
export function useHoverClose(onClose, delay = 200) {
  const timer = useRef(null)

  const cancel = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  // Nettoyage au démontage : un délai en attente ne doit jamais exécuter onClose
  // après la disparition du composant.
  useEffect(() => () => cancel(), [])

  const onMouseEnter = () => cancel()
  const onMouseLeave = () => {
    cancel() // une seule fermeture différée à la fois (pas de cumul)
    timer.current = setTimeout(() => {
      timer.current = null
      onClose()
    }, delay)
  }

  return { onMouseEnter, onMouseLeave }
}
