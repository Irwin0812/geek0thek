/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
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

/**
 * Construit l'Error levée par `request` : le message est celui du backend
 * (data.error) et le champ `code` porte le CODE D'ERREUR stable renvoyé par
 * le backend (ex. 'barcode-not-found', 'isbn-not-found', 'search-unavailable')
 * — les composants frontend le MAPPENT sur des clés i18n (6 langues) au lieu
 * d'afficher un message codé en français tel quel.
 */
function toApiError(data, status) {
  const err = new Error((data && data.error) || `Erreur serveur (${status})`)
  if (data && data.code) err.code = data.code
  return err
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
    // Redirection vers /login avec le paramètre explicite ?expired=true :
    // c'est UNIQUEMENT la présence de ce paramètre qui déclenche l'affichage
    // de l'alerte « Session expirée. » sur la page de connexion (Login.jsx).
    // Sans lui, un simple retour sur /login (déconnexion volontaire, F5…)
    // ne doit afficher AUCUN message d'erreur par défaut.
    if (!window.location.pathname.startsWith('/login')) {
      window.location.assign('/login?expired=true')
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
      throw toApiError(data, response.status)
    }
    throw toApiError(data, response.status)
  }
  return data
}

export const api = {
  // --- Version / mise à jour (SHA local embarqué vs dernier commit main) ---
  // Renvoie { status: 'ok' | 'unknown', updateAvailable, localCommit?,
  // remoteCommit? } : le bouton « Mise à jour disponible » s'affiche
  // UNIQUEMENT si updateAvailable est TRUE (le SHA de l'image Docker en cours
  // diffère du dernier commit publié sur main). En cas de doute (SHA local
  // inconnu, API GitHub injoignable, quota atteint…), le backend renvoie
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
    // DON / SOUTIEN AU PROJET (PayPal) : enregistre le statut de donateur du
    // compte courant (users.is_donor = TRUE) et déclenche l'e-mail de MERCI.
    // Idempotent : un compte déjà donateur ne reçoit pas un second e-mail.
    // Body { userId } facultatif (admin uniquement, défaut : soi).
    recordDonation: (payload) => request('/users/donation', { method: 'POST', body: payload || {} }),
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

  // --- Export / Import de la collection (menu « Exporter / Importer ») ---
  // JSON : sauvegarde COMPLÈTE ET RELATIONNELLE (disques + BD + entités
  // Artistes/Séries). L'export renvoie l'objet JSON brut (le frontend le
  // sérialise et le télécharge en fichier — jamais de Blob par l'API).
  exportImport: {
    // -> { app, version, exportedAt, vinyls, comics, artists, series }
    exportJson: () => request('/export-import/export/json'),
    // body { mode: 'merge' | 'replace', vinyls, comics }
    // -> { imported: { vinyls, comics }, skipped: { vinyls, comics } }
    importJson: (payload) => request('/export-import/import/json', { method: 'POST', body: payload }),
    // -> CSV brut (text/csv + BOM UTF-8) : le frontend le télécharge en fichier.
    exportCsv: async (collection) => {
      const token = getToken()
      const response = await fetch(`/api/export-import/export/csv?collection=${encodeURIComponent(collection)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw toApiError(data, response.status)
      }
      return response.text()
    },
    // body { collection: 'vinyls' | 'comics', mode, rows: [objets à clés canoniques] }
    // -> { collection, imported, skipped }
    importCsv: (payload) => request('/export-import/import/csv', { method: 'POST', body: payload }),
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
