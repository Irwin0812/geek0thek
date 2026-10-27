import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../services/api.js'
import BarcodeModal from '../components/BarcodeModal.jsx'
import { CheckIcon } from '../components/icons.jsx'
import { useDismiss } from '../components/hooks.js'

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
  acquiredDate: todayIso(),
  notes: '',
  // Options du disque (rangée horizontale) : type de disque, nombre de
  // disques, picture disc et couleur de la galette. Ordre de la ligne, de
  // gauche à droite : Type de Disque → Nombre de Disques → Picture Disc → Couleur.
  discType: 'Vinyle', // valeur de l'option par défaut du select « Type de Disque » (voir option conservée dans le menu, exception)
  discsCount: 1,      // select entiers 1 → 5 — valeur par défaut 1
  pictureDisc: false, // case à cocher « Picture Disc » — défaut non coché
  color: 'Noir',      // menu déroulant custom des couleurs de galettes (pastille + libellé) — défaut « Noir »
}

/* Option « N/A » du menu déroulant « Couleur » : pas de couleur enregistrée
   (valeur stockée en base, colonne vinyls.color VARCHAR(50) sans liste). */
const COLOR_NA = 'N/A'

/* Couleurs de galettes proposées dans le menu « Couleur » : teintes de base,
   transparent et finitions métallisées / spéciales, chacune avec la teinte
   (couleur CSS) de sa pastille ronde affichée à côté du libellé. */
