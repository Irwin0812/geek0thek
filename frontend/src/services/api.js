const TOKEN_KEY = 'geek0thek_token'
const USER_KEY = 'geek0thek_user'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY))
  } catch {
    return null
  }
}
export const saveSession = ({ token, user }) => {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
}
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let payload
  if (isForm) {
    payload = body
  } else if (body) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }

  const response = await fetch(`/api${path}`, {
    method,
    headers,
    body: payload,
  })

  if (response.status === 401) {
    clearSession()
    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign('/login')
    }
    throw new Error('Session expirée.')
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    // Sécurité à la première connexion : le backend refuse toute API
    // protégée tant que l'onboarding n'est pas validé (drapeau
    // must_change_password) -> redirection vers la page de forçage.
    if (response.status === 403 && data.code === 'must-change-password') {
      if (!window.location.pathname.startsWith('/onboarding')) {
        window.location.assign('/onboarding')
      }
      throw new Error(data.error || `Erreur serveur (${response.status})`)
    }
    throw new Error(data.error || `Erreur serveur (${response.status})`)
  }
  return data
}

export const api = {
  // --- Version / mise à jour (dépôt GitHub vs version déployée) ---
  // Renvoie { status: 'ok' | 'unknown', updateAvailable, deployed?, github? } :
  // le bouton « Mise à jour disponible » s'affiche UNIQUEMENT si
  // updateAvailable est TRUE (les deux commits diffèrent). En cas de doute
  // (API GitHub injoignable, quota atteint…), le backend renvoie
  // updateAvailable: false — jamais de faux positif.
  version: () => request('/version'),

  // --- Auth ---
  // login renvoie :
  //   - sans 2FA : { token, user } (session complète) ;
  //   - avec 2FA activée : { needsTotp: true, tempToken } — il faut alors
  //     appeler verifyTotp({ tempToken, code }) pour obtenir le JWT.
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: () => request('/auth/me'),
  // Sécurité à la première connexion : onboarding forcé. Body :
  // { currentPassword, newPassword, login? } -> { token, user }
  // (nouveau JWT + profil mis à jour, drapeau remis à FALSE côté base).
  onboarding: (payload) => request('/auth/onboarding', { method: 'POST', body: payload }),
  // 2FA (Google Authenticator / TOTP) : deuxième étape de la connexion.
  // Body { tempToken, code } -> { token, user }.
  verifyTotp: (payload) => request('/auth/verify-totp', { method: 'POST', body: payload }),
  // « Mot de passe ou identifiant oublié ? » — body { identifier } (login OU
  // e-mail). Réponse GÉNÉRIQUE dans tous les cas (aucune énumération) :
  // si un compte correspond, un e-mail contient l'identifiant + un lien de
  // réinitialisation temporaire (jeton à usage unique, validité 1 h).
  forgotPassword: (identifier) => request('/auth/forgot-password', { method: 'POST', body: { identifier } }),
  // Réinitialisation via le lien de l'e-mail — body { token, newPassword }.
  resetPassword: (payload) => request('/auth/reset-password', { method: 'POST', body: payload }),

  // --- 2FA (Google Authenticator / TOTP) — configuration depuis le profil ---
  totp: {
    // Démarre la configuration : -> { secret, otpauthUri } (clé stockée,
    // 2FA pas encore activée ; l'URI sert à générer le QR code).
    setup: () => request('/users/totp/setup', { method: 'POST' }),
    // Active la 2FA après confirmation d'un code valide : body { code }.
    enable: (code) => request('/users/totp/enable', { method: 'POST', body: { code } }),
    // Désactive la 2FA et efface la clé.
    disable: () => request('/users/totp/disable', { method: 'POST' }),
  },

  // --- Utilisateurs ---
  users: {
    list: () => request('/users'),
    // Membres (tout utilisateur authentifié, pas besoin d'être admin) :
    // comptes actifs + compteurs de collection — alimente la page
    // « Bibliothèques partagées » (choix des destinataires des partages).
    all: () => request('/users/all'),
    me: () => request('/users/me'),
    publicList: () => request('/users/public'),
    // body : objet JSON ou FormData (multipart, avatar en fichier)
    create: (payload) => request('/users', { method: 'POST', body: payload, isForm: payload instanceof FormData }),
    update: (id, payload) => request(`/users/${id}`, { method: 'PUT', body: payload, isForm: payload instanceof FormData }),
    updateMe: (payload) => request('/users/me', { method: 'PUT', body: payload, isForm: payload instanceof FormData }),
    // Langue préférée (endpoint dédié) : body { language: 'fr' | 'en' | ... }
    patchLanguage: (language) => request('/users/profile/language', { method: 'PATCH', body: { language } }),
    // Thème visuel préféré (endpoint dédié) : body
    // { theme: 'dark' | 'library' | 'vinyl' | 'comic' | 'comic-books' | 'neon' }
    // ('pastel', ex-« Pastel », accepté et résolu vers 'neon' — cf. backend)
    patchTheme: (theme) => request('/users/profile/theme', { method: 'PATCH', body: { theme } }),
    remove: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  },

  // --- Partage de bibliothèque (accès en consultation, lecture seule) ---
  // GET  -> { sharedWith: [...], sharedWithMe: [...] } : partages donnés par
  //          le compte courant + partages reçus (collections d'autrui).
  // POST -> body { userId, scope: 'vinyls' | 'comics' | 'all' } : ouverture de
  //          l'accès à SA collection pour un autre utilisateur (e-mail n°2).
  // DELETE /:id — retrait de l'accès (propriétaire ou admin uniquement).
  libraryShares: {
    list: () => request('/users/library-shares'),
    create: (payload) => request('/users/library-shares', { method: 'POST', body: payload }),
    remove: (id) => request(`/users/library-shares/${id}`, { method: 'DELETE' }),
  },

  // --- Disques ---
  vinyls: {
    mine: (q) => request(`/vinyls${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    byUser: (userId, q) => request(`/vinyls/user/${userId}${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    publicList: (params = {}) => {
      const qs = new URLSearchParams()
      if (params.q) qs.set('q', params.q)
      if (params.genre) qs.set('genre', params.genre)
      if (params.label) qs.set('label', params.label)
      const str = qs.toString()
      return request(`/vinyls/public${str ? `?${str}` : ''}`)
    },
    get: (id) => request(`/vinyls/${id}`),
    // body : FormData (multipart, jaquette en fichier) ou objet JSON (jaquette en URL distante)
    create: (data) => request('/vinyls', { method: 'POST', body: data, isForm: data instanceof FormData }),
    update: (id, data) =>
      request(`/vinyls/${id}`, { method: 'PUT', body: data, isForm: data instanceof FormData }),
    remove: (id) => request(`/vinyls/${id}`, { method: 'DELETE' }),
  },

  // --- MusicBrainz ---
  musicbrainz: {
    status: () => request('/musicbrainz/status'),
    barcode: (code) => request(`/musicbrainz/barcode/${code}`),
    // Recherche TEXTUELLE par mots-clés (EAN/UPC ou « artiste titre ») :
    // CASCADE STRICTE 1. Last.fm (prioritaire, jaquettes) -> 2. Discogs ->
    // 3. MusicBrainz. Renvoie { success, data, providers?, warnings? },
    // data = fiche normalisée (mêmes champs que le scan par code-barres).
    // Mêmes conventions que isbn.search (BD) : ?q=<mots-clés> (cf. GET
    // /api/musicbrainz/keyword?q=…) — la CASCADE est appliquée côté serveur
    // en ordre strict (Last.fm d'abord, jamais en parallèle).
    keyword: (q) => request(`/musicbrainz/keyword?q=${encodeURIComponent(q)}`)
  },

  // --- Discogs (complément de MusicBrainz, recherche par code-barres) ---
  discogs: {
    status: () => request('/discogs/status'),
    barcode: (code) => request(`/discogs/barcode/${code}`)
  },

  // --- BD (comics) ---
  comics: {
    mine: (q) => request(`/comics${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    byUser: (userId, q) => request(`/comics/user/${userId}${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    publicByUser: (userId) => request(`/comics/public/user/${userId}`),
    get: (id) => request(`/comics/${id}`),
    // data : FormData (multipart, couverture en fichier) ou objet JSON (couverture en URL)
    create: (data) => request('/comics', { method: 'POST', body: data, isForm: data instanceof FormData }),
    update: (id, data) =>
      request(`/comics/${id}`, { method: 'PUT', body: data, isForm: data instanceof FormData }),
    remove: (id) => request(`/comics/${id}`, { method: 'DELETE' }),
    // Import PAR CODE-BARRES (ISBN) : Google Books d'abord, Open Library en
    // secours — création DIRECTE de la BD associée à sa SÉRIE (image auto ou
    // repli img/no_title.jpg). data : FormData (optionnel, pour l'image de
    // série manuelle « seriesImage ») ou absent (création simple).
    importByIsbn: (isbn, data) =>
      request(`/comics/import/isbn/${encodeURIComponent(isbn)}`, {
        method: 'POST',
        body: data,
        isForm: data instanceof FormData,
      }),
  },

  // --- Tableau de bord (agrégat multimédia) ---
  // « Dernier ajout » GLOBAL : tous les types de médias existant en base
  // (actuellement `vinyls` + `comics`) sont comparés par la date d'ajout
  // métier ; les futures bibliothèques (books / board_games / video_games)
  // seront intégrées par le backend sans changement côté client. Répond :
  // { counts: { vinyls, comics }, lastAdd: null | { id, mediaType, title,
  //   addedDate, item } } — « item » = DTO normalisé du type d'origine.
  dashboard: {
    latest: () => request('/dashboard'),
  },

  // --- ISBN (Google Books / Open Library) ---
  isbn: {
    lookup: (isbn) => request(`/isbn/lookup/${encodeURIComponent(isbn)}`),
    // Recherche TEXTUELLE par mots-clés (titre / auteur / série) : Google Books
    // « q=… » — secours quand l'ISBN / code-barres échoue. Renvoie { data: [...] }
    // (liste éventuellement vide) de fiches normalisées (mêmes champs que lookup).
    search: (q, maxResults = 10) =>
      request(`/isbn/search?q=${encodeURIComponent(q)}&maxResults=${Math.min(Math.max(maxResults, 1), 20)}`),
  },
}
