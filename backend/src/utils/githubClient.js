/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/**
 * Client GitHub — détection des nouveaux commits sur la branche main.
 *
 * Compare le SHA du commit LOCAL (embarqué dans l'image Docker en cours
 * d'exécution) avec le dernier commit publié sur la branche de référence
 * (https://api.github.com/repos/<repo>/commits/main).
 *
 * Source du SHA local, par ordre de priorité :
 *   1. process.env.GIT_COMMIT — injecté dans l'image au build par GitHub
 *      Actions (--build-arg GIT_COMMIT=${{ github.sha }}, cf. Dockerfile) ;
 *   2. /app/version.json — généré au build (2e source de vérité embarquée) ;
 *   3. `git rev-parse HEAD` dans LOCAL_REPO_DIR — fallback local quand le
 *      conteneur monte le .git du dépôt déployé en lecture seule.
 *
 * Règle d'affichage côté frontend : le bouton « Mise à jour disponible »
 * n'apparaît QUE si le SHA local est valide (≠ 'unknown') et DIFFÉRENT du
 * dernier commit distant (comparaison normalisée en minuscules). Dès que
 * l'admin exécute `docker compose pull && docker compose up -d
 * --remove-orphans`, le nouveau conteneur démarre avec GIT_COMMIT === SHA
 * distant : la comparaison devient égale et le bouton disparaît
 * automatiquement.
 *
 * Tolérance aux pannes : AUCUNE erreur ne remonte au client. Si le SHA local
 * est introuvable, si l'API GitHub est injoignable ou si le quota est atteint,
 * l'endpoint renvoie { status: 'unknown', updateAvailable: false } : le
 * bouton reste simplement masqué (jamais de faux positif).
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const env = require('../config/env');

// Dépôt GitHub de référence (branche main).
const GITHUB_REPO = env.github.repo;
const GITHUB_BRANCH = env.github.branch;
const GITHUB_API = 'https://api.github.com';

/** Normalise un SHA : minuscules, sans espaces. */
function normalizeSha(raw) {
  return String(raw || '').trim().toLowerCase();
}

/** Un SHA est « valide » s'il ressemble à un hash git (7+ hexadécimaux). */
function isValidSha(sha) {
  return /^[0-9a-f]{7,40}$/.test(normalizeSha(sha));
}

/**
 * SHA du commit local embarqué dans l'image Docker :
 *   1. process.env.GIT_COMMIT (build-arg GitHub Actions) ;
 *   2. /app/version.json (généré au build par le Dockerfile) ;
 *   3. `git rev-parse HEAD` dans LOCAL_REPO_DIR (fallback local — .git monté
 *      en lecture seule dans le conteneur backend).
 * Renvoie le SHA normalisé (minuscules) ou '' si introuvable.
 */
function getLocalCommit() {
  const fromEnv = normalizeSha(process.env.GIT_COMMIT);
  if (isValidSha(fromEnv)) return fromEnv;

  try {
    const versionFile = path.join(__dirname, '..', '..', 'version.json');
    const parsed = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    const fromFile = normalizeSha(parsed && parsed.commit);
    if (isValidSha(fromFile)) return fromFile;
  } catch {
    /* version.json absent ou illisible : on tente le fallback git */
  }

  try {
    const repoDir = env.github.localRepoDir;
    if (repoDir && fs.existsSync(path.join(repoDir, '.git'))) {
      const sha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repoDir,
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      if (isValidSha(sha)) return normalizeSha(sha);
    }
  } catch {
    /* .git absent ou git indisponible : aucun SHA local */
  }

  return '';
}

/**
 * Dernier commit publié sur la branche de référence (main).
 * Renvoie { sha, message, url } ou null : API GitHub injoignable, quota
 * atteint, dépôt introuvable… Dans ce cas le bouton reste masqué et jamais
 * d'erreur affichée.
 */
async function getLatestCommit() {
  // User-Agent explicite OBLIGATOIRE : l'API GitHub refuse les requêtes sans
  // User-Agent (403). Cache-Control: no-cache pour ne jamais servir un commit
  // obsolète depuis un cache intermédiaire.
  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Geek0thek-App',
    'Cache-Control': 'no-cache',
  };
  if (env.github.token) headers.Authorization = `Bearer ${env.github.token}`;

  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.sha) return null;
    return {
      sha: normalizeSha(data.sha),
      message: String((data.commit && data.commit.message) || '').split('\n')[0],
      url: data.html_url || `https://github.com/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`,
    };
  } catch {
    return null;
  }
}

/**
 * Statut de mise à jour : compare le SHA local (image Docker en cours) au
 * dernier commit distant de la branche main.
 *   - updateAvailable : TRUE uniquement si le SHA local est valide (≠
 *     'unknown') et DIFFÉRENT du SHA distant (comparaison minuscules).
 *   - status : 'ok' (comparaison possible) | 'unknown' (impossible — bouton
 *     masqué).
 *   - localCommit / remoteCommit : SHAs normalisés (minuscules) ou null.
 */
async function getUpdateStatus() {
  const localCommit = getLocalCommit();
  const remote = await getLatestCommit();

  if (!remote || !isValidSha(localCommit)) {
    return {
      status: 'unknown',
      updateAvailable: false,
      localCommit: isValidSha(localCommit) ? localCommit : null,
      remoteCommit: remote ? remote.sha : null,
      commit: remote,
    };
  }

  const updateAvailable = localCommit !== remote.sha;
  return {
    status: 'ok',
    updateAvailable,
    localCommit,
    remoteCommit: remote.sha,
    commit: remote,
  };
}

module.exports = { getUpdateStatus, GITHUB_REPO };
