/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../services/api.js'
import BarcodeModal from '../components/BarcodeModal.jsx'
import { CheckIcon } from '../components/icons.jsx'
import { useDismiss } from '../components/hooks.js'
import { toDisplayImageUrl } from '../services/imageUrl.js'
import { COLOR_NA, sortedDiscColors, toColorList, colorDot, colorLabel } from '../services/discColors.jsx'

// « DATE D'AJOUT » du jour (temps local), format AAAA-MM-JJ strict :
// valeur par défaut du champ lors de la création d'un nouveau disque.
function todayIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const EMPTY = {
  artist: '',
  title: '',
  trackCount: 1,
  tracklist: '',
  genre: '',
  label: '',
  releaseDate: '',
  barcode: '',
  mbid: '',
  discogsReleaseId: '',
  discogsUrl: '',
  // Fiche Last.fm d'album — provenance PRIORITAIRE de la cascade d'import
  // (jaquette + métadonnées issues de album.getInfo) : URL persistée avec le
  // disque (backend `lastfm_url`), remplie par le scan / la recherche.
  lastfmUrl: '',
  acquiredDate: todayIso(),
  notes: '',
  // Options du disque (rangée horizontale) : type de disque, nombre de
  // disques, picture disc et couleur de la galette. Ordre de la ligne, de
  // gauche à droite : Type de Disque → Nombre de Disques → Picture Disc → Couleur.
  discType: 'Vinyle', // valeur de l'option par défaut du select « Type de Disque » (voir option conservée dans le menu, exception)
  discsCount: 1,      // select entiers 1 → 5 — valeur par défaut 1
  pictureDisc: false, // case à cocher « Picture Disc » — défaut non coché
  color: [],          // MULTI-SELECT des couleurs de galettes (pastilles + libellés) — défaut : aucune couleur (« N/A »)
}

/* Entiers du select « Nombre de Disques » (1 à 5, défaut 1). */
const DISCS_COUNT_MAX = 5
const DISCS_COUNT_OPTIONS = Array.from({ length: DISCS_COUNT_MAX }, (_, i) => i + 1)

/**
 * Applique une valeur « nombre de chansons » reçue de l'import
 * (nombre ou chaîne) à l'état du formulaire.
 * Contrairement à `value || fallback`, un 0 légitime (fiche sans
 * tracklist côté API) n'est PAS remplacé par le défaut (1) ; seule une
 * valeur absente/invalide retombe sur `fallback`.
 * @param {number|string|null|undefined} value valeur importée
 * @param {number} fallback valeur actuelle du formulaire
 * @returns {number}
 */
