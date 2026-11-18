/*
 * Copyright (C) 2026 Irwin
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License.
 */
/**
 * Client GitHub — vérification de mise à jour (dépôt vs version déployée).
 *
 * Compare le commit du code DÉPLOYÉ (HEAD du dépôt git monté en lecture seule
 * dans le conteneur backend, cf. docker-compose.yml — avec fallback sur
 * process.env.GIT_COMMIT / version.json générés au build quand .git est absent
 * de l'image) avec le dernier commit de la branche de référence (GITHUB_BRANCH,
 * défaut « main ») du dépôt GitHub (https://github.com/Irwin0812/geek0thek).
 *
 * Règle d'affichage côté frontend : le bouton « Mise à jour disponible »
 * n'apparaît QUE si les deux SHA diffèrent — il disparaît donc automatiquement
 * après un `git pull && docker compose up -d --build` (le commit déployé
 * rejoint alors la HEAD de GitHub).
 *
 * Tolérance aux pannes : AUCUNE erreur ne remonte au client. Si le dépôt local
 * est absent (ex. build sans .git), si l'API GitHub est injoignable, ou si le
 * quota est atteint, l'endpoint renvoie { status: 'unknown', updateAvailable:
 * false } : le bouton reste simplement masqué (jamais de faux positif).
 */

const fs = require('fs');
const path = require('path');
const env = require('../config/env');

// Dépôt GitHub de référence (branche par défaut du dépôt).
const GITHUB_REPO = env.github.repo;
// Branche GitHub de référence pour la comparaison (défaut « main ») —
// surchargeable par instance via GITHUB_BRANCH.
const GITHUB_BRANCH = env.github.branch;
const GITHUB_API = 'https://api.github.com';

// Répertoire du dépôt git DÉPLOYÉ : en production le conteneur backend monte
// /opt/geek0thek (racine du repo sur la VM) en lecture seule sur /repo —
// c'est exactement le commit que `git pull` a installé. En développement
// local, on retombe sur le dépôt courant (backend/..).
const LOCAL_REPO_DIR = env.github.localRepoDir;

/** Lit une ligne de fichier texte (tolère CRLF / BOM), null si absent. */
function readFirstLine(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const line = raw.split(/\r?\n/, 1)[0];
    return line.replace(/^\uFEFF/, '').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Résout le commit du code déployé, dans l'ordre :
 *   1) HEAD du dépôt local (réf de la branche courante) — c'est exactement le
 *      commit installé par `git pull` (dossier .git monté en lecture seule
 *      dans le conteneur backend, cf. docker-compose.yml).
 *   2) Fallback Docker : `process.env.GIT_COMMIT` (injectée au build via
 *      ARG/ENV GIT_COMMIT dans le Dockerfile) ou le fichier `version.json`
 *      généré au build ({ "commit": "<sha>" }) — indispensable quand le
 *      dossier .git est absent de l'image.
 * Renvoie { sha, branch } ou null si aucune source n'est lisible (l'endpoint
 * renvoie alors status « unknown » et le bouton reste masqué : jamais de faux
 * positif).
 */
function getDeployedCommit() {
  const gitDir = path.join(LOCAL_REPO_DIR, '.git');
  try {
    const headRef = readFirstLine(path.join(gitDir, 'HEAD'));
    if (headRef && headRef.startsWith('ref:')) {
      // « ref: refs/heads/main » → chemin de la réf relatif à .git.
      const refPath = headRef.replace(/^ref:\s*/, '').trim();
      const branch = refPath.replace(/^refs\/heads\//, '');
      // 1) Réf « loose » (.git/refs/heads/<branch>) — le cas normal après un
      //    `git pull`. 2) Sinon réf « packée » (.git/packed-refs) — cas courant
      //    après un `git gc` / `git pack-refs`.
      let sha = readFirstLine(path.join(gitDir, refPath));
      if (!sha || !/^[0-9a-f]{40}$/i.test(sha)) {
        const packed = readPackedRef(gitDir, refPath);
        if (packed) sha = packed;
      }
      if (sha && /^[0-9a-f]{40}$/i.test(sha)) {
        return { sha: sha.toLowerCase(), branch };
      }
    }
  } catch {
    /* dépôt local absent ou illisible */
  }

  // Fallback Docker : hash injecté au build (ARG/ENV GIT_COMMIT) — le conteneur
  // ne contient pas de dossier .git, mais l'image est construite depuis un
  // checkout git précis (GitHub Actions), donc le SHA est connu au build.
  const envSha = String(process.env.GIT_COMMIT || '').trim().toLowerCase();
  if (/^[0-9a-f]{7,40}$/.test(envSha)) {
    return { sha: envSha, branch: GITHUB_BRANCH };
  }

  // Fallback Docker : version.json généré au build ({ "commit": "<sha>" }).
  try {
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'version.json'), 'utf8');
    const parsed = JSON.parse(raw);
    const fileSha = String((parsed && parsed.commit) || '').trim().toLowerCase();
    if (/^[0-9a-f]{7,40}$/.test(fileSha)) {
      return { sha: fileSha, branch: GITHUB_BRANCH };
    }
  } catch {
    /* version.json absent : rien à faire */
  }

  return null;
}

