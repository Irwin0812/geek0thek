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
    throw new Error(data.error || `Erreur serveur (${response.status})`)
  }
  return data
}

export const api = {
  // --- Auth ---
  login: (payload) => request('/auth/login', { method: 'POST', body: payload }),
  me: () => request('/auth/me'),

  // --- Utilisateurs ---
  users: {
    list: () => request('/users'),
    me: () => request('/users/me'),
    publicList: () => request('/users/public'),
    // body : objet JSON ou FormData (multipart, avatar en fichier)
    create: (payload) => request('/users', { method: 'POST', body: payload, isForm: payload instanceof FormData }),
    update: (id, payload) => request(`/users/${id}`, { method: 'PUT', body: payload, isForm: payload instanceof FormData }),
    updateMe: (payload) => request('/users/me', { method: 'PUT', body: payload, isForm: payload instanceof FormData }),
    // Langue préférée (endpoint dédié) : body { language: 'fr' | 'en' | ... }
    patchLanguage: (language) => request('/users/profile/language', { method: 'PATCH', body: { language } }),
    // Thème visuel préféré (endpoint dédié) : body
    // { theme: 'dark' | 'library' | 'vinyl' | 'comic' | 'cartoon' | 'pastel' }
    patchTheme: (theme) => request('/users/profile/theme', { method: 'PATCH', body: { theme } }),
    remove: (id) => request(`/users/${id}`, { method: 'DELETE' }),
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
