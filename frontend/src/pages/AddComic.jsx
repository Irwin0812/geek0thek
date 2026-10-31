import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../services/api.js'
import IsbnModal from '../components/IsbnModal.jsx'

// « DATE D'AJOUT » du jour (temps local), format AAAA-MM-JJ strict :
// sert de valeur par défaut au champ lors de la création d'une nouvelle BD.
function todayIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Valeurs possibles du champ « Genre » (menu déroulant) :
// remplace l'ancienne zone de texte libre.
const GENRE_OPTIONS = ['Bande Dessinée', 'Comics', 'Manga', 'Autres']

// Option sélectionnée par défaut lors de l'ajout / l'initialisation du formulaire.
const DEFAULT_GENRE = 'Bande Dessinée'

// Garantit que le genre chargé (édition) ou pré-rempli (ISBN) correspond bien
// à une option du menu : les valeurs connues sont conservées, tandis que toute
// valeur vide, indéfinie ou inconnue (anciennes saisies libres, NULL en base…)
// retombe sur la valeur par défaut « Bande Dessinée » — jamais sur « Autres ».
function normalizeGenre(value) {
  const s = String(value || '').trim()
  if (!s) return DEFAULT_GENRE
  return GENRE_OPTIONS.includes(s) ? s : DEFAULT_GENRE
}

const EMPTY = {
  title: '',
  series: '',
  tomeNumber: '',
  authors: '',
  illustrators: '',
  publisher: '',
  releaseDate: '',
  genre: DEFAULT_GENRE,
  isbn: '',
  synopsis: '',
  addedDate: todayIso(),
  isSpecialEdition: false,
  isSigned: false,
}

// Normalise le chemin de couverture renvoyé par le backend :
//  - une URL distante est conservée telle quelle (http/https) ;
//  - un chemin local (ex. "/uploads/comics/cover-xxx.jpg") est préfixé par
//    l'origine pour être servi par le proxy -> backend :express.static sert
//    le volume ./uploads sous /uploads, donc l'URL complète doit pointer sur
//    l'origine du site et non sur un chemin relatif (sinon l'image s'affiche
//    cassée ou disparaît après une modification).
function toDisplayCover(coverUrl) {
  const s = String(coverUrl || '').trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return `${window.location.origin}${s}`
}

// Clé de comparaison entre deux adresses d'images désignant la MÊME ressource :
// retire le protocole + origine (un chemin stocké sans origine et une URL
// absolue du site doivent être considérés identiques). Vide si aucune valeur.
function imgKey(value) {
  const s = String(value || '').trim()
  if (!s) return ''
  return s.replace(/^https?:\/\/[^/]+/i, '')
}

// Chemin LOCAL STOCKÉ en base (/uploads/…) d'une image portée par le state :
// unique « valeur courante » jamais renvoyée au backend comme coverRemoteUrl /
// seriesImageRemoteUrl. Tout ce qui n'est PAS un chemin local stocké (URL
// distante saisie, emblème par défaut /img/no_title.jpg, vide) renvoie '' :
// le backend applique alors sa propre règle (conservation de la valeur en base
// — jamais d'écrasement par null, jamais de re-téléchargement inutile). C'est
// ce qui garantit l'INDÉPENDANCE TOTALE couverture du tome ↔ image de série :
// aucune des deux colonnes n'est « conservée » via l'autre.
function storedLocalPath(value) {
  const p = imgKey(value)
  return p.startsWith('/uploads/') ? p : ''
}

// DISSOCIATION SÉRIE ↔ TOME — garde stricte du formulaire : indique si une
// valeur « image de série » est EN FAIT la couverture du volume (celle en
// base ou celle soumise). Une telle valeur est INTERDITE à deux endroits :
//  - elle ne pré-remplit JAMAIS l'aperçu du champ « Image de la série »
//    (initialement, à la charge des données, ni après un enregistrement) ;
//  - elle n'est JAMAIS renvoyée au backend comme `seriesImageRemoteUrl` —
//    à défaut d'une vraie image de série, le champ reste VIDE (l'aperçu
//    s'affiche alors sur l'image par défaut img/no_title.jpg).
function sameAsCover(seriesImg, cover) {
  const a = imgKey(seriesImg)
  if (!a) return false
  const b = imgKey(cover)
  return Boolean(b) && a === b
}

/* Emblème par défaut des séries sans image locale (repli propre servie en
   statique, même visuel que sur les tuiles « Mes BD »). */
const IMG_NO_TITLE = '/img/no_title.jpg'

