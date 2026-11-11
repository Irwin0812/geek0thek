/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { toDisplayImageUrl } from '../services/imageUrl.js'

/** Révoque une object URL de prévisualisation… seulement si c'est bien une
 *  object URL (blob:). Les URL HTTP (avatar déjà enregistré) n'ont rien à
 *  révoquer ; un `revokeObjectURL` intempestif sur une URL encore utilisée
 *  par l'interface ferait « Failed to load resource » dans l'aperçu.
 */
export function revokePreviewUrl(url) {
  if (typeof url === 'string' && url.startsWith('blob:')) URL.revokeObjectURL(url)
}

/**
 * Convertit une valeur « image de profil » en source prête pour <img src>.
 *
 * Délégué au helper centralisé services/imageUrl.js : un chemin local
 * ("/uploads/avatars/...") est renvoyé RELATIF (résolu contre l'origine courante
 * — jamais de hôte codé en dur) et une URL distante passe par le proxy d'image
 * du backend (MÊME ORIGINE, anti Mixed Content / CORS). Les object URLs blob:
 * d'aperçu sont conservées telles quelles.
 */
export function toAbsoluteUrl(raw) {
  return toDisplayImageUrl(raw)
}

/** Attache le couple (img, url) à une tâche de décodage puis de rendu :
 *  l'URL n'est libérable que quand l'<img> est chargé ET que ses données
 *  sont rendues (requestAnimationFrame). `done` est appelé une seule fois
 *  (sécurisé par `cancel`), sur succès OU échec — jamais en double, jamais
 *  sans être appelé. À appeler après la création de l'<img>, AVANT src= :
 *  on ne rate ni l'onload ni l'onerror, même si le chargement est instantané. */
function onImageRendered(img, url, done) {
  let settled = false
  const finish = (ok) => {
    if (settled) return
    settled = true
    img.onload = null
    img.onerror = null
    const after = (cb) => {
      if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(cb)
      else cb()
    }
    after(() => after(() => done(ok)))
  }
  img.onload = () => finish(true)
  img.onerror = () => finish(false)
  try {
    if (typeof img.decode === 'function') {
      // Succès de decode -> prêt ; en cas d'erreur on laisse l'onerror
      // déclencher la branche d'échec (jamais de finish(true) à tort).
      img.decode().then(() => finish(true), () => {})
    }
  } catch {
    /* decode indisponible : onload/onerror suffisent */
  }
  return {
    cancel() {
      settled = true
      img.onload = null
      img.onerror = null
    },
    release() {
      finish(true)
    },
  }
}

/** Assainit un nom de fichier ou de base de nom (sans extension). */
function baseNameOf(name) {
  return (
    String(name || 'avatar')
      .replace(/\.[^./\\]+$/, '')
      .replace(/[^\p{L}\p{N}\-_ ]/gu, '')
      .trim()
      .slice(0, 40) || 'avatar'
  )
}

/** Assainit un nom de fichier complet (extension conservée). */
function safeFileName(name) {
  return String(name || 'avatar').replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim().slice(0, 60) || 'avatar.jpg'
}

/** Calcul du nom du fichier résultant du recadrage ("…-ajuste.jpg"). */
export function croppedFileName(name) {
  return `${baseNameOf(name)}-ajuste.jpg`
}

/**
 * Recadre le fichier source (File/Blob) sur la zone carrée décrite par
 * `rect` — exprimée en pixels SOURCE de l'image (calculée par
 * AvatarCropModal à partir de l'aperçu strictement identique au rendu).
 *
 *  - rect manquant, ou déjà égal à l'image entière -> le fichier d'origine
 *    est renvoyé tel quel (aucun ré-encodage, aucune perte) ;
 *  - sinon le canvas sort un JPEG carré 1000×1000 px (qualité 0.92) :
 *    dimension ample pour un avatar, poids raisonnable (~100-400 Ko).
 *
 *  `signal` (AbortSignal optionnel) : annule le recadrage en cours —
 *  l'erreur est ré-élevée (le parent affiche son erreur, la URL
 *  temporaire est libérée par le `finally`).
 *
 * @returns {Promise<File|null>} nouveau File "…-ajuste.jpg", le fichier
 *   d'origine s'il n'y a rien à recadrer, ou null si source nulle.
 */