/**
 * Cherche une réf dans .git/packed-refs (format « <sha> refs/heads/<branch> »),
 * en ignorant les lignes de commentaire (#). Renvoie la SHA ou null.
 */
function readPackedRef(gitDir, refPath) {
  try {
    const raw = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [sha, ref] = trimmed.split(/\s+/);
      if (ref === refPath && /^[0-9a-f]{40}$/i.test(sha)) return sha;
    }
  } catch {
    /* packed-refs absent : rien à faire */
  }
  return null;
}

/**
 * Dernier commit de la branche de référence du dépôt GitHub
 * (GITHUB_BRANCH, défaut « main »). Renvoie { sha, branch, message } ou null
 * (API injoignable / quota / 404).
 */
async function getGitHubHead() {
  // User-Agent explicite OBLIGATOIRE : l'API GitHub refuse les requêtes sans
  // User-Agent (403) — c'était la cause du silence de l'indicateur.
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Geek0thek-App',
    'Cache-Control': 'no-cache',
  };
  if (env.github.token) headers.Authorization = `Bearer ${env.github.token}`;

  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${GITHUB_REPO}/commits/${encodeURIComponent(GITHUB_BRANCH)}?per_page=1`,
      { headers }
    );
    if (!res.ok) return null;
    const [commit] = await res.json();
    if (!commit || !commit.sha) return null;
    return {
      sha: commit.sha.toLowerCase(),
      branch: GITHUB_BRANCH,
      message: (commit.commit && commit.commit.message || '').split('\n')[0],
    };
  } catch {
    return null;
  }
}

/**
 * Dernière Release officielle du dépôt GitHub (tag, ex. « v1.0.0 »).
 * Renvoie { tag } ou null si AUCUNE release n'est publiée (404 — état
 * « No releases published »), l'API est injoignable ou le quota est atteint :
 * le footer masque alors complètement le libellé « Version: … ».
 */
async function getLatestRelease() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Geek0thek-App',
    'Cache-Control': 'no-cache',
  };
  if (env.github.token) headers.Authorization = `Bearer ${env.github.token}`;

  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}/releases/latest`, { headers });
    if (!res.ok) return null; // 404 = aucune release publiée
    const release = await res.json();
    if (!release || !release.tag_name) return null;
    return { tag: release.tag_name };
  } catch {
    return null;
  }
}

/**
 * Statut de mise à jour : compare le commit déployé au HEAD GitHub.
 *   - updateAvailable : TRUE uniquement si les deux SHA sont connus et DIFFÉRENTS.
 *   - status : 'ok' (comparaison possible) | 'unknown' (impossible — bouton masqué).
 *   - release : { tag } de la dernière Release GitHub officielle, ou null si
 *     aucune release publiée (le footer masque alors le libellé de version).
 */
async function getUpdateStatus() {
  const [deployed, remote, release] = await Promise.all([
    Promise.resolve(getDeployedCommit()),
    getGitHubHead(),
    getLatestRelease(),
  ]);

  if (!deployed || !remote) {
    return { status: 'unknown', updateAvailable: false, deployed: null, github: null, release };
  }

  return {
    status: 'ok',
    updateAvailable: deployed.sha !== remote.sha,
    deployed: { sha: deployed.sha, shortSha: deployed.sha.slice(0, 7), branch: deployed.branch },
    github: { sha: remote.sha, shortSha: remote.sha.slice(0, 7), branch: remote.branch, message: remote.message },
    release,
  };
}

module.exports = { getUpdateStatus, GITHUB_REPO };