// Garantit un format AAAA-MM-JJ strict exploitable par <input type="date">
// (complète à -01-01 quand la date partielle arrive en AAAA ou AAAA-MM).
function toIsoDate(value) {
  const s = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const pad = (n) => String(n).padStart(2, '0')
  const m = s.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/)
  if (m) return `${m[1]}-${m[2] ? pad(Number(m[2])) : '01'}-${m[3] ? pad(Number(m[3])) : '01'}`
  const y = s.match(/\b(\d{4})\b/)
  if (y) return `${y[1]}-01-01`
  return s
}

export default function AddComic() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const [form, setForm] = useState(EMPTY)
  const [file, setFile] = useState(null)
  // Image / logo de la SÉRIE (colonne comics.series_image) : fichier choisi par
  // l'utilisateur + image courante en base (aperçu en mode édition).
  const [seriesFile, setSeriesFile] = useState(null)
  const [remoteUrl, setRemoteUrl] = useState('')
  const [existingCover, setExistingCover] = useState('')
  const [existingSeriesImage, setExistingSeriesImage] = useState('')
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const fileInput = useRef(null)
  // Référence à l'« <input type="file"> » de l'image de SÉRIE : indispensable pour
  // réinitialiser le contrôle DOM au clic sur « Retirer le fichier » (une
  // nouvelle sélection du même nom doit de nouveau déclencher onChange).
  const seriesFileInput = useRef(null)
  // SUPPRESSION EXPLICITE (« Retirer le fichier ») : true uniquement quand
  // l'utilisateur a retiré l'IMAGE COURANTE en base (couverture cover_url /
  // image de série comics.series_image). Le payload enverra alors
  // `remove_cover` / `remove_series_image` = "true" et le backend ÉCRASERA la
  // colonne par NULL — jamais un repli sur la couverture du tome.
  const [removeCover, setRemoveCover] = useState(false)
  const [removeSeriesImage, setRemoveSeriesImage] = useState(false)

  // Chargement en mode édition
  useEffect(() => {
    if (!isEdit) return
    const comicId = id
    let cancelled = false
    api.comics
      .get(comicId)
      .then((data) => {
        if (cancelled) return
        const c = data.comic
        setForm({
          title: c.title || '',
          series: c.series || '',
          tomeNumber: c.tomeNumber || '',
          authors: c.authors || '',
          illustrators: c.illustrators || '',
          publisher: c.publisher || '',
          releaseDate: c.releaseDate ? String(c.releaseDate).slice(0, 10) : '',
          // Mapping base -> <select> : option connue conservée ; si le genre
          // est vide, indéfini ou inconnu (saisie libre historique), la valeur
          // par défaut « Bande Dessinée » est sélectionnée.
          genre: normalizeGenre(c.genre),
          isbn: c.isbn || '',
          synopsis: c.synopsis || '',
          // DATE D'AJOUT : remplie par le backend à la création, modifiable ici.
          addedDate: c.addedDate ? String(c.addedDate).slice(0, 10) : todayIso(),
          isSpecialEdition: Boolean(c.isSpecialEdition),
          isSigned: Boolean(c.isSigned),
        })
        // URL d'affichage complète (origine + /uploads/comics/…) : l'aperçu
        // et le proxy statique n'acceptent pas un chemin relatif seul dans
        // tous les contextes (dev proxy, nginx).
        setExistingCover(toDisplayCover(c.coverUrl))
        // Image de série courante en base (chemin stocké tel quel : « /uploads/series/… »)
        // — l'aperçu est passé par toDisplayCover, mais c'est le chemin BRUT que
        // l'on renverra éventuellement au backend (field seriesImageRemoteUrl)
        // pour qu'il reconnaisse qu'il n'y a rien à re-télécharger.
        // DISSOCIATION SÉRIE/TOME : jamais la couverture du TOME (coverUrl)
        // pré-remplit le champ série — si l'API renvoyait malgré tout une
        // valeur identique au cover, elle est IGNOREE et le champ retombe sur
        // l'image par défaut img/no_title.jpg. Jamais de repli automatique sur
        // la couverture du tome dans cet aperçu. L'emblème par défaut lui-même
        // (/img/no_title.jpg) est traité comme une ABSENCE d'image dédiée :
        // le champ n'expose jamais ce repli (il s'affiche déjà tel quel), et
        // il n'est jamais resubmi au backend comme « image courante ».
        const rawSeriesImage = String(c.seriesImageUrl || '').trim()
        setExistingSeriesImage(
          rawSeriesImage &&
            rawSeriesImage.replace(/^https?:\/\/[^/]+/i, '') !== IMG_NO_TITLE &&
            !sameAsCover(rawSeriesImage, c.coverUrl)
            ? rawSeriesImage
            : ''
        )
        // Rechargement = nouvelle session de formulaire : les drapeaux de
        // suppression explicite sont remis à false (leur valeur dépend de
        // l'état courant des champs ci-dessus).
        setRemoveCover(false)
        setRemoveSeriesImage(false)
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

  // Pré-remplissage depuis l'ISBN (?prefill=1&title=…&…)
  // Tous les champs du payload sont mappés explicitement : même s'il
  // n'y a pas de fichier, la couverture distante (coverRemoteUrl) est
  // récupérée et servira à télécharger le fichier au moment du submit.
  // Le synopsis de série (auto-copie) ne s'applique QUE si l'import ne
  // fournit pas déjà un résumé : voir l'effet `form.series` ci-dessous,
  // déclenché automatiquement par la mise à jour des champs ci-après.
  useEffect(() => {
    if (!params.get('prefill')) return
    const fill = (key) => (params.get(key) !== null ? params.get(key).trim() : '')
    setForm((f) => ({
      ...f,
      title: fill('title') || f.title,
      series: fill('series') || f.series,
      tomeNumber: fill('tomeNumber') || f.tomeNumber,
      authors: fill('authors') || f.authors,
      illustrators: fill('illustrators') || f.illustrators,
      publisher: fill('publisher') || f.publisher,
      releaseDate: toIsoDate(fill('releaseDate')) || f.releaseDate,
      // Menu déroulant : normalise vers une option du menu quand un genre est
      // fourni via les paramètres, sinon conserve la valeur courante.
      genre: fill('genre') ? normalizeGenre(fill('genre')) : f.genre,
      isbn: fill('isbn') || f.isbn,
      synopsis: fill('synopsis') || f.synopsis,
    }))
    const cover = fill('coverRemoteUrl')
    if (cover) setRemoteUrl(cover)
    navigate(isEdit ? `/comics/${id}` : '/comics/nouveau', { replace: true })
  }, [params, navigate, isEdit, id])

  // ----------------------------------------------------------
  // Auto-copie intelligente du synopsis par série (tâche 4) :
  // à chaque changement de champ « Série » (saisie manuelle, datalist
  // ou import ISBN), si une BD DE MA COLLECTION appartenant à cette
  // même série possède déjà un synopsis ET que le champ est vide, le
  // texte est pré-rempli automatiquement. Débouncé (400 ms) pour ne
  // pas faire partir une requête par frappe ; la double garde de
  // l'updater empêche une réponse obsolète d'écraser une saisie
  // manuelle postérieure (la série entre-temps changée, ou un résumé
  // rédigé dans l'intervalle).
  // ----------------------------------------------------------
  useEffect(() => {
    const name = form.series.trim()
    if (!name) return undefined
    let cancelled = false
    const timer = setTimeout(() => {
      api.comics
        .mine(name)
        .then((data) => {
          if (cancelled) return
          // Première BD de la série (requête triée sur created_at DESC)
          // ayant un synopsis renseigné : son texte sert de référence.
          const match = (data.comics || []).find(
            (c) => String(c.series || '').trim().toLowerCase() === name.toLowerCase() && String(c.synopsis || '').trim()
          )
          if (!match) return
          setForm((f) => {
            if (f.series.trim().toLowerCase() !== name.toLowerCase()) return f
            if (String(f.synopsis || '').trim()) return f // champ déjà renseigné
            return { ...f, synopsis: match.synopsis }
          })
        })
        .catch(() => {})
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [form.series])

  // Aperçu de la couverture :
  //  - fichier sélectionné   -> objet URL local (File)
  //  - URL distante saisie   -> telle quelle (doit être http/https)
  //  - BD existante          -> URL normalisée toDisplayCover (chemin local
  //    préfixé par l'origine, http/https conservé), mise à jour après chaque
  //    enregistrement via result.comic.coverUrl
  const preview = useMemo(() => {
    if (file) return URL.createObjectURL(file)
    // Suppression EXPLICITE armée : l'aperçu retombe immédiatement sur le
    // placeholder « Aucune couverture » — jamais de repli sur une URL ou la
    // valeur en base (cover_url -> NULL au submit via remove_cover=true).
    if (!removeCover && remoteUrl) return /^https?:\/\//.test(remoteUrl) ? remoteUrl : null
    if (isEdit && !removeCover && existingCover) return toDisplayCover(existingCover)
    return null
  }, [file, remoteUrl, existingCover, removeCover, isEdit])

  // Aperçu de l'IMAGE DE SÉRIE :
  //  - fichier choisi         -> objet URL local (File) ;
  //  - BD existante           -> image courante normalisée pour l'affichage.
  // SUPPRESSION EXPLICITE armée (« Retirer le fichier ») OU série sans image
  // dédiée en base : l'emblème par défaut img/no_title.jpg s'affiche
  // IMMÉDIATEMENT (exactement le visuel de la tuile « Mes BD »). Jamais, dans
  // aucun état, la jaquette du TOME n'alimente cet aperçu.
  // DISSOCIATION SÉRIE/TOME — dernière ligne de défense côté affichage : si la
  // valeur « image de série » est en réalité la couverture du TOME (état
  // legacy, API non corrigée…), elle n'est JAMAIS affichée ici : l'emblème par
  // défaut s'affiche à la place. Le champ série ne montre que l'image DÉDIÉE
  // stockée en base, jamais la jaquette du volume.
  const seriesPreview = useMemo(() => {
    if (seriesFile) return URL.createObjectURL(seriesFile)
    if (isEdit && existingSeriesImage && !removeSeriesImage) {
      return sameAsCover(existingSeriesImage, existingCover) ? IMG_NO_TITLE : toDisplayCover(existingSeriesImage)
    }
    return IMG_NO_TITLE
  }, [seriesFile, existingSeriesImage, removeSeriesImage, isEdit, existingCover])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  // ----------------------------------------------------------
  // SUPPRESSION EXPLICITE d'une image (« Retirer le fichier ») :
  //  - field === 'cover'       -> couverture d'album (couverture du TOME) ;
  //  - field === 'seriesImage' -> image / logo de la SÉRIE.
  // Comportement, strictement symétrique pour les deux (la jaquette d'album et
  // l'image de série sont gérées pareillement par le backend) :
  //  1. l'état du fichier éventuellement choisi est remis à null ET
  //     l'<input type="file"> associé est RÉ-INITIALISÉ (value = '') — sinon
  //        une nouvelle sélection du même fichier ne re-déclencherait pas
  //        onChange ;
  //  2. l'aperçu bascule IMMÉDIATEMENT sur le placeholder de la section ;
  //  3. un DRAPEAU DE SUPPRESSION EXPLICITE est armé pour le submit : le
  //        backend doit alors ÉCRASER la colonne par NULL (flag « true » dans
  //        le FormData ou le JSON — remove_cover / remove_series_image), au
  //        lieu de « conserver » la valeur d'avant (repli coverRemoteUrl qui
  //        bloquait la suppression).
  const handleRemoveImage = (field) => {
    if (field === 'cover') {
      // Fichier fraîchement choisi (pas encore enregistré) : retiré de l'état
      // + input DOM ré-initialisé.
      setFile(null)
      if (fileInput.current) fileInput.current.value = ''
      // URL distante saisie : vidée (sinon l'aperçu y retomberait).
      setRemoteUrl('')
      // Image COURANTE en base : suppression explicite -> aperçu « Aucune
      // couverture » + colonne cover_url -> NULL au submit (remove_cover=true).
      if (isEdit && existingCover) {
        setExistingCover('')
        setRemoveCover(true)
      }
    } else if (field === 'seriesImage') {
      // Fichier fraîchement choisi : retiré de l'état + input DOM ré-initialisé.
      setSeriesFile(null)
      if (seriesFileInput.current) seriesFileInput.current.value = ''
      // Image de série COURANTE en base : suppression explicite -> l'emblème
      // par défaut img/no_title.jpg s'affiche INSTANTANÉMENT dans l'aperçu et
      // la colonne series_image est ÉCRASÉE par NULL au submit (drapeau
      // remove_series_image=true — le backend ne conserve ni l'ancienne image,
      // ni la jaquette du tome). Jamais la jaquette du tome en image de série.
      setExistingSeriesImage('')
      setRemoveSeriesImage(true)
    }
  }

  // Suggestions « Série » : titres UNIQUE déjà présents dans ma collection
  // (chargés à l'ouverture du formulaire). Saisir une série existante
  // déclenche l'auto-copie du synopsis de la série (effet ci-dessus).
  // En mode édition : on exclut la BD courante pour éviter d'afficher
  // son propre titre comme suggestion.
  const [seriesSuggestions, setSeriesSuggestions] = useState([])
  useEffect(() => {
    let cancelled = false
    api.comics
      .mine()
      .then((data) => {
        if (cancelled) return
        const names = new Set()
        ;(data.comics || []).forEach((c) => {
          const s = String(c.series || '').trim()
          if (!s) return
          // Édition : on exclut la BD éditée pour ne pas se suggérer soi-même.
          if (isEdit && c.id === Number(id)) return
          names.add(s.toLowerCase())
        })
        const unique = new Set(
          Array.from(names).map((key) => {
            // Retrouve la version d'origine (casse intacte) de chaque nom.
            const original = (data.comics || []).find((c) => String(c.series || '').trim().toLowerCase() === key)
            return String(original?.series || '').trim()
          })
        )
        setSeriesSuggestions(Array.from(unique).sort((a, b) => a.localeCompare(b, 'fr')))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [id, isEdit])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.title.trim() || !form.authors.trim() || !form.publisher.trim()) {
      setError('Les champs Titre, Auteur(s) et Éditeur sont obligatoires.')
      return
    }
    setSaving(true)
    try {
      let result
      // DEUX fichiers possibles : couverture d'album (champ « cover ») +
      // image / logo de la SÉRIE (champ « seriesImage », déposé dans
      // ./uploads/series par multer) — upload.fields() côté backend.
      // Dès qu'UN des deux est un fichier, le payload devient multipart.
      if (file || seriesFile) {
        const fd = new FormData()
        if (removeCover) {
          // SUPPRESSION EXPLICITE de la couverture (bouton « Retirer le fichier »
          // de la section Couverture) : drapeau de purge — le backend ÉCRASE la
          // colonne cover_url par NULL ; aucun chemin n'est resubmis (sinon
          // resolveComicCover aurait conservé l'ancienne jaquette).
          fd.append('remove_cover', 'true')
        } else if (file) {
          fd.append('cover', file)
        } else if (isEdit && storedLocalPath(existingCover)) {
          // Pas de nouvelle couverture mais image de série en fichier : la
          // couverture courante est reprise via coverRemoteUrl, UNIQUEMENT si
          // elle EST un chemin local stocké (/uploads/…) — jamais l'emblème par
          // défaut ni une URL distante. Le backend détecte alors « sans
          // changement » et conserve EXACTEMENT la colonne cover_url en base
          // (l'image de SÉRIE n'y joue AUCUN rôle — dissociation stricte).
          fd.append('coverRemoteUrl', storedLocalPath(existingCover))
        }
        if (removeSeriesImage) {
          // SUPPRESSION EXPLICITE (bouton « Retirer le fichier ») : drapeau de
          // purge — le backend ÉCRASE la colonne series_image par NULL (purge
          // globale : entité + tous les tomes du même nom ; l'affichage retombe
          // sur l'image de secours locale img/no_title.jpg) au lieu de conserver
          // l'image courante.
          // Cette branche PRIME sur toute re-passage de chemin (jamais la
          // jaquette du tome pour alimenter series_image — dissociation stricte).
          fd.append('remove_series_image', 'true')
        } else if (seriesFile) {
          // Image / logo de la SÉRIE téléversée manuellement : elle remplace
          // l'image de la série (entité + TOUS les tomes du même nom). Son écriture
          // ne touche JAMAIS cover_url (le backend traite les deux colonnes par
          // des branches strictement séparées).
          fd.append('seriesImage', seriesFile)
        } else if (isEdit && storedLocalPath(existingSeriesImage)) {
          // Série existante, aucun nouveau fichier choisi : on renvoie le chemin
          // local STOCKÉ tel quel (/uploads/… uniquement) —
          // resolveComicSeriesImage le reconnaît et ne télécharge rien (l'image
          // courante est conservée). Un état obsolète (emblème/vide/URL distante)
          // n'est pas resubmi : le backend conserve alors la valeur en base.
          fd.append('seriesImageRemoteUrl', storedLocalPath(existingSeriesImage))
        }
        const fields = {
          title: form.title,
          series: form.series || null,
          tome_number: form.tomeNumber || null,
          authors: form.authors,
          illustrators: form.illustrators || null,
          publisher: form.publisher,
          release_date: form.releaseDate || null,
          genre: form.genre || null,
          isbn: form.isbn || null,
          synopsis: form.synopsis || null,
          // DATE D'AJOUT : remplie à la création (défaut = aujourd'hui),
          // modifiable dans le formulaire.
          added_date: form.addedDate || null,
          is_special_edition: String(form.isSpecialEdition),
          // « Livre dédicacé » (booléen)
          is_signed: String(form.isSigned),
        }
        // On n'envoie que les champs non vides : FormData stringifierait null
        // en "null" (ce qui polluerait les colonnes TEXT) et masquerait les
        // valeurs optionnelles réellement vides. La couverture est portée par
        // le fichier "cover" (multer) dans cette branche ; le body ne précise
        // donc rien (resolveComicCover lit req.files prioritairement).
        Object.entries(fields).forEach(([k, v]) => {
          if (v !== null && v !== '') fd.append(k, v)
        })
        result = isEdit ? await api.comics.update(id, fd) : await api.comics.create(fd)
      } else {
        const payload = {
          title: form.title,
          series: form.series || null,
          tome_number: form.tomeNumber || null,
          authors: form.authors,
          illustrators: form.illustrators || null,
          publisher: form.publisher,
          release_date: form.releaseDate || null,
          genre: form.genre || null,
          isbn: form.isbn || null,
          synopsis: form.synopsis || null,
          added_date: form.addedDate || null,
          is_special_edition: form.isSpecialEdition,
          // « Livre dédicacé » (booléen)
          is_signed: form.isSigned,
          // SUPPRESSION EXPLICITE de la couverture (bouton « Retirer le fichier ») :
          // drapeau de purge — le backend ÉCRASE cover_url par NULL. Jamais de
          // repli sur un chemin ci-dessous quand la suppression est armée.
          remove_cover: removeCover ? true : undefined,
          // COUVERTURE DU TOME (colonne cover_url) : URL distante SAISIE prioritaire ;
          // sinon (édition) UNIQUEMENT le chemin local stocké en base — jamais un état
          // obsolète ni l'image de série. Le backend applique alors la règle « sans
          // changement » : cover_url conservée à l'identique. Les deux colonnes ne se
          // servent mutuellement jamais de « valeur courante » (indépendance totale).
          coverRemoteUrl: removeCover
            ? null
            : remoteUrl || ((isEdit && storedLocalPath(existingCover)) || null),
          // IMAGE DE SÉRIE (colonne series_image, mode JSON) : en édition sans
          // nouveau fichier, le chemin local STOCKÉ est repassé tel quel (le backend
          // reconnaît qu'il n'y a rien à télécharger et conserve la valeur en base).
          // SUPPRESSION EXPLICITE armée : le drapeau prime — jamais de repassage du
          // chemin (le backend ÉCRASE series_image par NULL — couverture du tome
          // strictement intacte, dissociation stricte).
          ...(removeSeriesImage
            ? { remove_series_image: true }
            : { seriesImageRemoteUrl: isEdit ? storedLocalPath(existingSeriesImage) || null : null }),
        }
        result = isEdit ? await api.comics.update(id, payload) : await api.comics.create(payload)
      }
      // Met à jour le state de la couverture avec l'URL définitive renvoyée
      // par le backend (chemin local "/uploads/comics/…" ou URL distante),
      // pour que l'aperçu suive exactement le fichier stocké.
      if (isEdit && result.comic?.coverUrl) {
        setExistingCover(toDisplayCover(result.comic.coverUrl))
      }
      // Image de série définitive renvoyée par le backend (fichier uploadé,
      // image réutilisée, recherche auto, NULL après « Retirer le fichier »
      // ou repli img/no_title.jpg) : l'aperçu du champ « Image de la série »
      // suit l'image réellement stockée.
      // DISSOCIATION SÉRIE/TOME — même garde qu'au chargement : la valeur
      // renvoyée ne doit JAMAIS être la couverture du TOME (coverUrl déjà
      // définitive ici) ; sinon le champ retombe sur l'emblème par défaut.
      // L'emblème lui-même (/img/no_title.jpg) est assimilé à une ABSENCE d'
      // image dédiée : il s'affiche tel quel dans l'aperçu et n'est JAMAIS
      // resubmi au backend comme « image courante ». La valeur existante de la
      // série n'est donc jamais écrasée par la couverture soumise.
      if (isEdit) {
        const returnedSeriesImage = String(result.comic?.seriesImageUrl || '').trim()
        setExistingSeriesImage(
          returnedSeriesImage &&
            returnedSeriesImage.replace(/^https?:\/\/[^/]+/i, '') !== IMG_NO_TITLE &&
            !sameAsCover(returnedSeriesImage, result.comic.coverUrl)
            ? returnedSeriesImage
            : ''
        )
      }
      navigate('/comics', { state: { toastKey: isEdit ? 'collection.updatedComic' : 'collection.addedComic', title: isEdit ? undefined : result.comic.title } })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-10 text-slate-400">Chargement de la BD…</div>
  }
  if (notFound) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <p className="text-rose-400">Cette BD n'existe pas ou vous n'y avez pas accès.</p>
        <a href="/comics" className="btn-ghost inline-block">Retour à mes BD</a>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-white">
            {isEdit ? 'Modifier la BD' : 'Nouvelle bande dessinée'}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            BD, manga ou roman graphique — saisie manuelle ou import via ISBN (Google Books / Open Library).
          </p>
        </div>
        {!isEdit && (
          <button className="btn-ghost" onClick={() => setModalOpen(true)}>Importer une BD (#ISBN/Mots clés)</button>
        )}
      </header>

      {error && (
        <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
          {error}
        </p>
      )}

      <form onSubmit={submit} className="card p-6 space-y-6">
        {/* Couverture */}
        <fieldset className="space-y-3">
          <legend className="label !mb-0">Couverture</legend>
          <div className="flex gap-4 items-start">
            <div className="w-28 h-40 shrink-0 rounded-lg overflow-hidden bg-night-900 border border-night-600 grid place-items-center">
              {preview ? (
                <img src={preview} alt="Aperçu de la couverture" className="w-full h-full object-cover" />
              ) : (
                // Placeholder « Aucune couverture » harmonisé sur --text-faint (slate-400).
                <span className="text-xs text-slate-400 text-center px-2">Aucune couverture</span>
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
                      // Nouvelle couverture sélectionnée (ou annulée) : la
                      // suppression explicite demandeée avant est caduque.
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
                  placeholder="https://…/cover.jpg (Google Books, Open Library…)"
                  value={remoteUrl}
                  onChange={(e) => {
                    setRemoteUrl(e.target.value)
                    // Une URL est (re)saisie : la suppression explicite demandée
                    // avant devient caduque.
                    if (e.target.value.trim()) setRemoveCover(false)
                  }}
                />
              </div>
              {/* « Retirer le fichier » — SUPPRESSION EXPLICITE de la couverture
                  d'album : retire le fichier éventuellement choisi + ré-initialise
                  l'input DOM, bascule immédiatement l'aperçu sur « Aucune
                  couverture » et arme le drapeau remove_cover envoyé au backend
                  (colonne cover_url -> NULL). Visible seulement si un fichier,
                  une URL ou la couverture en base est à retirer. */}
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
                Le fichier sera stocké localement sur le serveur (volume <code>./uploads/comics</code>).
              </p>
            </div>
          </div>
        </fieldset>

        {/* Image de la SÉRIE (photo / logo) — entité Série. Champ « seriesImage »
            du formulaire : téléversée dans ./uploads/series et partagée entre
            TOUS les tomes du même nom (tous users). Optionnelle : à défaut, le
            backend la récupère automatiquement (Google Books / Open Library),
            repli propre img/no_title.jpg. N'affecte jamais la couverture
            d'album ci-dessus. */}
        <fieldset className="space-y-3">
          <legend className="label !mb-0">Image de la série</legend>
          <div className="flex gap-4 items-start">
            <div className="w-28 h-20 shrink-0 rounded-lg overflow-hidden bg-night-900 border border-night-600 grid place-items-center">
              {seriesPreview ? (
                <img src={seriesPreview} alt="Aperçu de l'image de la série" className="w-full h-full object-cover" />
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
                  {seriesFile ? 'Changer le fichier' : 'Téléverser un fichier (JPG, PNG)'}
                  <input
                    ref={seriesFileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null
                      setSeriesFile(f)
                      // Nouvelle image de série sélectionnée : la suppression
                      // explicite demandée avant est caduque.
                      if (f) setRemoveSeriesImage(false)
                    }}
                  />
                </label>
                {seriesFile && <p className="mt-1 text-xs text-slate-500 truncate">{seriesFile.name}</p>}
              </div>
              {/* « Retirer le fichier » — SUPPRESSION EXPLICITE de l'image de
                  Série : retire le fichier éventuellement choisi + ré-initialise
                  l'input DOM, bascule immédiatement l'aperçu sur l'image de
                  secours locale img/no_title.jpg (exactement le visuel de la
                  tuile « Mes BD ») et arme le drapeau remove_series_image envoyé
                  au backend (colonne series_image ÉCRASÉE par NULL — jamais
                  l'ancienne image, jamais la jaquette du tome). Visible si un
                  fichier est choisi OU s'il existe une image en base à retirer. */}
              {(seriesFile || (isEdit && existingSeriesImage)) && (
                <button
                  type="button"
                  className="text-[11px] text-slate-500 underline decoration-dotted hover:text-slate-300"
                  onClick={() => handleRemoveImage('seriesImage')}
                >
                  Retirer le fichier
                </button>
              )}
              <p className="text-[11px] text-slate-500">
                Optionnelle : affichée pour la série (tous ses tomes). Sans fichier,
                elle est retrouvée automatiquement ; à défaut,&nbsp;l'emblème par défaut s'affiche.
              </p>
            </div>
          </div>
        </fieldset>

        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Titre de l'album *">
            <input className="input" value={form.title} onChange={set('title')} placeholder="Corto Maltese" required />
          </Field>
          <Field label="Série">
            {/* Suggestions = séries déjà présentes dans ma collection :
                sélectionner/saisir une série existante pré-remplit
                automatiquement le synopsis si le champ est vide. */}
            <input
              className="input"
              value={form.series}
              onChange={set('series')}
              placeholder="Corto Maltese"
              list="comic-series-suggestions"
            />
            <datalist id="comic-series-suggestions">
              {seriesSuggestions.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <Field label="Tome / numéro">
            <input className="input" value={form.tomeNumber} onChange={set('tomeNumber')} placeholder="1" />
          </Field>
          <Field label="Auteur(s) *">
            <input className="input" value={form.authors} onChange={set('authors')} placeholder="Hugo Pratt" required />
          </Field>
          <Field label="Dessinateur(s)">
            <input className="input" value={form.illustrators} onChange={set('illustrators')} placeholder="Dessin" />
          </Field>
          <Field label="Éditeur *">
            <input className="input" value={form.publisher} onChange={set('publisher')} placeholder="Dargaud" required />
          </Field>
          <Field label="Date de parution">
            <input className="input" type="date" value={form.releaseDate} onChange={set('releaseDate')} />
          </Field>
          {/* Genre : menu déroulant (remplace l'ancien champ texte libre).
              Valeurs fixes, « Bande Dessinée » par défaut à l'initialisation. */}
          <Field label="Genre">
            <select className="input" value={form.genre} onChange={set('genre')}>
              {GENRE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ISBN">
            <input
              className="input font-mono"
              value={form.isbn}
              onChange={(e) => setForm((f) => ({ ...f, isbn: e.target.value.replace(/[^0-9xX]/g, '') }))}
              placeholder="9782205007664"
            />
          </Field>
          {/* Remplace l'ancien champ « État » : date d'ajout de la BD à la
              collection (défaut = date du jour lors de la création, modifiable).
              Stockée en base dans comics.added_date (DATE). */}
          <Field label="Date d'ajout">
            <input className="input" type="date" value={form.addedDate} onChange={set('addedDate')} />
          </Field>
        </div>

        <Field label="Synopsis (optionnel)">
          <textarea
            className="input min-h-[90px]"
            value={form.synopsis}
            onChange={set('synopsis')}
            placeholder="Résumé de l'album…"
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300 select-none">
            <input
              type="checkbox"
              className="accent-gold-500"
              checked={form.isSpecialEdition}
              onChange={(e) => setForm((f) => ({ ...f, isSpecialEdition: e.target.checked }))}
            />
            Édition spéciale
          </label>

          {/* "Livre dédicacé" : case booléenne alignée sur la même ligne,
                 poussée tout à droite (flex justify-between). */}
          <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-300 select-none">
            <input
              type="checkbox"
              className="accent-gold-500"
              checked={form.isSigned}
              onChange={(e) => setForm((f) => ({ ...f, isSigned: e.target.checked }))}
            />
            Livre dédicacé
          </label>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-night-600/50">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Enregistrement…' : isEdit ? 'Enregistrer les modifications' : 'Ajouter à ma collection'}
          </button>
          <button type="button" className="btn-ghost" onClick={() => navigate(-1)}>Annuler</button>
        </div>
      </form>

      <IsbnModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        // MODE 2 — IMPORT DIRECT PAR CODE-BARRES : la BD a déjà été CRÉÉE côté
        // backend (api.comics.importByIsbn) ; aucun pré-remplissage n'est
        // nécessaire — on quitte le formulaire et on confirme via le toast.
        onImport={(comic) => {
          navigate('/comics', { state: { toastKey: 'collection.importedComic', title: comic?.title || 'BD' } })
        }}
        onPrefill={(payload) => {
          // Mapping exhaustif : chaque champ renvoyé par IsbnModal est
          // appliqué au formulaire. Les valeurs vides sont ignorées afin
          // de ne pas écraser une saisie déjà présente.
          const clean = (v) =>
            (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim())
          const releaseDate = clean(payload.releaseDate)
          setForm((f) => ({
            ...f,
            title: clean(payload.title) || f.title,
            series: clean(payload.series) || f.series,
            tomeNumber: clean(payload.tomeNumber) || f.tomeNumber,
            authors: clean(payload.authors) || f.authors,
            illustrators: clean(payload.illustrators) || f.illustrators,
            publisher: clean(payload.publisher) || f.publisher,
            releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(releaseDate) ? releaseDate : f.releaseDate,
            // Menu déroulant : normalise le genre importé (ISBN) vers une option
            // du menu ; conserve la valeur courante si l'import ne fournit rien.
            genre: clean(payload.genre) ? normalizeGenre(clean(payload.genre)) : f.genre,
            isbn: clean(payload.isbn) || f.isbn,
            // Synopsis : résumé nettoyé fourni par l'API (description Google
            // Books / notes Open Library) — pré-remplit le champ optionnel.
            // S'il est vide mais qu'une BD de la même Série possède déjà un
            // synopsis, celui-ci sera copié automatiquement par l'effet
            // « auto-copie intelligente » ci-dessus (déclenché par form.series).
            synopsis: clean(payload.synopsis) || f.synopsis,
          }))
          // Couverture : URL distante — le backend la télécharge et la
          // stocke localement au moment de l'enregistrement.
          const cover = clean(payload.coverRemoteUrl)
          if (cover) setRemoteUrl(cover)
        }}
      />
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