export async function cropAvatarImage(file, rect, signal) {
  const aborted = () => {
    if (signal && signal.aborted) throw new DOMException('Recadrage annulé.', 'AbortError')
  }
  if (!file) return null
  // URL temporaire, révoquée à la fin du décodage ET du rendu de l'<img>
  // (pas un seul frame avant : pas de « Failed to load resource »).
  // Si la fonction est annulée (fermeture de la fenêtre pendant le
  // recadrage), la révocation passe par le même canal de libération :
  // ni fuite, ni double-révocation.
  const sourceUrl = URL.createObjectURL(file)
  let releaseSource = null
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image()
      const handle = onImageRendered(img, sourceUrl, (ok) => {
        if (ok) resolve(img)
        else reject(new Error('Échec du chargement de l’image à recadrer.'))
      })
      releaseSource = () => handle.release()
      img.src = sourceUrl
    })
    aborted() // fenêtre fermée pendant le chargement : on s'arrête là
    const W = image.naturalWidth
    const H = image.naturalHeight

    // Bornes défensives : le rect est toujours borné à l'image réelle.
    const sx = Math.min(Math.max(0, Math.round(Number(rect && rect.x) || 0)), W - 1)
    const sy = Math.min(Math.max(0, Math.round(Number(rect && rect.y) || 0)), H - 1)
    const sw = Math.min(Math.max(1, Math.round(Number(rect && rect.width) || W)), W - sx)
    const sh = Math.min(Math.max(1, Math.round(Number(rect && rect.height) || H)), H - sy)

    // Zone == image entière (zoom 1, centré) : on renvoie le fichier d'origine.
    if (sx === 0 && sy === 0 && sw >= W - 1 && sh >= H - 1) return file

    const canvas = document.createElement('canvas')
    canvas.width = 1000
    canvas.height = 1000
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    // Le rect est un carré (fenêtre d'aperçu carrée) : l'image est dessinée
    // en entier dans la zone (pas de distorsion car sw/sh ont le même ratio
    // que la zone d'encadrement, qui elle-même est carrée).
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, 1000, 1000)
    aborted()

    const blob = await new Promise((resolve, reject) => {
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Échec de l’encodage JPEG du recadrage.'))),
          'image/jpeg',
          0.92
        )
      } else {
        reject(new Error('Canvas non supporté par ce navigateur.'))
      }
    })

    return new File([blob], croppedFileName(file.name), { type: 'image/jpeg' })
  } finally {
    // Libère l'URL quand l'<img> a rendu (succès) — ou immédiatement si
    // la chaîne Promise a déjà échoué (l'onerror a déjà déclenché la
    // libération). `release` est idempotent : aucun risque de double
    // URL.revokeObjectURL.
    if (releaseSource) releaseSource()
  }
}

/**
 * Transforme une image déjà servie (URL HTTP : avatar déjà enregistré) en
 * fichier JPEG recadré sur la même zone que `cropAvatarImage`.
 *
 * Le navigateur a déjà mis en cache l'<img> affiché : `fetch(url,
 * { cache: 'force-cache' })` le réutilise sans réseau supplémentaire.
 */
async function toCroppedFile(url, name, rect, signal) {
  const res = await fetch(url, { cache: 'force-cache', signal })
  if (!res.ok) throw new Error('Image courante indisponible : impossible de la recadrer.')
  const blob = await res.blob()
  return cropAvatarImage(new File([blob], safeFileName(name), { type: blob.type || 'image/jpeg' }), rect, signal)
}

/**
 * AvatarCropModal — ajustement manuel d'un avatar AVANT validation :
 *
 *  - glisser (souris ou tactile) pour déplacer l'image dans la fenêtre ;
 *  - molette (ancrée au pointeur) ou boutons −/+ pour zoomer (100 % à 600 %) ;
 *  - « Réinitialiser » revient au cadrage d'origine (cover centré, x100) ;
 *  - « Valider le cadrage » génère l'image recadrée (cropAvatarImage) et
 *    l'envoie au parent via onAdjust(file) ;
 *  - « Annuler », Échap ou clic sur le voile : fermeture sans aucun effet.
 *
 * La fenêtre carrée est un aperçu strictement fidèle : la zone visible est
 * exactement celle qui sera uploadée une fois « Enregistrer » validé.
 *
 * Deux cas de source :
 *  - `file` (nouveau fichier choisi) : recadrage direct du File ;
 *  - `existingUrl` (avatar DÉJÀ enregistré, pas de File en main) : la zone
 *    visible est re-récupérée par fetch (image déjà dans le cache du
 *    navigateur) puis recadrée en JPEG du même calibre.
 *
 * @param {object}   props
 * @param {File}     [props.file]  fichier source à recadrer (File/Blob)
 * @param {string}   [props.existingUrl] URL http de l'avatar déjà enregistré
 * @param {string}   [props.existingName] nom du fichier affiché (…jpg, …png)
 * @param {string}   props.url    URL d'aperçu (object URL du File, ou existingUrl)
 * @param {string}   [props.label]  titre de la fenêtre
 * @param {function} props.onClose  fermeture sans valider
 * @param {function} props.onAdjust (file) -> le parent reçoit le fichier recadré
 * @param {boolean}  [props.disabled]
 */
