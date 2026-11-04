/**
 * Client GitHub — vérification de mise à jour (dépôt vs version déployée).
 *
 * Compare le commit du code DÉPLOYÉ (résolu localement depuis le dépôt git
 * monté en lecture seule dans le conteneur backend, cf. docker-compose.yml)
 * avec le dernier commit de la branche par défaut du dépôt GitHub
 * (https://github.com/Irwin0812/geek0thek).
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
 * Résout le commit du code déployé : HEAD du dépôt local (réf de la branche
 * courante) — c'est exactement le commit installé par `git pull`. Renvoie
 * { sha, branch } ou null si le dépôt local est absent / illisible (l'endpoint
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
 * Dernier commit de la branche par défaut du dépôt GitHub.
 * Renvoie { sha, branch, message } ou null (API injoignable / quota / 404).
 */
async function getGitHubHead() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'Geek0thek' };
  if (env.github.token) headers.Authorization = `Bearer ${env.github.token}`;

  let repo;
  try {
    const res = await fetch(`${GITHUB_API}/repos/${GITHUB_REPO}`, { headers });
    if (!res.ok) return null;
    repo = await res.json();
  } catch {
    return null;
  }

  try {
    const res = await fetch(
      `${GITHUB_API}/repos/${GITHUB_REPO}/commits?per_page=1`,
      { headers }
    );
    if (!res.ok) return null;
    const [commit] = await res.json();
    if (!commit || !commit.sha) return null;
    return {
      sha: commit.sha.toLowerCase(),
      branch: repo.default_branch,
      message: (commit.commit && commit.commit.message || '').split('\n')[0],
    };
  } catch {
    return null;
  }
}

/**
 * Statut de mise à jour : compare le commit déployé au HEAD GitHub.
 *   - updateAvailable : TRUE uniquement si les deux SHA sont connus et DIFFÉRENTS.
 *   - status : 'ok' (comparaison possible) | 'unknown' (impossible — bouton masqué).
 */
async function getUpdateStatus() {
  const deployed = getDeployedCommit();
  const remote = await getGitHubHead();

  if (!deployed || !remote) {
    return { status: 'unknown', updateAvailable: false, deployed: null, github: null };
  }

  return {
    status: 'ok',
    updateAvailable: deployed.sha !== remote.sha,
    deployed: { sha: deployed.sha, shortSha: deployed.sha.slice(0, 7), branch: deployed.branch },
    github: { sha: remote.sha, shortSha: remote.sha.slice(0, 7), branch: remote.branch, message: remote.message },
  };
}

module.exports = { getUpdateStatus, GITHUB_REPO };