const DISC_COLORS = [
  { value: 'Noir', hex: '#17181b' },
  { value: 'Blanc', hex: '#f5f5f4' },
  { value: 'Rouge', hex: '#dc2626' },
  { value: 'Bleu', hex: '#2563eb' },
  { value: 'Vert', hex: '#16a34a' },
  { value: 'Jaune', hex: '#eab308' },
  { value: 'Violet', hex: '#7c3aed' },
  { value: 'Rose', hex: '#ec4899' },
  { value: 'Transparent', hex: 'rgba(148, 163, 184, 0.3)' },
  { value: 'Or', hex: '#d4a017' },
  { value: 'Argent', hex: '#cbd5e1' },
  { value: 'Cuivre', hex: '#b87333' },
  { value: 'Bronze', hex: '#8c6239' },
  { value: 'Marbré', hex: 'linear-gradient(135deg, #17181b 0%, #17181b 45%, #cbd5e1 50%, #17181b 55%, #17181b 70%, #e2e8f0 75%, #17181b 100%)' },
  { value: 'Splatter', hex: 'radial-gradient(circle at 30% 35%, #dc2626 0 14%, transparent 15%), radial-gradient(circle at 62% 60%, #f8fafc 0 10%, transparent 11%), radial-gradient(circle at 75% 28%, #dc2626 0 8%, transparent 9%), radial-gradient(circle at 45% 78%, #f8fafc 0 7%, transparent 8%), #17181b' },
]

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
  const [params] = useSearchParams()

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
          acquiredDate: v.addedDate ? String(v.addedDate).slice(0, 10) : todayIso(),
          notes: v.notes || '',
          // Options du disque : type (défaut « Disque »), entiers
          // resserrés dans la plage du select (1 → 5) + case « Picture Disc »
          // + couleur par défaut « Noir ».
          discType: 'Vinyle',
          discsCount: toDiscsCount(v.discsCount),
          pictureDisc: Boolean(v.isPictureDisc),
          // « N/A » (pas de couleur) : valeur explicite de la colonne color.
          color: v.color || 'Noir',
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
      // aperçu local sans CORS : on tente directement, sinon fallback
      return remoteUrl
    }
    if (isEdit && !removeCover) return existingCover
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
    if (raw) return raw
    return IMG_NO_GROUP
  }, [artistFile, isEdit, existingArtistImage, removeArtistImage, existingCover])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

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
      setError("L'artiste et le titre de l'album sont obligatoires.")
      return
    }
    const trackCount = toTrackCount(form.trackCount)
    const acquiredDate = toAcquiredDate(form.acquiredDate)
    // Options du disque : valeurs finales normalisées pour les deux payloads.
    const discType = String(form.discType || '').trim() || 'Vinyle'
    const isPictureDisc = Boolean(form.pictureDisc)
    const discsCount = toDiscsCount(form.discsCount, 1)
    // « N/A » : valeur explicite (pas de couleur) — conservée telle quelle,
    // seul un choix vide retombe sur le défaut « Noir ».
    const discColor = String(form.color || '').trim() || 'Noir'
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
          // '' (jamais null/NaN) : FormData convertirait null en "null"
          acquired_date: acquiredDate === null ? '' : acquiredDate,
          notes: form.notes || '',
          // Type de disque (« Disque » / « Compact ») + picture disc boolean
          // (« true » / « false » ; le backend accepte aussi '1'/'0').
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
      navigate('/collection', { state: { toast: `${isEdit ? 'Disque mis à jour.' : '« ' + result.vinyl.title + ' » ajouté à votre collection.'}` } })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-10 text-slate-400">Chargement du disque…</div>
  }
  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <p className="text-rose-400">Ce disque n'existe pas ou vous n'y avez pas accès.</p>
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
          <h1 className="text-2xl font-extrabold text-white">
            {isEdit ? 'Modifier le disque' : 'Nouveau disque'}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Deux méthodes d'import : « Code-barres » (MusicBrainz + Discogs) ou saisie manuelle complète.
          </p>
        </div>
        {!isEdit && (
          <button className="btn-ghost" onClick={() => setModalOpen(true)}>⌗ Import par code-barres</button>
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
          <legend className="label !mb-0">Jaquette</legend>
          <div className="flex gap-4 items-start">
            <div className="w-28 h-28 shrink-0 rounded-lg overflow-hidden bg-night-900 border border-night-600 grid place-items-center">
              {preview ? (
                <img src={preview} alt="Aperçu de la jaquette" className="w-full h-full object-cover" />
              ) : (
                // Placeholder « Aucune jaquette » harmonisé sur --text-faint (slate-400).
                <span className="text-xs text-slate-400 text-center px-2">Aucune jaquette</span>
              )}
            </div>
            <div className="flex-1 space-y-3">
              <div>
                <label className="btn-ghost cursor-pointer text-left !justify-start w-full sm:w-auto">
                  {file ? 'Changer le fichier' : 'Téléverser un fichier (JPG, PNG, WEBP)'}
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
                <label className="label">…ou URL distante</label>
                <input
                  className="input"
                  placeholder="https://…/cover.jpg (MusicBrainz, Internet Archive…)"
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
                  Retirer le fichier
                </button>
              )}
              <p className="text-[11px] text-slate-500">
                Le fichier sera stocké localement sur le serveur (volume <code>./uploads</code>).
              </p>
            </div>
          </div>
        </fieldset>

        {/* Image de l'artiste (photo / logo) — entité Artiste. Uniquement
            affichée dans la grille « Mes Disques » (tuile du groupe) ; ne
            remplace JAMAIS la jaquette d'album ci-dessus. À défaut de fichier,
            le backend récupère automatiquement une photo à la création
            (MusicBrainz -> Cover Art Archive), repli propre img/no_group.jpg. */}
        <fieldset className="space-y-3">
          <legend className="label !mb-0">Image de l'artiste</legend>
          <div className="flex gap-4 items-start">
            <div className="w-28 h-28 shrink-0 rounded-lg overflow-hidden bg-night-900 border border-night-600 grid place-items-center">
              {artistPreview ? (
                <img src={artistPreview} alt="Aperçu de l'image de l'artiste" className="w-full h-full object-cover" />
              ) : (
                <span className="text-[11px] text-slate-400 text-center px-2 leading-snug">
                  Photo ou logo
                  <br />
                  (optionnel)
                </span>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <div>
                <label className="btn-ghost cursor-pointer text-left !justify-start w-full sm:w-auto">
                  {artistFile ? 'Changer le fichier' : 'Choisir une photo / un logo (JPG, PNG)'}
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
                  Retirer le fichier
                </button>
              )}
              <p className="text-[11px] text-slate-500">
                Optionnel : utilisée uniquement sur la tuile « artiste » de la page Mes Disques.
                Sans photo, elle est récupérée automatiquement lors de l'ajout ; à défaut,&nbsp;
                l'emblème par défaut s'affiche.
              </p>
            </div>
          </div>
        </fieldset>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Artiste / groupe *">
            <input className="input" value={form.artist} onChange={set('artist')} placeholder="Pink Floyd" required />
          </Field>
          <Field label="Titre de l'album *">
            <input className="input" value={form.title} onChange={set('title')} placeholder="The Dark Side of the Moon" required />
          </Field>
          <Field label="Nombre de chansons">
            <input
              className="input"
              type="number"
              min="0"
              value={form.trackCount}
              onChange={set('trackCount')}
            />
          </Field>
          <Field label="Style / genre musical">
            <input className="input" value={form.genre} onChange={set('genre')} placeholder="Progressive Rock" />
          </Field>
          <Field label="Maison d'édition (Label)">
            <input className="input" value={form.label} onChange={set('label')} placeholder="Harvest" />
          </Field>
          <Field label="Date de sortie">
            <input className="input" type="date" value={form.releaseDate} onChange={set('releaseDate')} />
          </Field>
          <Field label="Code-barres (EAN/UPC)">
            <input
              className="input font-mono"
              value={form.barcode}
              onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value.replace(/\D/g, '') }))}
              placeholder="0190295958361"
            />
          </Field>
          <Field label="Date d'ajout">
            {/* Date exacte d'ajout du disque à la bibliothèque (remplace l'ancien
                « Année d'acquisition »). Pré-remplie avec la date du jour à la
                création ; peut être ajustée rétroactivement ici même ou en édition.
                Stockée en base dans vinyls.acquired_date (DATE). */}
            <input className="input" type="date" value={form.acquiredDate} onChange={set('acquiredDate')} />
          </Field>
        </div>

        <Field label="Liste des pistes">
          <textarea
            className="input min-h-[120px] font-mono text-[13px]"
            value={form.tracklist}
            onChange={set('tracklist')}
            placeholder={'A1 : Blackened (6:42)\nA2 : Electrocution (6:52)\n…'}
          />
        </Field>

        {/* Options du disque : UNE ligne horizontale (flexbox), de gauche à
            droite — 1. Type de Disque (select « Disque »/« Compact », défaut
            « Disque » — remplace l'ancienne checkbox « Édition spéciale ») ·
            2. Nombre de Disques (select 1 → 5, défaut 1) ·
            3. Picture Disc (case à cocher, défaut non coché) ·
            4. Couleur (menu déroulant custom des couleurs de galettes avec
            pastille ronde de la teinte à côté du libellé (+ option « N/A » —
            cercle barré et vide), défaut « Noir » — remplace l'ancien champ
            « Notes (optionnel) »). */}
        <fieldset className="space-y-2">
          <legend className="label !mb-0">Disque — options</legend>
          <div className="flex flex-col sm:flex-row gap-x-4 gap-y-2 items-end">
            {/* 1. Type de Disque : « Disque » / « Compact » (défaut « Disque »),
                envoyé `disc_type` — remplace l'ancienne checkbox « Édition spéciale » */}
            <div className="sm:flex-1">
              <Field label="Type de Disque">
                <select className="input" value={form.discType} onChange={set('discType')}>
                  <option value="Vinyle">Disque Vinyle</option>
                  <option value="Compact">Compact</option>
                </select>
              </Field>
            </div>

            {/* 2. Nombre de Disques : entiers 1 → 5 (défaut 1), stocké discs_count INTEGER */}
            <div className="sm:flex-1">
              <Field label="Nombre de Disques">
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
              <span className="label">Picture Disc</span>
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-lg px-1 text-sm text-slate-300 select-none">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-gold-500"
                  checked={Boolean(form.pictureDisc)}
                  onChange={(e) => setForm((f) => ({ ...f, pictureDisc: e.target.checked }))}
                />
                {form.pictureDisc ? 'Oui' : 'Non'}
              </label>
            </div>

            {/* 4. Couleur : menu déroulant custom — pastille ronde de la teinte
                à côté du libellé correspondant, cercle barré et vide pour
                « N/A ». Le <select> natif ne pouvant pas afficher un SVG, un
                bouton + panneau (useDismiss) remplace le <select> ; fermeture
                au clic à l'extérieur ou sur Échap. */}
            <div className="sm:flex-1" ref={colorMenuRef}>
              <span className="label">Couleur</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setColorMenuOpen((v) => !v)}
                  aria-haspopup="listbox"
                  aria-expanded={colorMenuOpen}
                  className="input flex !items-center justify-between gap-2 text-left"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {colorDot(form.color)}
                    <span className="truncate">{colorLabel(form.color)}</span>
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
                    tabIndex={-1}
                    onBlur={(e) => {
                      /* Le focus passe du bouton au <ul> au clic ; s'il sort de
                         l'élément (clic extérieur), le menu se referme. */
                      if (colorMenuRef.current && !colorMenuRef.current.contains(e.relatedTarget)) {
                        setColorMenuOpen(false)
                      }
                    }}
                    className="absolute left-0 right-0 z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-night-500 bg-night-800 py-1 shadow-xl shadow-black/50"
                  >
                    <ColorOption
                      value={COLOR_NA}
                      label="N/A"
                      selected={form.color === COLOR_NA}
                      onSelect={() => {
                        setForm((f) => ({ ...f, color: COLOR_NA }))
                        setColorMenuOpen(false)
                      }}
                    />
                    {DISC_COLORS.map((c) => (
                      <ColorOption
                        key={c.value}
                        value={c.value}
                        label={c.value}
                        hex={c.hex}
                        selected={form.color === c.value}
                        onSelect={() => {
                          setForm((f) => ({ ...f, color: c.value }))
                          setColorMenuOpen(false)
                        }}
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
          <legend className="label !mb-0">Identifiants externes</legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="MusicBrainz (release MBID)">
              <input
                className="input font-mono text-[12px]"
                value={form.mbid}
                onChange={set('mbid')}
                placeholder="UUID de la release (rempli par la recherche)"
              />
            </Field>
            <Field label="Discogs (release ID)">
              <input
                className="input font-mono"
                inputMode="numeric"
                value={form.discogsReleaseId}
                onChange={(e) => setForm((f) => ({ ...f, discogsReleaseId: e.target.value.replace(/\D/g, '') }))}
                placeholder="ID numérique de la fiche Discogs"
              />
            </Field>
          </div>
          <Field label="Discogs (URL de la fiche)">
            <input
              className="input font-mono text-[12px]"
              value={form.discogsUrl}
              onChange={set('discogsUrl')}
              placeholder="https://www.discogs.com/releases/1234567"
            />
          </Field>
          <p className="text-[11px] text-slate-500">
            Ces champs sont remplis automatiquement par la recherche par code-barres
            (MusicBrainz + Discogs) ; ils restent modifiables et sont conservés avec le disque.
          </p>
        </fieldset>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-night-600/50">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Enregistrement…' : isEdit ? 'Enregistrer les modifications' : 'Ajouter à ma collection'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>Annuler</button>
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
          }))
          if (payload.coverRemoteUrl) setRemoteUrl(payload.coverRemoteUrl)
        }}
      />
    </div>
  )
}

/* Pastille d'accompagnement des choix du menu « Couleur » :
   – couleur connue → petit cercle de la teinte (hex / dégradé de
     DISC_COLORS — « Marbré » et « Splatter » portent un gradient CSS) ;
   – « N/A » → cercle barré et vide (SVG : anneau + diagonale).
   Une discrète bordure rend visibles les teintes claires et transparentes. */
function colorDot(value, size = 14) {
  if (value === COLOR_NA || !value) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="shrink-0 text-slate-500"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M5.64 18.36 18.36 5.64" />
      </svg>
    )
  }
  const c = DISC_COLORS.find((d) => d.value === value)
  return (
    <span
      className="inline-block shrink-0 rounded-full border border-slate-400/50"
      style={{ width: size, height: size, background: c ? c.hex : '#475569' }}
      aria-hidden="true"
    />
  )
}

/* Libellé d'une valeur de couleur (couleurs inconnues héritées : affichées
   telles quelles, avec leur pastille grise). */
const colorLabel = (value) => String(value || '—')

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
  return (
    <a href="/collection" className="btn-ghost">Retour à ma collection</a>
  )
}
