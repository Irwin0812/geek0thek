/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/**
 * Client GitHub — vérification de mise à jour (GitHub Releases).
 *
 * Compare la version LOCALE de l'application (variable d'environnement
 * APP_VERSION, sinon le champ « version » du package.json du backend) avec
 * le tag de la dernière Release officielle publiée sur GitHub
 * (https://api.github.com/repos/<repo>/releases/latest).
 *
 * Règle d'affichage côté frontend : le bouton « Mise à jour disponible »
 * n'apparaît QUE si une Release est publiée avec un numéro de version
 * supérieur (ou différent) de la version installée localement — il ne se
 * déclenche plus à chaque commit sur main. Il disparaît automatiquement
 * après une mise à jour effective (la version locale rejoint le tag).
 *
 * Tolérance aux pannes : AUCUNE erreur ne remonte au client. Si aucune
 * release n'est publiée (404 « No releases published »), si l'API GitHub est
 * injoignable ou si le quota est atteint, l'endpoint renvoie { status:
 * 'unknown', updateAvailable: false } : le bouton reste simplement masqué
 * (jamais de faux positif).
 */

const env = require('../config/env');

// Dépôt GitHub de référence (releases officielles).
const GITHUB_REPO = env.github.repo;
const GITHUB_API = 'https://api.github.com';

/** Normalise une chaîne de version : retire le préfixe « v » et les espaces. */
function normalizeVersion(raw) {
  return String(raw || '').replace(/^v/i, '').trim();
}

/**
 * Version locale de l'application : variable d'environnement APP_VERSION en
 * priorité, sinon le champ « version » du package.json du backend.
 * Renvoie la version normalisée (ex. « 1.2.0 ») ou '' si introuvable.
 */
function getLocalVersion() {
  const fromEnv = normalizeVersion(process.env.APP_VERSION);
  if (fromEnv) return fromEnv;
  try {
    // eslint-disable-next-line global-require
    const pkg = require('../../package.json');
    return normalizeVersion(pkg.version);
  } catch {
    return '';
  }
}

/**
 * Comparaison de versions sémantiques : renvoie true si `remote` est
 * SUPÉRIEURE à `local`. Si les deux chaînes sont parseables en semver
 * (x.y.z), comparaison numérique composante par composante ; sinon repli sur
 * l'inégalité stricte des chaînes normalisées.
 */
function isRemoteNewer(remote, local) {
  const parse = (v) => v.split('.').map((p) => parseInt(p, 10));
  const r = parse(remote);
  const l = parse(local);
  if (r.length >= 2 && l.length >= 2 && r.every(Number.isFinite) && l.every(Number.isFinite)) {
    for (let i = 0; i < Math.max(r.length, l.length); i++) {
      const a = r[i] || 0;
      const b = l[i] || 0;
      if (a !== b) return a > b;
    }
    return false; // versions égales
  }
  return remote !== local;
}

/**
 * Dernière Release officielle du dépôt GitHub.
 * Renvoie { tag, version } ou null : aucune release publiée (« No releases
 * published » → 404), API injoignable, quota atteint… Dans ce cas le bouton
 * reste masqué et le footer masque son libellé « Version: … » (jamais
 * d'erreur affichée).
 */
async function getLatestRelease() {
  // User-Agent explicite OBLIGATOIRE : l'API GitHub refuse les requêtes sans
  // User-Agent (403).
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Geek0thek-App',
    'Cache-Control': 'no-cache',
  };
  if (env.github.token) headers.Authorization = `Bearer ${env.github.token}`;

  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/releases/latest`, { headers });
    if (!res.ok) return null; // 404 = « No releases published »
    const release = await res.json();
    if (!release || !release.tag_name) return null;
    const version = normalizeVersion(release.tag_name);
    return { tag: release.tag_name, version };
  } catch {
    return null;
  }
}

/**
 * Statut de mise à jour : compare la version locale au tag de la dernière
 * Release GitHub.
 *   - updateAvailable : TRUE uniquement si une release est publiée et que sa
 *     version est supérieure (ou différente) de la version locale.
 *   - status : 'ok' (comparaison possible) | 'unknown' (impossible — bouton
 *     masqué).
 *   - localVersion / remoteVersion : versions normalisées (sans « v »).
 *   - release : { tag, version } ou null (aucune publiée — le footer masque
 *     alors son libellé « Version: … »).
 */
async function getUpdateStatus() {
  const localVersion = getLocalVersion();
  const release = await getLatestRelease();

  if (!release || !localVersion) {
    return {
      status: 'unknown',
      updateAvailable: false,
      localVersion: localVersion || null,
      remoteVersion: null,
      release,
    };
  }

  const updateAvailable = isRemoteNewer(release.version, localVersion);
  return {
    status: 'ok',
    updateAvailable,
    localVersion,
    remoteVersion: release.version,
    release,
  };
}

module.exports = { getUpdateStatus, GITHUB_REPO };