export function AvatarCropModal({ file, url, existingUrl = null, existingName = '', label = "Ajuster l'image", onClose, onAdjust, disabled }) {
  const frameRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [ready, setReady] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [imageError, setImageError] = useState('')
  const [frameSize, setFrameSize] = useState(0)
  // Contrôle d'annulation du recadrage en cours : fermeture de la
  // fenêtre pendant « Valider le cadrage » -> abort (pas d'échec
  // fantôme affiché, URL temporaire libérée par cropAvatarImage).
  const abortRef = useRef(null)

  // Démontage pendant un recadrage en cours : on annule (l'erreur est
  // ignorée par le composant disparu, l'URL est libérée).
  useEffect(
    () => () => {
      if (abortRef.current) {
        abortRef.current.abort()
        abortRef.current = null
      }
    },
    []
  )

  // Dimensions de l'image source (déclarées avant tout effet : la première
  // mesure passe par le state, jamais avant son initialisation).
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 })

  // Image de l'aperçu : dimensions + erreur explicite (URL révoquée,
  // objet libéré…) plutôt qu'un carré vide sans explication.
  // L'état « prêt » n'est posé qu'APRÈS le rendu de l'img (couple
  // decode + 2 frames) : l'object URL dédiée peut alors être révoquée
  // par le parent sans casser la frame affichée. À la fermeture, on
  // abandonne les callbacks en attente (composant démonté, URL déjà
  // gérée par le parent).
  useEffect(() => {
    let cancelled = false
    setReady(false)
    setImageError('')
    if (!url) return
    const img = new Image()
    const handle = onImageRendered(img, url, (ok) => {
      if (cancelled) return
      if (ok) {
        setImageSize({ w: img.naturalWidth, h: img.naturalHeight })
        setReady(true)
      } else {
        setImageError("Impossible de charger l'image à ajuster. Annulez et choisissez un autre fichier.")
      }
    })
    img.src = url
    return () => {
      cancelled = true
      handle.cancel()
    }
  }, [url])

  // Taille carrée réelle du cadre (cadre en aspect-ratio 1/1).
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      const size = Math.round(Math.min(r.width, r.height))
      setFrameSize((prev) => (prev === size ? prev : size))
    }
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (ro) ro.observe(el)
    return () => ro && ro.disconnect()
  }, [true])

  const geom = useMemo(() => {
    if (!ready || !frameSize || !imageSize.w || !imageSize.h) return null
    // Cadrage « cover » de base : la plus petite dimension remplit le cadre.
    const baseScale = frameSize / Math.min(imageSize.w, imageSize.h)
    return {
      baseScale,
      dispW: imageSize.w * baseScale, // au zoom courant : * zoom
      dispH: imageSize.h * baseScale,
    }
  }, [ready, frameSize, imageSize])

  const loaded = ready && !imageError && Boolean(geom)

  // Empêche de montrer du « vide » : l'image recouvre toujours le cadre.
  const clampOffset = (z, o) => {
    if (!geom) return { x: 0, y: 0 }
    const dx = Math.max(0, (geom.dispW * z - frameSize) / 2)
    const dy = Math.max(0, (geom.dispH * z - frameSize) / 2)
    return {
      x: Math.max(-dx, Math.min(dx, o.x)),
      y: Math.max(-dy, Math.min(dy, o.y)),
    }
  }

  /**
   * Zoom multiplicatif, le point `anchor` (coordonnées du cadre, défaut :
   * centre) restant stable pendant l'opération — comme au doigt sur une
   * photo. Formule issue de l'invariance du pixel source sous l'ancre.
   */
  const applyZoom = (delta, anchor) => {
    if (!loaded) return
    const z = Math.min(6, Math.max(1, zoom * (1 + delta)))
    if (z === zoom) return
    const r = z / zoom
    const ax = anchor && Number.isFinite(anchor.x) ? anchor.x : frameSize / 2
    const ay = anchor && Number.isFinite(anchor.y) ? anchor.y : frameSize / 2
    const oldImgLeft = (frameSize - geom.dispW * zoom) / 2 + offset.x
    const oldImgTop = (frameSize - geom.dispH * zoom) / 2 + offset.y
    const newOffset = {
      x: ax - (frameSize - geom.dispW * z) / 2 - r * (ax - oldImgLeft),
      y: ay - (frameSize - geom.dispH * z) / 2 - r * (ay - oldImgTop),
    }
    setOffset(clampOffset(z, newOffset))
    setZoom(z)
  }

  // Molette sur le cadre : zoom ancré au pointeur (listener natif
  // non-passif, nécessaire pour preventDefault de la navigation de page).
  useEffect(() => {
    const el = frameRef.current
    if (!el || !loaded) return
    const onWheel = (e) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      applyZoom(
        e.deltaY < 0 ? 0.12 : -0.12,
        { x: e.clientX - r.left, y: e.clientY - r.top }
      )
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, zoom, offset, geom, frameSize, disabled])

  // Échap = annuler.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !disabled && !confirming) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, disabled, confirming])

  // Glisser pour déplacer l'image (Pointer Events : souris + tactile).
  const onPointerDown = (e) => {
    if (!loaded || disabled || confirming) return
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const base = { ...offset }
    let moved = false
    setDragging(true)
    const onMove = (ev) => {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.hypot(dx, dy) < 3) return
      moved = true
      setOffset(clampOffset(zoom, { x: base.x + dx, y: base.y + dy }))
    }
    const finish = (ev) => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
      setDragging(false)
      try {
        target.releasePointerCapture(ev.pointerId)
      } catch {
        /* pointeur déjà relâché */
      }
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
  }

  // Zone carrée VISIBLE, en pixels source — exactement ce qui sera
  // uploadé par « Valider le cadrage ».
  const sourceRect = useMemo(() => {
    if (!geom) return null
    const s = geom.baseScale * zoom
    const dx = (geom.dispW * zoom - frameSize) / 2
    const dy = (geom.dispH * zoom - frameSize) / 2
    return {
      x: (dx - offset.x) / s,
      y: (dy - offset.y) / s,
      width: frameSize / s,
      height: frameSize / s,
    }
  }, [geom, zoom, offset, frameSize])

  // Valider : recadrage réel de la source sur la zone visible.
  // La fermeture (onClose) se transmet DANS onAdjust : le parent la
  // traite immédiatement (état définitif posé par onAdjust) sans
  // re-entrer dans valider().
  const confirm = async () => {
    if (!loaded || disabled || confirming || !sourceRect) return
    const controller = new AbortController()
    abortRef.current = controller
    setConfirming(true)
    try {
      const cropped = existingUrl
        ? await toCroppedFile(existingUrl, existingName, sourceRect, controller.signal)
        : await cropAvatarImage(file, sourceRect, controller.signal)
      if (abortRef.current !== controller) return // fenêtre fermée pendant le recadrage
      onClose(() => onAdjust(cropped))
    } catch (err) {
      if (err && err.name === 'AbortError') return // annulé : pas d'erreur à afficher
      setImageError(err.message || 'Échec du recadrage de l’image.')
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setConfirming(false)
      }
    }
  }

  const reset = () => {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  // Position/taille de l'<img> dans le cadre (géométrie exacte, en px).
  const imgStyle = geom
    ? {
        position: 'absolute',
        left: (frameSize - geom.dispW * zoom) / 2 + offset.x,
        top: (frameSize - geom.dispH * zoom) / 2 + offset.y,
        width: geom.dispW * zoom,
        height: geom.dispH * zoom,
      }
    : null

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-night-950/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onClick={onClose}
    >
      <div className="card w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h2 className="font-bold text-white text-lg">{label}</h2>

        {imageError ? (
          <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
            {imageError}
          </p>
        ) : (
          <>
            {/* Fenêtre carrée : aperçu strictement identique au rendu final. */}
            <div
              ref={frameRef}
              onPointerDown={loaded ? onPointerDown : undefined}
              onDragStart={(e) => e.preventDefault()}
              style={{
                width: 'min(100%, 320px)',
                aspectRatio: '1 / 1',
                cursor: dragging ? 'grabbing' : 'grab',
                touchAction: 'none',
              }}
              className="relative mx-auto overflow-hidden rounded-full border-2 border-gold-500/40 bg-night-700 select-none"
            >
              {imgStyle && (
                <img
                  src={url}
                  alt=""
                  draggable={false}
                  className="pointer-events-none max-w-none"
                  style={imgStyle}
                />
              )}
              {!ready && (
                <div className="absolute inset-0 grid place-items-center text-xs text-slate-500">
                  Chargement…
                </div>
              )}
            </div>

            <p className="text-[11px] text-slate-500 text-center">
              Glissez pour déplacer l'image · molette ou boutons pour zoomer
            </p>

            <div className="flex items-center justify-center gap-2">
              <button
                type="button"
                className="btn-ghost !py-1 !px-3"
                onClick={() => applyZoom(-0.25)}
                disabled={!loaded || disabled || confirming || zoom <= 1}
                title="Zoom arrière"
              >
                −
              </button>
              <button
                type="button"
                className="btn-ghost !py-1 !px-3"
                onClick={() => applyZoom(0.25)}
                disabled={!loaded || disabled || confirming || zoom >= 6}
                title="Zoom avant"
              >
                +
              </button>
              <button
                type="button"
                className="btn-ghost !py-1 !px-3"
                onClick={reset}
                disabled={!loaded || disabled || confirming || (zoom === 1 && offset.x === 0 && offset.y === 0)}
              >
                Réinitialiser
              </button>
              <span className="text-xs text-slate-500">zoom {Math.round(zoom * 100)} %</span>
            </div>
          </>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={disabled || confirming}>
            Annuler
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={confirm}
            disabled={!loaded || disabled || confirming || !sourceRect}
          >
            {confirming ? 'Recadrage…' : 'Valider le cadrage'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * Avatar d'utilisateur : image de profil si présente (chemin local
 * "/uploads/avatars/..." résolu en URL absolue, ou URL distante), sinon
 * initiales sur fond neutre.
 *
 * Si l'image échoue à charger (404, fichier manquant…), on retombe
 * automatiquement sur les initiales plutôt que sur un cercle vide.
 *
 * @param {object}  user   { firstName, lastName, avatarUrl }
 * @param {number}  size   largeur/hauteur en pixels (défaut 40)
 * @param {function} onImageError (optionnel) rappelé quand l'image échoue
 */
export default function Avatar({ user, size = 40, onImageError }) {
  const url = useMemo(() => {
    const raw = (user && (user.avatarUrl || user.avatar)) || ''
    return toAbsoluteUrl(raw)
  }, [user])

  // imageErr=true : échec de chargement de `url` -> afficher les initiales.
  // Réinitialisé à chaque changement d'URL pour réessayer.
  const [imageErr, setImageErr] = useState(false)
  useEffect(() => {
    setImageErr(false)
  }, [url])

  // Échec de chargement (404, fichier supprimé, revoke…) -> initiales.
  const onError = () => {
    setImageErr(true)
    if (typeof onImageError === 'function') onImageError()
  }

  const initials = useMemo(() => {
    if (!user) return '•'
    const first = (user.firstName || '').trim().charAt(0)
    const last = (user.lastName || '').trim().charAt(0)
    return `${first}${last}`.toUpperCase() || '•'
  }, [user])

  const displayName = user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : ''
  const showImage = Boolean(url) && !imageErr

  return (
    <span
      className="relative inline-grid place-items-center overflow-hidden rounded-full bg-night-700 border border-night-500 shrink-0 select-none"
      style={{ width: size, height: size, boxSizing: 'border-box' }}
      title={displayName || undefined}
    >
      {showImage ? (
        <img
          key={url}
          src={url}
          alt={displayName || 'Avatar'}
          loading="lazy"
          className="inline-block align-middle max-w-full max-h-full object-cover object-center rounded-full"
          style={{ maxWidth: '100%', maxHeight: '100%', boxSizing: 'border-box' }}
          onError={onError}
        />
      ) : (
        <span className="font-bold text-gold-300 leading-none" style={{ fontSize: Math.round(size * 0.34) }}>
          {initials}
        </span>
      )}
    </span>
  )
}