const applyPrefillTrackCount = (value, fallback) => {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * « Nombre de Disques » (entier 1 → 5 du select, renvoyé par le backend en
 * string ou number) : aucune valeur absente / invalide ne sort hors plage.
 * Les valeurs existantes hors plage sont resserrées aux bornes — la colonne
 * porte CHECK (discs_count BETWEEN 1 AND 5).
 */
const toDiscsCount = (value, fallback = 1) => {
  if (value === null || value === undefined || value === '') return fallback
  const n = parseInt(String(value), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(DISCS_COUNT_MAX, Math.max(1, n))
}

/* DISSOCIATION ARTISTE ↔ JAQUETTE — garde stricte du formulaire : une valeur
   « image d'artiste » EST INTERDITE de contenir la jaquette d'ALBUM (celle en
   base ou celle soumise). Une telle valeur est JAMAIS proposée/conservée à
   deux endroits :
    - elle ne pré-remplit JAMAIS l'aperçu du champ « Image de l'artiste »
      (au chargement, ni après un enregistrement) ;
    - elle n'est jamais transmise au backend : le champ reste VIDE et le
      backend ne peut ni la conserver, ni la réexposer.
   Sans image dédiée conservable (chargement, suppression…) : l'image de
   secours locale img/no_group.jpg — exactement le visuel des tuiles « Mes
   Disques » — JAMAIS la jaquette d'album. */
const IMG_NO_GROUP = '/img/no_group.jpg'

/* Clé de comparaison entre deux adresses d'images désignant la MÊME ressource :
   retire le protocole + origine (un chemin stocké sans origine et une URL
   absolue du site doivent être considérés identiques). Vide si aucune valeur. */
function imgKey(value) {
  const s = String(value || '').trim()
  if (!s) return ''
  return s.replace(/^https?:\/\/[^/]+/i, '')
}

/* Indique si une valeur « image d'artiste » est EN FAIT la jaquette (celle en
   base ou celle soumise) — cf. bandeau ci-dessus. */
function sameAsCover(artistImg, cover) {
  const a = imgKey(artistImg)
  if (!a) return false
  const b = imgKey(cover)
  return Boolean(b) && a === b
}

/* Image d'ARTISTE CONSERVABLE pour l'aperçu du champ : jamais la jaquette
   d'album (état legacy contaminé / doublon), jamais l'emblème par défaut. */
function conservableArtistImage(artistImg, cover) {
  const raw = String(artistImg || '').trim()
  if (!raw || imgKey(raw) === IMG_NO_GROUP || sameAsCover(raw, cover)) return ''
  return raw
}

export default function AddVinyl() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  // Vue d'ORIGINE capturée à l'ouverture du formulaire : émise par la page
  // source via location.state.from ({ path, view }) — destination du retour
  // après ENREGISTREMENT et ANNULATION. null si ouvert directement (URL/reload).
  const [origin] = useState(() => location.state?.from || null)
  const { t } = useTranslation()

  const [form, setForm] = useState(EMPTY)
  const [file, setFile] = useState(null)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [existingCover, setExistingCover] = useState('')
  // IMAGE D'ARTISTE (photo / logo — entité Artiste) : uniquement utilisée dans
  // la grille « Mes Disques » (tuile du groupe artiste). À défaut de fichier ou
  // d'URL fournis ICI, le backend récupère automatiquement l'image à la création
  // (MusicBrainz -> Cover Art Archive), repli propre img/no_group.jpg.
  const [artistFile, setArtistFile] = useState(null)
  const [existingArtistImage, setExistingArtistImage] = useState('')
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  /* Menu déroulant « Couleur » custom (pastille ronde de la teinte à côté du
     libellé, cercle barré pour « N/A ») : ouvert/fermé au clic sur le bouton,
     fermé au clic à l'extérieur ou sur Échap (useDismiss). */
  const [colorMenuOpen, setColorMenuOpen] = useState(false)
  const colorMenuRef = useDismiss(colorMenuOpen, () => setColorMenuOpen(false))
  const fileInput = useRef(null)
  // Référence à l'« <input type="file"> » de l'image d'ARTISTE : indispensable
  // pour réinitialiser le contrôle DOM au clic sur « Retirer le fichier » (une
  // nouvelle sélection du même nom doit de nouveau déclencher onChange).
  const artistFileInput = useRef(null)
  // SUPPRESSION EXPLICITE (« Retirer le fichier ») : true uniquement quand
  // l'utilisateur a retiré l'image COURANTE en base (jaquette vinyls.cover_url
  // / image d'artiste vinyls.artist_image). Le payload enverra alors
  // `remove_cover` / `remove_artist_image` = "true" et le backend ÉCRASERA la
  // colonne par NULL — jamais un repli sur une autre image.
  const [removeCover, setRemoveCover] = useState(false)
  const [removeArtistImage, setRemoveArtistImage] = useState(false)

  // Chargement en mode édition
  useEffect(() => {
    if (!isEdit) return
    const vinylId = id
    let cancelled = false
    api.vinyls
      .get(vinylId)
      .then((data) => {
        if (cancelled) return
        const v = data.vinyl
        setForm({
          artist: v.artist || '',
          title: v.title || '',
          trackCount: v.trackCount || 0,
          tracklist: v.tracklist || '',
          genre: v.genre || '',
          label: v.label || '',
          releaseDate: v.releaseDate ? String(v.releaseDate).slice(0, 10) : '',
          barcode: v.barcode || '',
          mbid: v.mbid || '',
          discogsReleaseId: v.discogsReleaseId ? String(v.discogsReleaseId) : '',
          discogsUrl: v.discogsUrl || '',
          lastfmUrl: v.lastfmUrl || '',
          acquiredDate: v.addedDate ? String(v.addedDate).slice(0, 10) : todayIso(),
          notes: v.notes || '',
          // Options du disque : type (défaut « Disque »), entiers
          // resserrés dans la plage du select (1 → 5) + case « Picture Disc »
          // + couleur par défaut « Noir ».
          discType: 'Vinyle',
          discsCount: toDiscsCount(v.discsCount),
          pictureDisc: Boolean(v.isPictureDisc),
          // Couleurs (multi-select) : tableau normalisé depuis la colonne
          // color (TEXT, valeurs séparées par des virgules ; « N/A » = pas de
          // couleur — représenté dans le formulaire par une liste VIDE, donc
          // retiré du tableau pour que l'option « N/A » soit cochée).
          color: toColorList(v.color).filter((c) => c !== COLOR_NA),
        })
        setExistingCover(v.coverUrl || '')
        // Image d'ARTISTE courante (aperçu du champ « Image de l'artiste »).
        // DISSOCIATION ARTISTE/JAQUETTE : jamais la jaquette d'ALBUM (coverUrl)
        // ne pré-remplit le champ artiste — si l'API renvoyait malgré tout une
        // valeur identique à la jaquette (état legacy contaminé), elle est
        // IGNOREE et le champ reste vide (aperçu = placeholder). Jamais de
        // fallback automatique sur la couverture d'album dans cet aperçu.
        // Repli par défaut du backend (img/no_group.jpg, colonne NULL ou valeur
        // portant l'emblème) : jamais proposé à la place — son remplacement reste
        // gratuit (le fichier par défaut n'existe pas dans ./uploads). Valeur
        // initiale = '' -> l'aperçu affiche l'image de secours locale
        // img/no_group.jpg (exactement le visuel de la tuile « Mes Disques »),
        // JAMAIS la jaquette d'album.
        setExistingArtistImage(conservableArtistImage(v.artistImage, v.coverUrl))
        // Rechargement = nouvelle session de formulaire : les drapeaux de
        // suppression explicite sont remis à false.
        setRemoveCover(false)
        setRemoveArtistImage(false)
      })
      .catch((err) => {
        if (!cancelled) {
          if (/introuvable|404/.test(err.message)) setNotFound(true)
          else setError(err.message)
        }
      })
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [id, isEdit])

  // Pré-remplissage depuis le code-barres (?prefill=1&artist=…&…)
  useEffect(() => {
    if (!params.get('prefill')) return
    const fill = (key, cast) => {
      const raw = params.get(key)
      return raw !== null ? cast ? cast(raw) : raw : ''
    }
    setForm((f) => ({
      ...f,
      artist: fill('artist') || f.artist,
      title: fill('title') || f.title,
      trackCount: applyPrefillTrackCount(params.get('trackCount'), f.trackCount),
      tracklist: fill('tracklist') || f.tracklist,
      genre: fill('genre') || f.genre,
      label: fill('label') || f.label,
      releaseDate: fill('releaseDate') || f.releaseDate,
      barcode: fill('barcode') || f.barcode,
      mbid: fill('mbid') || f.mbid,
      // Identifiants Discogs (recherche par code-barres, complément MusicBrainz)
      discogsReleaseId: fill('discogsReleaseId') || f.discogsReleaseId,
      discogsUrl: fill('discogsUrl') || f.discogsUrl,
      // Fiche Last.fm d'album — provenance PRIORITAIRE de la cascade d'import.
      lastfmUrl: fill('lastfmUrl') || f.lastfmUrl,
      // « Date d'ajout » : jamais pré-remplie par un import ; on conserve la
      // valeur courante (date du jour à l'ouverture du formulaire).
    }))
    const cover = params.get('coverRemoteUrl')
    if (cover) setRemoteUrl(cover)
    navigate('/vinyles/nouveau', { replace: true })
  }, [params, navigate])

  const preview = useMemo(() => {
    if (file) return URL.createObjectURL(file)
    // Suppression explicite armée : l'aperçu retombe IMMÉDIATEMENT sur le
    // placeholder « Aucune jaquette » — jamais de repli sur une URL ou la
    // valeur en base.
    if (!removeCover && remoteUrl && !/^\//.test(remoteUrl)) {
      // aperçu d'une URL DISTANTE (Discogs / Open Library / Last.fm…) : routée
      // via le proxy d'image du backend (MÊME ORIGINE) — jamais l'URL tierce en
      // direct, qui serait bloquée en Mixed Content (http:// sur un site https://)
      // ou par les restrictions CORS / hotlinking des CDN.
      return toDisplayImageUrl(remoteUrl)
    }
    if (isEdit && !removeCover) return toDisplayImageUrl(existingCover)
    return null
  }, [file, remoteUrl, existingCover, removeCover, isEdit])

  // Aperçu de l'image d'ARTISTE : nouveau fichier choisi > image courante du
  // disque (mode édition). En création l'aperçu reste vide tant qu'aucun
  // fichier n'est choisi — le backend récupérera automatiquement une photo.
  // Suppression explicite armée (« Retirer le fichier ») : l'emblème par
  // défaut img/no_group.jpg s'affiche IMMÉDIATEMENT (exactement le visuel de
  // la tuile « Mes Disques » dès que l'image est retirée) — jamais de repli
  // sur une URL ou la valeur en base.
  // DISSOCIATION ARTISTE/JAQUETTE — dernière ligne de défense côté affichage :
  // si la valeur courante était en réalité la jaquette d'ALBUM (état legacy
  // contaminé), elle n'est JAMAIS affichée ici : l'emblème par défaut
  // s'affiche à la place. Le champ ne montre que l'image DÉDIÉE stockée en
  // base, jamais la couverture du disque.
  const artistPreview = useMemo(() => {
    if (artistFile) return URL.createObjectURL(artistFile)
    // Image de secours locale : suppression explicite armée OU aucune image
    // dédiée conservable en base -> img/no_group.jpg (le même visuel que sur
    // les tuiles « Mes Disques » — jamais la jaquette d'album).
    const raw = isEdit && !removeArtistImage ? conservableArtistImage(existingArtistImage, existingCover) : ''
    if (raw) return toDisplayImageUrl(raw)
    return IMG_NO_GROUP
  }, [artistFile, isEdit, existingArtistImage, removeArtistImage, existingCover])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  // MULTI-SELECT « Couleurs » : TOGGLE d'une couleur dans la liste du
  // formulaire (ajout si absente, retrait si présente). Le menu reste ouvert
  // pour cumuler les choix ; « N/A » (vide) est exclusif — voir le panneau.
  const toggleColor = (value) => {
    setForm((f) => {
      const list = Array.isArray(f.color) ? f.color : toColorList(f.color, [])
      return {
        ...f,
        color: list.includes(value) ? list.filter((c) => c !== value) : [...list, value],
      }
    })
  }

  // ----------------------------------------------------------
  // SUPPRESSION EXPLICITE d'une image (« Retirer le fichier ») :
  //  - field === 'cover'       -> jaquette d'album (couverture du disque) ;
  //  - field === 'artistImage' -> photo / logo de l'ARTISTE.
  // Comportement strictement symétrique pour les deux :
  //  1. état du fichier éventuellement choisi remis à null + input DOM
  //     RÉ-INITIALISÉ (value = '') — une nouvelle sélection du même fichier
  //     re-déclenche alors onChange ;
  //  2. l'aperçu bascule IMMÉDIATEMENT sur le placeholder de la section ;
  //  3. un DRAPEAU DE SUPPRESSION EXPLICITE est armé pour le submit : le
  //     backend ÉCRASE la colonne par NULL (remove_cover /
  //     remove_artist_image = "true" dans le FormData ou le JSON) au lieu de
  //     « conserver » la valeur d'avant via URL distante.
  const handleRemoveImage = (field) => {
    if (field === 'cover') {
      // Fichier fraîchement choisi (pas encore enregistré) : retiré de l'état
      // + input DOM ré-initialisé ; URL distante saisie : vidée (sinon
      // l'aperçu y retomberait).
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      setRemoteUrl('')
      // Jaquette COURANTE en base : suppression explicite -> aperçu « Aucune
      // jaquette » + colonne cover_url -> NULL au submit (remove_cover=true).
      if (isEdit && existingCover) {
        setExistingCover('')
        setRemoveCover(true)
      }
    } else if (field === 'artistImage') {
      // Fichier fraîchement choisi : retiré de l'état + input DOM ré-initialisé.
      setArtistFile(null)
      if (artistFileInput.current) artistFileInput.current.value = ''
      // Image d'artiste COURANTE en base : suppression explicite -> l'emblème
      // par défaut img/no_group.jpg s'affiche INSTANTANÉMENT dans l'aperçu et
      // la colonne artist_image est ÉCRASÉE par NULL au submit (drapeau
      // remove_artist_image=true — le backend ne conserve ni l'ancienne photo,
      // ni la jaquette d'album) ; tuiles « Mes Disques » sur img/no_group.jpg.
      setExistingArtistImage('')
      setRemoveArtistImage(true)
    }
  }

  // Nettoyage des champs numériques AVANT tout envoi : une valeur vide,
  // "NaN" ou invalide devient 0 (track count) — jamais la chaîne "NaN",
  // qui provoquait côté PostgreSQL
  // « invalid input syntax for type integer: "NaN" ».
  const toTrackCount = (value) => {
    if (value === null || value === undefined || value === '') return 0
    const n = parseInt(String(value).trim(), 10)
    return Number.isFinite(n) ? Math.max(0, n) : 0
  }

  // « Date d'ajout » : extrait le AAAA-MM-JJ strict (le input type="date" renvoie
  // déjà ce format ; on tolère aussi une date ISO complète). null si absente /
  // invalide -> le backend prend alors CURRENT_DATE pour la création et conserve
  // la date existante en édition.
  const toAcquiredDate = (value) => {
    const m = String(value || '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
    if (!m) return null
    const pad = (n) => String(n).padStart(2, '0')
    return `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.artist.trim() || !form.title.trim()) {
      setError(t('vinylForm.errorRequired'))
      return
    }
    const trackCount = toTrackCount(form.trackCount)
    const acquiredDate = toAcquiredDate(form.acquiredDate)
    // Options du disque : valeurs finales normalisées pour les deux payloads.
    const discType = String(form.discType || '').trim() || 'Vinyle'
    const isPictureDisc = Boolean(form.pictureDisc)
    const discsCount = toDiscsCount(form.discsCount, 1)
    // Couleurs (multi-select) : tableau normalisé (valeurs uniques, ordre de
    // sélection conservé). Liste vide = « N/A » (pas de couleur) — valeur
    // explicite COLOR_NA stockée telle quelle en base. Sérialisé en chaîne
    // séparée par des virgules pour la colonne vinyls.color (TEXT).
    const discColors = Array.isArray(form.color) ? form.color : toColorList(form.color, [])
    const discColor = discColors.length ? discColors.join(', ') : COLOR_NA
    setSaving(true)
    try {
      let result
      // DEUX fichiers possibles : jaquette d'album (champ « cover ») + photo /
      // logo d'ARTISTE (champ « artistImage ») — upload.fields() côté backend.
      // Dès qu'UN des deux est un fichier, le payload devient multipart.
      if (file || artistFile) {
        const fd = new FormData()
        if (removeCover) {
          // SUPPRESSION EXPLICITE de la jaquette (bouton « Retirer le fichier ») :
          // drapeau de purge — le backend ÉCRASE cover_url par NULL ; aucun
          // chemin n'est resubmis (sinon resolveCover aurait conservé
          // l'ancienne jaquette).
          fd.append('remove_cover', 'true')
        } else if (file) {
          fd.append('cover', file)
        } else if (isEdit && existingCover) {
          // Pas de nouvelle jaquette mais image d'artiste en fichier : la
          // jaquette courante est reprise via coverRemoteUrl (chemin local
          // connu — resolveCover le détecte et conserve la jaquette actuelle).
          fd.append('coverRemoteUrl', existingCover)
        }
        if (removeArtistImage) {
          // SUPPRESSION EXPLICITE de l'image d'ARTISTE (bouton « Retirer le
          // fichier ») : drapeau de purge — le backend ÉCRASE artist_image par
          // NULL au lieu de conserver / cascade-rechercher l'image courante.
          fd.append('remove_artist_image', 'true')
        } else if (artistFile) {
          // Image d'ARTISTE téléversée : associée à l'entité Artiste.
          fd.append('artistImage', artistFile)
        }
        Object.entries({
          artist: form.artist,
          title: form.title,
          track_count: String(trackCount),
          tracklist: form.tracklist || '',
          genre: form.genre || '',
          label: form.label || '',
          release_date: form.releaseDate || '',
          barcode: form.barcode || '',
          mbid: form.mbid || '',
          discogs_release_id: form.discogsReleaseId || '',
          discogs_url: form.discogsUrl || '',
          lastfm_url: form.lastfmUrl || '',
          // '' (jamais null/NaN) : FormData convertirait null en "null"
          acquired_date: acquiredDate === null ? '' : acquiredDate,
          notes: form.notes || '',
          // Type de disque (« Vinyle » / « Compact », défaut « Vinyle »)
          // + picture disc boolean (« true » / « false » ; le backend
          // accepte aussi '1'/'0').
          disc_type: discType,
          is_picture_disc: String(isPictureDisc),
          discs_count: String(discsCount),
          color: discColor,
        }).forEach(([k, v]) => fd.append(k, v))
        result = isEdit ? await api.vinyls.update(id, fd) : await api.vinyls.create(fd)
      } else {
        const payload = {
          artist: form.artist,
          title: form.title,
          track_count: trackCount,
          tracklist: form.tracklist || null,
          genre: form.genre || null,
          label: form.label || null,
          release_date: form.releaseDate || null,
          barcode: form.barcode || null,
          mbid: form.mbid || null,
          discogs_release_id: form.discogsReleaseId || null,
          discogs_url: form.discogsUrl || null,
          lastfm_url: form.lastfmUrl || null,
          acquired_date: acquiredDate,
          notes: form.notes || null,
          disc_type: discType,
          is_picture_disc: isPictureDisc,
          discs_count: discsCount,
          color: discColor,
          // SUPPRESSION EXPLICITE de la jaquette (bouton « Retirer le fichier ») :
          // drapeau de purge — le backend ÉCRASE cover_url par NULL. Jamais de
          // repli sur un chemin ci-dessous quand la suppression est armée.
          ...(removeCover
            ? { remove_cover: true, coverRemoteUrl: null }
            : { coverRemoteUrl: remoteUrl || (isEdit ? existingCover : '') || null }),
          // Image d'ARTISTE : SUPPRESSION EXPLICITE armée -> le drapeau prime
          // (le backend purge la colonne) ; sinon rien n'est envoyé pour ce
          // champ en mode JSON = on conserve l'image courante.
          ...(removeArtistImage ? { remove_artist_image: true } : {}),
        }
        result = isEdit ? await api.vinyls.update(id, payload) : await api.vinyls.create(payload)
      }
      // Retour à la vue d'ORIGINE (page source + sous-état openGroup/letter/q)
      // avec le toast de confirmation ; repli /collection si aucune origine.
      navigate(origin?.path || '/collection', { state: { toastKey: isEdit ? 'collection.updatedVinyl' : 'collection.addedVinyl', title: isEdit ? undefined : result.vinyl.title, ...(origin?.view || {}) } })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-10 text-slate-400">{t('vinylForm.loading')}</div>
  }
  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <p className="text-rose-400">{t('vinylForm.notFound')}</p>
        <LinkHome />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          {/* Nomenclature officielle (libellés du formulaire) :
              « Modifier le disque » / « Nouveau disque ». */}
          {/* Titre « Nouveau disque » / « Modifier le disque » : lettrage COMICS US
              (Bangers, majuscules, blanc + liseré/ombre noire — .comic-page-title
              dans index.css), harmonisé aux titres principaux « MES DISQUES » /
              « MES BD » — identique sous tous les thèmes. */}
          <h1 className="cb-page-title comic-page-title text-2xl font-extrabold">
            {isEdit ? t('vinylForm.pageTitleEdit') : t('vinylForm.pageTitleNew')}
          </h1>

        </div>
        {!isEdit && (
          <button className="btn-ghost" onClick={() => setModalOpen(true)}>{t('vinylForm.importVinylBtn')}</button>
        )}
      </header>

      {error && (
        <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <form onSubmit={submit} className="card p-6 space-y-6">
        {/* Jaquette */}
        <fieldset className="space-y-3">
          <legend className="label !mb-0">{t('vinylForm.coverSection')}</legend>
          <div className="flex gap-4 items-start">
            <div className="w-28 h-28 shrink-0 rounded-lg overflow-hidden bg-night-900 border border-night-600 grid place-items-center">
              {preview ? (
                <img src={preview} alt={t('vinylForm.coverAlt')} className="w-full h-full object-cover" />
              ) : (
                // Placeholder « Aucune jaquette » harmonisé sur --text-faint (slate-400).
                <span className="text-xs text-slate-400 text-center px-2">{t('vinylForm.noCover')}</span>
              )}
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <label className="btn-ghost cursor-pointer text-left !justify-start w-full sm:w-auto">
                  {file ? t('common.changeFile') : t('common.uploadFile')}
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null
                      setFile(f)
                      // Nouvelle jaquette sélectionnée : la suppression
                      // explicite demandée avant est caduque.
                      if (f) setRemoveCover(false)
                    }}
                  />
                </label>
                {file && <p className="mt-1 text-xs text-slate-500 truncate">{file.name}</p>}
              </div>
              <div>
                <label className="label">{t('common.orRemoteUrl')}</label>
                <input
                  className="input"
                  placeholder={t('vinylForm.remoteUrlPlaceholder')}
                  value={remoteUrl}
                  onChange={(e) => {
                    setRemoteUrl(e.target.value)
                    // Une URL est (re)saisie : la suppression explicite demandée
                    // avant devient caduque.
                    if (e.target.value.trim()) setRemoveCover(false)
                  }}
                />
              </div>
              {/* « Retirer le fichier » — SUPPRESSION EXPLICITE de la jaquette :
                  retire le fichier éventuellement choisi + ré-initialise l'input
                  DOM, bascule immédiatement l'aperçu sur « Aucune jaquette » et
                  arme le drapeau remove_cover envoyé au backend (colonne
                  cover_url -> NULL). Visible si un fichiers, une URL ou la
                  jaquette en base est à retirer. */}
              {(file || remoteUrl || (isEdit && existingCover)) && (
                <button
                  type="button"
                  className="text-[11px] text-slate-500 underline decoration-dotted hover:text-slate-300"
                  onClick={() => handleRemoveImage('cover')}
                >
                  {t('common.removeFile')}
                </button>
              )}
              <p className="text-[11px] text-slate-500">{t('vinylForm.storedHint', { volume: './uploads' })}</p>
            </div>
          </div>
        </fieldset>

        {/* Image de l'artiste (photo / logo) — entité Artiste. Uniquement
            affichée dans la grille « Mes Disques » (tuile du groupe) ; ne
            remplace JAMAIS la jaquette d'album ci-dessus. À défaut de fichier,
            le backend récupère automatiquement une photo à la création
            (MusicBrainz -> Cover Art Archive), repli propre img/no_group.jpg. */}
        <fieldset className="space-y-3">
          <legend className="label !mb-0">{t('vinylForm.artistImageSection')}</legend>
          <div className="flex gap-4 items-start">
            <div className="w-28 h-28 shrink-0 rounded-lg overflow-hidden bg-night-900 border border-night-600 grid place-items-center">
              {artistPreview ? (
                <img src={artistPreview} alt={t('vinylForm.artistImageAlt')} className="w-full h-full object-cover" />
              ) : (
                <span className="text-[11px] text-slate-400 text-center px-2 leading-snug">
                  {t('vinylForm.photoOrLogoOptional')}
                </span>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <div>
                <label className="btn-ghost cursor-pointer text-left !justify-start w-full sm:w-auto">
                  {artistFile ? t('common.changeFile') : t('vinylForm.choosePhoto')}
                  <input
                    ref={artistFileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null
                      setArtistFile(f)
                      // Nouvelle image d'artiste sélectionnée : la suppression
                      // explicite demandée avant est caduque.
                      if (f) setRemoveArtistImage(false)
                    }}
                  />
                </label>
                {artistFile && <p className="mt-1 text-xs text-slate-500 truncate">{artistFile.name}</p>}
              </div>
              {/* « Retirer le fichier » — SUPPRESSION EXPLICITE de l'image
                  d'ARTISTE : retire le fichier éventuellement choisi +
                  ré-initialise l'input DOM, bascule immédiatement l'aperçu sur
                  l'image de secours locale img/no_group.jpg (exactement le
                  visuel de la tuile « Mes Disques ») et arme le drapeau
                  remove_artist_image envoyé au backend (colonne artist_image
                  ÉCRASÉE par NULL — jamais l'ancienne photo, jamais la
                  jaquette d'album). Visible si un fichier est choisi OU s'il
                  existe une image en base à retirer. */}
              {(artistFile || (isEdit && existingArtistImage)) && (
                <button
                  type="button"
                  className="text-[11px] text-slate-500 underline decoration-dotted hover:text-slate-300"
                  onClick={() => handleRemoveImage('artistImage')}
                >
                  {t('common.removeFile')}
                </button>
              )}
              <p className="text-[11px] text-slate-500">{t('vinylForm.artistImageHint')}</p>
            </div>
          </div>
        </fieldset>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={t('vinylForm.artistField')}>
            <input className="input" value={form.artist} onChange={set('artist')} placeholder="Pink Floyd" required />
          </Field>
          <Field label={t('vinylForm.titleField')}>
            <input className="input" value={form.title} onChange={set('title')} placeholder="The Dark Side of the Moon" required />
          </Field>
          <Field label={t('vinylForm.trackCountField')}>
            <input
              className="input"
              type="number"
              min="0"
              value={form.trackCount}
              onChange={set('trackCount')}
            />
          </Field>
          <Field label={t('vinylForm.genreField')}>
            <input className="input" value={form.genre} onChange={set('genre')} placeholder="Progressive Rock" />
          </Field>
          <Field label={t('vinylForm.labelField')}>
            <input className="input" value={form.label} onChange={set('label')} placeholder="Harvest" />
          </Field>
          <Field label={t('vinylForm.releaseDateField')}>
            <input className="input" type="date" value={form.releaseDate} onChange={set('releaseDate')} />
          </Field>
          <Field label={t('vinylForm.barcodeField')}>
            <input
              className="input font-mono"
              value={form.barcode}
              onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value.replace(/\D/g, '') }))}
              placeholder="0190295958361"
            />
          </Field>
          <Field label={t('vinylForm.addedDateField')}>
            {/* Date exacte d'ajout du disque à la bibliothèque (remplace l'ancien
                « Année d'acquisition »). Pré-remplie avec la date du jour à la
                création ; peut être ajustée rétroactivement ici même ou en édition.
                Stockée en base dans vinyls.acquired_date (DATE). */}
            <input className="input" type="date" value={form.acquiredDate} onChange={set('acquiredDate')} />
          </Field>
        </div>

        <Field label={t('vinylForm.tracklistField')}>
          <textarea
            className="input min-h-[120px] font-mono text-[13px]"
            value={form.tracklist}
            onChange={set('tracklist')}
            placeholder={'A1 : Blackened (6:42)\nA2 : Electrocution (6:52)\n…'}
          />
        </Field>

        {/* Options du disque : UNE ligne horizontale (flexbox), de gauche à
            droite — 1. Type de Disque (select « Vinyle »/« Compact », défaut
            « Vinyle » — remplace l'ancienne checkbox « Édition spéciale ») ·
            2. Nombre de Disques (select 1 → 5, défaut 1) ·
            3. Picture Disc (case à cocher, défaut non coché) ·
            4. Couleur (menu déroulant custom des couleurs de galettes avec
            pastille ronde de la teinte à côté du libellé (+ option « N/A » —
            cercle barré et vide), défaut « Noir » — remplace l'ancien champ
            « Notes (optionnel) »). */}
        <fieldset className="space-y-2">
          <legend className="label !mb-0">{t('vinylForm.discOptions')}</legend>
          <div className="flex flex-col sm:flex-row gap-x-4 gap-y-2 items-end">
            {/* 1. Type de Disque : « Vinyle » / « Compact » (défaut « Vinyle »),
                envoyé `disc_type` — remplace l'ancienne checkbox « Édition spéciale » */}
            <div className="sm:flex-1">
              <Field label={t('vinylForm.discTypeLabel')}>
                {/* « Vinyle » (défaut) / « Compact » — la valeur `Vinyle` est
                    portée par le formulaire (EMPTY.discType = 'Vinyle' et
                    chargement en mode édition) : c'est l'option par défaut. */}
                <select className="input" value={form.discType} onChange={set('discType')}>
                  <option value="Vinyle">{t('vinylForm.discTypeVinyl')}</option>
                  <option value="Compact">{t('vinylForm.discTypeCompact')}</option>
                </select>
              </Field>
            </div>

            {/* 2. Nombre de Disques : entiers 1 → 5 (défaut 1), stocké discs_count INTEGER */}
            <div className="sm:flex-1">
              <Field label={t('vinylForm.discsCountLabel')}>
                <select
                  className="input"
                  value={form.discsCount}
                  onChange={(e) => setForm((f) => ({ ...f, discsCount: e.target.value }))}
                >
                  {DISCS_COUNT_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* 3. Picture Disc : case à cocher (défaut non coché), stocké
                is_picture_disc BOOLEAN. Alignée sur la ligne de champs : la
                case est centrée verticalement sur la hauteur du select
                (h-10). */}
            <div className="sm:flex-1 max-w-[150px]">
              <span className="label">{t('vinylForm.pictureDiscLabel')}</span>
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-slate-300 select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-gold-500"
                  checked={Boolean(form.pictureDisc)}
                  onChange={(e) => setForm((f) => ({ ...f, pictureDisc: e.target.checked }))}
                />
                {form.pictureDisc ? t('vinylForm.yes') : t('vinylForm.no')}
              </label>
            </div>

            {/* 4. Couleurs : MULTI-SELECT custom — pastille ronde de la teinte
                à côté du libellé, cercle barré et vide pour « N/A ». Le
                <select> natif ne pouvant pas afficher un SVG ni cocher
                plusieurs options, un bouton + panneau (useDismiss) remplace le
                <select> ; fermeture au clic à l'extérieur ou sur Échap. Chaque
                clic TOGGLE la couleur (ajout / retrait) — le menu reste ouvert
                pour cumuler les choix ; « N/A » est exclusif (vide la liste). */}
            <div className="sm:flex-1" ref={colorMenuRef}>
              <span className="label">{t('vinylForm.colorLabel')}</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setColorMenuOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={colorMenuOpen}
                  className="input flex !items-center justify-between gap-2 text-left"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {form.color.length === 0 ? (
                      colorDot(COLOR_NA)
                    ) : (
                      form.color.slice(0, 4).map((c) => colorDot(c))
                    )}
                    {form.color.length > 4 && (
                      <span className="shrink-0 text-[11px] text-slate-500">+{form.color.length - 4}</span>
                    )}
                    <span className="truncate">
                      {form.color.length === 0
                        ? t('vinylForm.na')
                        : form.color.map((c) => colorLabel(c, t)).join(', ')}
                    </span>
                  </span>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className={`shrink-0 text-slate-500 transition-transform ${colorMenuOpen ? 'rotate-180' : ''}`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {colorMenuOpen && (
                  <ul
                    role="listbox"
                    aria-multiselectable="true"
                    tabIndex={-1}
                    onBlur={(e) => {
                      /* Le focus passe du bouton au <ul> au clic ; s'il sort de
                         l'élément (clic extérieur), le menu se referme. */
                      if (colorMenuRef.current && !colorMenuRef.current.contains(e.relatedTarget)) {
                        setColorMenuOpen(false)
                      }
                    }}
                    className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-night-500 bg-night-800 py-1 shadow-xl shadow-black/50"
                  >
                    <ColorOption
                      value={COLOR_NA}
                      label={t('vinylForm.na')}
                      selected={form.color.length === 0}
                      onSelect={() => setForm((f) => ({ ...f, color: [] }))}
                    />
                    {sortedDiscColors(t).map((c) => (
                      <ColorOption
                        key={c.value}
                        value={c.value}
                        label={colorLabel(c.value, t)}
                        hex={c.hex}
                        selected={form.color.includes(c.value)}
                        onSelect={() => toggleColor(c.value)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </fieldset>

        {/* Identifiants externes (recherche par code-barres) */}
        <fieldset className="space-y-3">
          <legend className="label !mb-0">{t('vinylForm.externalIds')}</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label={t('vinylForm.mbidField')}>
              <input
                className="input font-mono text-[12px]"
                value={form.mbid}
                onChange={set('mbid')}
                placeholder={t('vinylForm.mbidPlaceholder')}
              />
            </Field>
            <Field label={t('vinylForm.discogsIdField')}>
              <input
                className="input font-mono"
                inputMode="numeric"
                value={form.discogsReleaseId}
                onChange={(e) => setForm((f) => ({ ...f, discogsReleaseId: e.target.value.replace(/\D/g, '') }))}
                placeholder={t('vinylForm.discogsIdPlaceholder')}
              />
            </Field>
          </div>
          <Field label={t('vinylForm.discogsUrlField')}>
            <input
              className="input font-mono text-[12px]"
              value={form.discogsUrl}
              onChange={set('discogsUrl')}
              placeholder={t('vinylForm.discogsUrlPlaceholder')}
            />
          </Field>
          <p className="text-[11px] text-slate-500">{t('vinylForm.autoFilledNote')}</p>
        </fieldset>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-night-600/50">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? t('common.saving') : isEdit ? t('vinylForm.saveChanges') : t('common.addCollection')}
          </button>
          <button type="button" className="btn-ghost" onClick={() => navigate(origin?.path || '/collection', { state: { ...(origin?.view || {}) } })}>{t('common.cancel')}</button>
        </div>
      </form>

      <BarcodeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onPrefill={(payload) => {
          setForm((f) => ({
            ...f,
            artist: payload.artist || f.artist,
            title: payload.title || f.title,
            trackCount: applyPrefillTrackCount(payload.trackCount, f.trackCount),
            tracklist: payload.tracklist || f.tracklist,
            genre: payload.genre || f.genre,
            label: payload.label || f.label,
            releaseDate: payload.releaseDate || f.releaseDate,
            barcode: payload.barcode || f.barcode,
            mbid: payload.mbid || f.mbid,
            discogsReleaseId: payload.discogsReleaseId || f.discogsReleaseId,
            discogsUrl: payload.discogsUrl || f.discogsUrl,
            // Fiche Last.fm d'album (provenance prioritaire de la cascade).
            lastfmUrl: payload.lastfmUrl || f.lastfmUrl,
          }))
          if (payload.coverRemoteUrl) setRemoteUrl(payload.coverRemoteUrl)
        }}
      />
    </div>
  )
}

/* Ligne du menu déroulant « Couleur » : pastille + libellé (+ coche si
   sélection), style du menu ⚙ de la toolbar de vue. */
function ColorOption({ value, hex, label, selected, onSelect }) {
  return (
    <li role="option" aria-selected={selected}>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition ${
          selected ? 'bg-gold-500/15 text-gold-300' : 'text-slate-300 hover:bg-night-700/60'
        }`}
      >
        {colorDot(value)}
        <span className="flex-1 truncate text-left">{label}</span>
        {selected && <CheckIcon size={14} className="shrink-0 text-gold-400" />}
      </button>
    </li>
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

function LinkHome() {
  const { t } = useTranslation()
  return (
    <a href="/collection" className="btn-ghost">{t('vinylForm.backToCollection')}</a>
  )
}
