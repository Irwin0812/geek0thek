# 💿📚 Geek0thek — Médiathèque Personnelle

Application web full-stack conteneurisée pour la gestion de collections de
**Vinyles** et de **Bandes Dessinées** (BD / Mangas / Comics) : thème sombre
natif, UI soignée, stockage local des couvertures.

| Couche | Technologie |
|---|---|
| Backend | **Node.js 22** + **Express** (API REST, JWT, Helmet, CORS, Multer) |
| Frontend | **React 18** (Vite) + **Tailwind CSS 3** |
| Base de données | **PostgreSQL 16** (persistance locale via volume Docker) |
| Stockage images | Dossier local `./uploads` monté dans le conteneur backend (sous-dossiers `vinyls/` et `comics/`) |
| APIs vinyles | **MusicBrainz** + **Cover Art Archive** (sans clé API) **+ Discogs** (jeton `DISCOGS_TOKEN` requis) — import par **code-barres (EAN/UPC)** |
| APIs BD | **Google Books** + **Open Library** (pré-remplissage automatique par **ISBN**, sans clé API) |
| Déploiement | **Docker Compose** — cible **Debian 12**, IP `172.16.2.75`, reverse-proxy friendly |

Fonctionnalités clés :

- Authentification **login + mot de passe (bcrypt)** avec JWT, rôles `admin` / `user`.
- Admin de test principal créé à l'initialisation : `admin` / `admin` — **prêt à
  l'emploi** (drapeau `must_change_password = FALSE`, connexion directe sans
  onboarding forcé). Les données, collections et réglages du compte sont
  conservés lors d'une réinitialisation.
- **Vinyles** : import par **code-barres (EAN/UPC)** interrogeant **MusicBrainz**
  (fiche de référence : titre, artiste, date, label, tracklist, MBID)
  **+ Discogs en complément** (si jeton configuré : date, label, genre,
  miniature, id de la release + URL de la fiche), ou saisie manuelle complète.
- **BDs** : pré-remplissage par **ISBN** (Google Books, Open Library en secours) ou
  saisie manuelle complète (série, tome, auteurs, illustrateurs, éditeur…).
- **Visibilité publique/privée** de chaque collection (toggle dans le tableau de bord),
  appliquée aux vinyles **et** aux BDs.
- **Stockage local des couvertures** sur le disque de la VM hôte
  (`./uploads/vinyls` et `./uploads/comics`) — les images distantes
  (MusicBrainz / Cover Art Archive, **Discogs**, Google Books, Open Library)
  sont **téléchargées et ré-hébergées localement**.
- Pages **Collections publiques** (lecture seule, sans compte) : vinyles + BDs.
- Compatible **reverse proxy externe** (`X-Forwarded-For`, `X-Forwarded-Proto`, WebSocket).

---

## 📂 Arborescence du projet

```text
geek0thek/
├── .env.example               # Variables d'environnement (template)
├── docker-compose.yml         # Orchestration : db + backend + frontend
├── README.md
├── database/
│   └── init.sql               # Schéma (users, vinyls, comics, vues) + seed de l'admin admin/admin (bcrypt coût 12, must_change_password = FALSE)
├── uploads/                   # Volume local des couvertures (disque de la VM hôte)
│   ├── vinyls/                # Jaquettes de disques (créé automatiquement au 1er démarrage)
│   └── comics/                # Couvertures de BD (créé automatiquement au 1er démarrage)
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js          # App Express, statique /uploads, proxy trust, routes
│       ├── config/
│       │   ├── db.js          # Pool PostgreSQL (pg)
│       │   └── env.js         # Configuration centralisée (env)
│       ├── middlewares/
│       │   ├── auth.js        # JWT (authenticate) + requireAdmin
│       │   └── upload.js      # Multer -> /app/uploads/vinyls | /app/uploads/comics (noms aléatoires)
│       ├── controllers/
│       │   ├── authController.js
│       │   ├── userController.js
│       │   ├── vinylController.js
│       │   ├── musicBrainzController.js
│       │   ├── discogsController.js
│       │   ├── comicController.js
│       │   └── isbnController.js
│       ├── routes/
│       │   ├── authRoutes.js
│       │   ├── userRoutes.js
│       │   ├── vinylRoutes.js
│       │   ├── musicBrainzRoutes.js
│       │   ├── discogsRoutes.js
│       │   ├── comicRoutes.js
│       │   └── isbnRoutes.js
│       └── utils/
│           ├── musicBrainzClient.js # MusicBrainz + Cover Art Archive : recherche par barcode + téléchargement local
│           ├── discogsClient.js     # Discogs : recherche par code-barres (jeton requis) + identifiants release
│           └── isbnClient.js      # Google Books / Open Library par ISBN + téléchargement local
└── frontend/
    ├── Dockerfile             # Build Vite multi-étapes -> nginx alpine
    ├── nginx.conf             # SPA + proxy /api & /uploads (headers X-Forwarded-*)
    ├── package.json
    ├── tailwind.config.js
    └── src/
        ├── App.jsx            # Routage + contexte d'authentification
        ├── index.css          # Thème sombre (Tailwind, palette "night"/"gold")
        ├── main.jsx
        ├── components/
        │   ├── Navbar.jsx
        │   ├── ProtectedRoute.jsx
        │   ├── VinylCard.jsx
        │   ├── BarcodeModal.jsx
        │   ├── ComicCard.jsx
        │   └── IsbnModal.jsx
        ├── pages/
        │   ├── Login.jsx
        │   ├── Onboarding.jsx         # Sécurité 1re connexion : forçage du changement de mot de passe (+ pseudo)
        │   ├── Dashboard.jsx
        │   ├── Collection.jsx         # Vinyles de l'utilisateur
        │   ├── ComicCollection.jsx    # BDs de l'utilisateur
        │   ├── PublicCollection.jsx   # Collections publiques (vinyles + BDs)
        │   ├── AddVinyl.jsx
        │   ├── AddComic.jsx
        │   └── AdminUsers.jsx
        └── services/
            └── api.js         # Client REST (JWT, multipart, gestion 401)
```

---

## ⚙️ Spécifications système minimales

L'application tourne sous **Docker Compose** avec **3 conteneurs** : PostgreSQL 16,
backend Node.js 22 (API Express) et frontend nginx. Les spécifications ci-dessous
sont celles recommandées pour l'exécuter **sereinement** sur la VM hôte.

### Matériel

| Ressource | Minimum | Recommandé |
|---|---|---|
| **CPU** | 2 cœurs (vCPU) | 4 cœurs (vCPU) |
| **Mémoire RAM** | 2 Go | 4 Go |
| **Espace disque libre** | 10 Go | 30 Go+ (les couvertures téléversées/téléchargées s'accumulent dans `./uploads`) |
| **Réseau** | Connexion internet sortante (egress) | — |

> **Répartition indicative de la RAM** : PostgreSQL ~500 Mo, backend Node.js
> ~300 Mo, nginx ~50 Mo, le reste pour l'OS et Docker. En dessous de 2 Go, les
> imports par code-barres/ISBN (téléchargement + ré-hébergement des couvertures)
> peuvent devenir lents ou provoquer des OOM.

### Logiciels (prérequis hôte)

| Logiciel | Version | Rôle |
|---|---|---|
| **Système d'exploitation** | Debian 12 (cible) — tout Linux compatible Docker fonctionne | Hôte de la VM |
| **Docker Engine** | ≥ 24.x (dernière stable) | Exécution des conteneurs |
| **Docker Compose** | v2 (plugin `docker compose`) | Orchestration db + backend + frontend |
| **Git** | récent | Déploiement (`git clone`) et mises à jour (`git pull`) |

### Accès réseau sortant (egress)

L'application a besoin d'une **connexion internet sortante** pour :

- **Imports vinyles** : MusicBrainz, Cover Art Archive, Discogs (si `DISCOGS_TOKEN`), Last.fm.
- **Imports BD** : Google Books, Open Library.
- **Indicateur de mise à jour** : API GitHub (dépôt privé → `GITHUB_TOKEN`).

Sans egress, l'application fonctionne normalement (collections locales,
authentification) mais les imports par code-barres/ISBN échouent (`502`).

> Les ports entrants requis sont uniquement le **port 80** (frontend). PostgreSQL
> (5432) et l'API backend (8080) restent **internes au réseau Docker** et ne sont
> pas exposés sur l'hôte.

---

## 🚀 Installation pas à pas (Debian 12 — VM `172.16.2.75`)

### 1. Prérequis sur la VM

```bash
# Mettre à jour le système
sudo apt update && sudo apt upgrade -y

# Installer Docker Engine + Compose (répositoire officiel Docker)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER        # puis se reconnecter pour le groupe docker
```

Vérifications :

```bash
docker --version
docker compose version
```

Conseil Debian 12 : la VM doit avoir l'IP **`172.16.2.75`** sur son interface
(`ip addr`). Le port **80** doit être accessible (pare-feu local `iptables`/`nftables`
et pare-feu du réseau si nécessaire).

### 2. Déployer les fichiers du projet

```bash
sudo mkdir -p /opt && cd /opt
sudo git clone <depot-git> geek0thek     # ou copier l'arborescence complète
cd /opt/geek0thek
```

### 3. Préparer l'environnement & le secret JWT

```bash
cp .env.example .env
```

Éditez `.env` :

```env
# Secret JWT : générer une longue chaîne aléatoire
openssl rand -hex 64
#   puis coller la valeur dans JWT_SECRET=...

# (Optionnel) User-Agent identifié envoyé à MusicBrainz :
MUSICBRAINZ_USER_AGENT=Geek0thek/1.0.0 (contact@example.com)
# Options : CORS_ORIGIN=http://172.16.2.75  (à ajuster si reverse proxy https)
```

### 4. Permissions du dossier `uploads` (important)

Les conteneurs s'exécutent en utilisateur `node` (uid 1000) côté backend.
Le serveur crée les sous-dossiers s'ils manquent, mais pour éviter tout
problème sur le disque hôte :

```bash
cd /opt/geek0thek
sudo mkdir -p uploads/vinyls uploads/comics
sudo chown -R 1000:1000 uploads        # uid 1000 = utilisateur "node" dans l'image
sudo chmod 775 uploads uploads/vinyls uploads/comics
ls -laR uploads
```

> Le volume `./uploads:/app/uploads` garantit que les couvertures (fichiers
> téléversés **et** téléchargées depuis MusicBrainz / Cover Art Archive,
> Discogs, Google Books / Open Library)
> sont stockées **sur le disque de la VM hôte** :
> - `/opt/geek0thek/uploads/vinyls/` → jaquettes de disques
> - `/opt/geek0thek/uploads/comics/` → couvertures de BD
>
> Multer route automatiquement chaque upload vers le bon sous-dossier selon
> la route concernée (`/api/vinyls/*` → `vinyls/`, `/api/comics/*` → `comics/`).
> La base de données est de même persistée dans `/opt/geek0thek/data`.

### 5. API MusicBrainz (aucune clé requise)

L'import par code-barres s'appuie sur **MusicBrainz** (métadonnées : titre,
artiste, date, label) et **Cover Art Archive** (jaquette). **Aucune clé API ni
compte n'est requis** : le backend identifie l'application via l'en-tête
`User-Agent` (`Geek0thek/1.0.0 (contact@example.com)` par défaut).

Vous pouvez personnaliser ce User-Agent dans `.env` (recommandé : indiquer un
contact valide, exigé par MusicBrainz) :

```env
MUSICBRAINZ_USER_AGENT=Geek0thek/1.0.0 (contact@example.com)
```

Sans paramètre configuré, l'endpoint
`GET /api/musicbrainz/status` renvoie toujours `configured: true` (l'API ne
dépend d'aucune clé) et la recherche par code-barres fonctionne immédiatement.

> **Quota** : MusicBrainz autorise **1 requête/seconde** maximum.
> L'application ne fait qu'une seule requête de recherche par import
> (+ une récupération de jaquette sur Cover Art Archive).

> **BD / ISBN** : les recherches par ISBN s'appuient sur **Google Books API**
> puis **Open Library** en secours. **Aucune clé API n'est requise** et aucun
> paramètre `.env` n'est nécessaire — le backend effectue la recherche côté
> serveur et télécharge la couverture localement (ré-hébergement).

### 6. API Discogs — jeton personnel (`DISCOGS_TOKEN`)

**Discogs complète MusicBrainz** dans la recherche par code-barres : en plus
de la fiche de référence MusicBrainz (titre, artiste, date, label, tracklist,
MBID), Discogs apporte la **date, le label et le genre manquants**, la **miniature**,
et les **identifiants de la release**
(`discogs_release_id` + `discogs_url`, persistés avec le vinyle).

Discogs **exige** un **jeton personnel** + un `User-Agent` identifié. Sans
`DISCOGS_TOKEN`, la recherche Discogs est simplement **désactivée** :
l'application fonctionne alors avec MusicBrainz seul, sans erreur.

**Obtenir un jeton Discogs** (compte gratuit requis) :

1. Se connecter sur <https://www.discogs.com>
2. Ouvrir <https://www.discogs.com/settings/developers>
3. Cliquer sur **« Create New Token »** et donner un nom (ex. `Geek0thek`)
4. Laisser les **permissions par défaut** (la lecture seule suffit)
5. Copier le jeton généré dans `.env` :

```env
# Jeton Discogs (obligatoire pour activer le complément Discogs)
DISCOGS_TOKEN=votre-jeton-discogs-ici

# (Optionnel) User-Agent identifié envoyé à Discogs (recommandé) :
DISCOGS_USER_AGENT=Geek0thek/1.0.0 (contact@example.com)

# (Optionnel) Nombre de requêtes Discogs autorisées par minute (défaut 25, max 250) :
DISCOGS_RATE_LIMIT_PER_MINUTE=25
```

> **Quota** : Discogs autorise par défaut **25 requêtes/min** par jeton.
> L'application limite d'elle-même le débit (limiteurs internes) et ne fait
> qu'une requête de recherche par code-barres.
> `GET /api/discogs/status` renvoie `configured: true` uniquement si
> `DISCOGS_TOKEN` est renseigné et valide.

**Endpoint combiné d'import par code-barres**

`GET /api/musicbrainz/barcode/:code` (JWT requis, EAN/UPC : 8 à 14 chiffres)
interroge **MusicBrainz et Discogs en parallèle**, puis **fusionne** les
fiches : MusicBrainz est la référence (tracklist, MBID) ; Discogs ne
complète que ce qui manque + ses identifiants. Les deux sources sont
indépendantes :

- **Discogs non configuré** → aucune erreur, fiche MusicBrainz seule
  (`providers.discogs: "not-configured"`).
- **Source absente d'un disque (404)** → non bloquant, l'autre source est renvoyée.
- **Échec d'infrastructure (502/429/401)** → signalé dans `warnings` si l'autre
  source a trouvé la fiche ; sinon statut de la 1ʳᵉ erreur renvoyé (429 ou 502).

Réponse `200` :

```json
{
  "success": true,
  "data": {
    "barcode": "0123456789012",
    "artist": "Artiste",
    "title": "Titre",
    "label": "Label",
    "genre": "Rock",
    "release_date": "1995-06-01",
    "tracklist": "Titre 1\nTitre 2",
    "track_count": 2,
    "cover_image": "/uploads/…",
    "mbid": "uuid",
    "discogs_release_id": 123456,
    "discogs_url": "https://www.discogs.com/release/123456",
    "source": "musicbrainz+discogs"
  },
  "providers": { "musicbrainz": "found", "discogs": "found" },
  "warnings": []
}
```

- `source` : `"musicbrainz"` / `"discogs"` / `"musicbrainz+discogs"`.
- `providers.<src>` : `"found"` | `"not-found"` | `"not-configured"` (discogs) | `"unavailable"`.
- `discogs_release_id` / `discogs_url` sont `null` si Discogs n'a pas reconnu le disque
  (ou n'est pas configuré) ; ils sont **persistés avec le vinyle** à la création.
- Aucune des deux sources ne connaît le code → **`404`** (saisie manuelle conseillée).

L'endpoint Discogs seul (pour débogage) est aussi exposé :
`GET /api/discogs/status` et `GET /api/discogs/barcode/:code`.

### 7. Lancer l'application

```bash
cd /opt/geek0thek
docker compose up -d --build
```

Suivi des journaux :

```bash
docker compose logs -f
docker compose ps
```

La base PostgreSQL exécute automatiquement `database/init.sql` **à la toute
première création** du volume `./data` : le schéma complet (tables `users`,
`vinyls`, `comics` + vues publiques) est mis en place et
**l'admin de test principal est créé** (`admin` / `admin`, mot de passe hashé
bcrypt, drapeau `must_change_password = FALSE`).

L'application est alors joignable à l'URL **`http://172.16.2.75`**.

---

## 🔑 Comptes par défaut

| Login | Mot de passe | Rôle |
|---|---|---|
| `admin` | `admin` | `admin` (compte de test principal, seedé dans `init.sql`) |

- Seul un **admin** peut créer / modifier / supprimer des comptes
  (section *Utilisateurs*).
- Le mot de passe est stocké **hashé bcrypt** (coût 12 en base / 10 pour les
  comptes créés via l'UI) ; jamais en clair.

### 🔒 Sécurité à la première connexion (onboarding forcé)

Tant que le compte porte le drapeau `must_change_password = TRUE` — c'est le cas
de **tout compte créé via l'API** (l'admin de test `admin` / `admin` est seedé
avec le drapeau à `FALSE`, il n'est donc pas concerné) — l'accès à
l'application est **bloqué** :

1. **Login** avec les identifiants de première installation → redirection
   obligatoire vers la page **Onboarding** (`/onboarding`).
2. La modification du mot de passe est **obligatoire** (nouveau mot de passe
   d'au moins 8 caractères, différent de l'actuel, **double saisie**) ; le
   **pseudo de login peut être personnalisé** (facultatif).
3. Une fois validé (`POST /api/auth/onboarding`), la base est mise à jour
   (nouveau `login`, nouveau `password_hash` bcrypt, drapeau remis à `FALSE`)
   et la session est renouvelée avec un **nouveau JWT** : retour au tableau de
   bord.

Côté API, le garde `requirePasswordChanged` renvoie `403`
(`code: "must-change-password"`) sur toutes les routes protégées tant que le
drapeau n'est pas levé ; le frontend intercepte ce code et redirige vers la
page de forçage. Une **réinitialisation du mot de passe par un admin**
(`PUT /api/users/:id` avec `newPassword`) remet le drapeau à `TRUE` : la
prochaine connexion du compte redevient un onboarding forcé.

### 📅 Rappel de sécurité semestriel (comptes SANS 2FA)

En complément de l'onboarding forcé, un **rappel automatique** est envoyé
**tous les 6 mois** à chaque utilisateur **actif** qui n'a **pas activé
l'authentification à deux facteurs (2FA)**, pour l'inviter / inciter à changer
son mot de passe et à activer la 2FA.

- **Mécanisme** : une tâche planifiée (planificateur natif `setInterval`, sans
  dépendance externe) démarre au boot de l'API, une fois la base disponible.
  Elle vérifie **quotidiennement** les comptes éligibles ; le rappel n'est
  réellement envoyé que si le compte est « échu ».
- **Éligibilité** : compte `is_active = TRUE`, `totp_enabled = FALSE` (2FA non
  activée), dont le mot de passe a plus de 6 mois (`users.password_changed_at`,
  ou `created_at` en repli) **et** qui n'a pas reçu de rappel depuis plus de
  6 mois (`users.last_password_reminder_at`).
- **Règle non bloquante** : il s'agit d'une simple demande **informative** par
  e-mail. Elle ne bloque **jamais** l'accès à l'application, ne modifie ni le
  mot de passe ni le drapeau `must_change_password` — seul le champ
  `last_password_reminder_at` est mis à jour (pour éviter les doublons).
- **Idempotence** : le champ `last_password_reminder_at` garantit qu'aucun
  utilisateur ne reçoit plus d'un rappel par période de 6 mois, même si la
  vérification tourne quotidiennement ou que le conteneur est redémarré.
- **SMTP requis** : si le SMTP n'est pas configuré, aucun rappel n'est envoyé
  (et aucun compte n'est marqué) — les rappels partiront dès que le SMTP sera
  opérationnel.

---

## 🖥️ Configuration d'un reverse proxy externe

Le frontend (nginx interne) et le backend (Express `trust proxy = 1`) sont
déjà câblés pour recevoir les en-têtes `X-Forwarded-*`. Exemple **nginx** pour
un reverse proxy sur la VM (domaine `vinyle.exemple.fr`) :

```nginx
server {
    listen 80;
    server_name vinyle.exemple.fr;
    # Redirection http -> https
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    http2 on;
    server_name vinyle.exemple.fr;

    ssl_certificate     /etc/letsencrypt/live/vinyle.exemple.fr/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vinyle.exemple.fr/privkey.pem;

    # Uploads volumineux (jaquettes / couvertures BD)
    client_max_body_size 15m;

    # En-têtes de proxy attendus par Express + nginx interne
    location / {
        proxy_pass http://172.16.2.75:80;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host  $host;
        proxy_set_header X-Forwarded-Port  $server_port;

        # Support WebSocket (si besoin en amont de l'API)
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
```

Et ajuster dans `.env` (puis `docker compose up -d`) :

```env
CORS_ORIGIN=https://vinyle.exemple.fr
```

> L'application fonctionne **sans** reverse proxy (HTTP port 80) ; le proxy
> n'est nécessaire que pour HTTPS/SNI ou un domaine public.

---

## 🐳 Commandes Docker Compose utiles

```bash
# Démarrer tout (build si besoin)
docker compose up -d --build

# Arrêter tout (les volumes restent : données + uploads)
docker compose down

# Arrêter et SUPPRIMER les volumes (⚠️ EFFACE base de données)
docker compose down -v

# Suivi des journaux
docker compose logs -f
docker compose logs -f backend

# Statut
docker compose ps

# Entrer dans un conteneur
docker compose exec backend sh
docker compose exec db psql -U vinyl -d geek0thek

# Recréer l'admin après un "down -v" (déjà fait par init.sql au 1er boot)
docker compose up -d db

# Sauvegarde rapide de la base
docker compose exec db pg_dump -U vinyl -Fc vinyl > backup-$(date +%F).dump
# Restauration :
docker compose exec -T db pg_restore -U vinyl -d geek0thek --clean < backup.dump
```

---

## 🔄 Mise à jour de l'application (indicateur automatique)

L'application surveille **automatiquement** si une mise à jour est disponible sur le
dépôt GitHub (`Irwin0812/geek0thek`) et le signale visuellement.

- **Au chargement** de la webapp, le backend compare le **commit du code déployé**
  (lu dans le dépôt git monté en lecture seule dans le conteneur backend) au
  **dernier commit** de la branche par défaut du dépôt GitHub.
- **Bouton « Mise à jour disponible »** : tant que les deux versions sont
  **identiques**, aucun bouton n'apparaît. Dès qu'un nouveau commit est poussé sur
  GitHub, un **bouton rectangulaire à bords arrondis** apparaît dans le **coin
  supérieur droit** de l'interface (stylé comme le bouton « TOP », selon le thème).
- **Infobulle au survol** : en passant la souris sur le bouton, une bulle indique la
  marche à suivre pour effectuer la mise à jour :
  `git pull && docker compose up -d --build`.
- **Disparition automatique** : après avoir effectué la mise à jour (les deux
  versions redeviennent égales), le bouton disparaît de lui-même — sans recharger
  la page (re-vérification discrète toutes les 5 minutes).

### Prérequis : jeton GitHub (`GITHUB_TOKEN`)

Le dépôt étant **privé**, l'API GitHub exige un jeton pour lire le dernier commit.
Sans jeton, l'indicateur reste **silencieux** (bouton masqué — jamais de faux
positif). Pour l'activer :

```bash
# Sur la VM 172.16.2.75, ajouter au .env (jeton GitHub avec lecture du dépôt) :
GITHUB_TOKEN=github_pat_...
# Puis relancer le backend pour charger la variable :
docker compose up -d backend
```

> Le jeton est stocké dans `.env`, **jamais exposé** par l'API ni loggé.

### Effectuer la mise à jour

```bash
cd /opt/geek0thek
git pull && docker compose down && docker compose up -d --build
```

Après ce `pull` + rebuild, le commit déployé rejoint la HEAD de GitHub : le bouton
« Mise à jour disponible » disparaît automatiquement.

---

## ✉️ Configuration des notifications E-mail (SMTP)

L'application peut envoyer des **notifications par e-mail** automatiques dans les cas suivants :

- **Création de compte par un admin** : le nouvel utilisateur reçoit un e-mail
  confirmant la création de son compte avec ses accès (identifiant + mot de passe
  provisoire).
- **Partage de bibliothèque** : quand un utilisateur ouvre l'accès en consultation à
  sa collection à un autre utilisateur, ce dernier reçoit un e-mail de notification.
- **Réinitialisation du mot de passe** (« identifiant / mot de passe oublié ») : le
  propriétaire du compte reçoit un lien temporaire (jeton à usage unique, validité 1 h).
- **Rappel de sécurité semestriel (comptes SANS 2FA)** : tous les 6 mois, chaque
  utilisateur actif qui n'a **pas** activé l'authentification à deux facteurs (2FA)
  reçoit un e-mail d'**information** l'invitant à changer son mot de passe et à activer
  la 2FA. Ce rappel est **non bloquant** : il ne bloque jamais l'accès à l'application
  (voir section *Rappel de sécurité semestriel* ci-dessous).

Ces envois sont pilotés **exclusivement par les variables d'environnement** du fichier
`.env` (à la racine du projet). Chaque utilisateur configure ainsi **son propre serveur
SMTP** — aucun code à modifier.

### Renseigner vos paramètres SMTP

Ajoutez (ou complétez) le bloc suivant dans `.env` :

```env
# Configuration SMTP pour les notifications par e-mail
SMTP_HOST=smtp.votre-serveur.com
SMTP_PORT=465 # ou 587 selon TLS/SSL
SMTP_USER=votre-email@domaine.com
SMTP_PASS=votre-mot-de-passe
SMTP_FROM="Geek0thek <votre-email@domaine.com>"
```

| Variable | Description |
|---|---|
| `SMTP_HOST` | Hôte du serveur SMTP (ex. `smtp.gmail.com`, `mail.exemple.fr`) |
| `SMTP_PORT` | Port : **465** (TLS/SSL implicite) ou **587** (STARTTLS) |
| `SMTP_USER` | Identifiant de connexion SMTP (généralement votre adresse e-mail) |
| `SMTP_PASS` | Mot de passe SMTP (ou « app password » si votre fournisseur l'exige, ex. Gmail) |
| `SMTP_FROM` | Expéditeur affiché : `« Nom <adresse> »` (optionnel — repli sur `SMTP_USER`) |

> **Port 465 vs 587** : le backend détecte automatiquement le mode de chiffrement à
> partir du port (`465` → TLS implicite, `587` → STARTTLS). Une surcharge manuelle est
> possible via `SMTP_SECURE=true|false`.

### Variables vides = notifications désactivées (sans erreur)

Si `SMTP_HOST`, `SMTP_USER` ou `SMTP_PASS` restent **vides**, l'application fonctionne
**normalement** : les notifications e-mail sont simplement **désactivées** proprement
(un avertissement est journalisé en console au démarrage, jamais de crash). L'envoi
d'e-mails est **non bloquant** : un échec d'envoi (réseau, authentification, adresse
invalide…) ne fait **jamais** échouer l'action qui l'a déclenché (création du compte,
partage de la bibliothèque).

### Appliquer la configuration

Après avoir modifié `.env`, recréez le conteneur backend pour charger les nouvelles
variables :

```bash
cd /opt/geek0thek
docker compose up -d --force-recreate backend
# ou un redémarrage complet :
docker compose down && docker compose up -d --build
```

Vérification dans les journaux (l'avertissement « SMTP non configuré » doit disparaître) :

```bash
docker compose logs -f backend
```

---

## 🔒 Sécurité & bonnes pratiques

- **JWT** signé (HS256) avec `JWT_SECRET` à longue valeur aléatoire ; expiration `7d`.
- **bcrypt** pour tous les mots de passe (jamais en clair, ni en log).
- **Onboarding forcé à la première connexion** : drapeau
  `users.must_change_password` (comptes créés via l'API ; le seed admin/admin est à FALSE)
  → changement de mot de passe obligatoire (double saisie) et pseudo de login
  personnalisable avant tout accès ; garde API `requirePasswordChanged`
  (`403 must-change-password`) sur toutes les routes protégées.
- **Rappel de sécurité semestriel (comptes SANS 2FA)** : tâche planifiée qui envoie,
  tous les 6 mois, un e-mail d'**information** aux utilisateurs actifs n'ayant pas
  activé la 2FA, pour les inciter à changer leur mot de passe. **Non bloquant**
  (jamais de blocage d'accès) ; idempotent via `users.last_password_reminder_at`.
- **Helmet** (en-têtes sécurité) + **CORS** restreint aux origines autorisées.
- **Express `trust proxy = 1`** pour lire correctement `X-Forwarded-For`.
- Couvertures servies statiquement (`/uploads/...`) : noms de fichiers
  **aléatoires** (`cover-<hex>`), filtrage MIME (JPG/PNG/WEBP/GIF),
  limite `MAX_UPLOAD_MB` (10 Mo par défaut), 1 fichier par import.
- **PostgreSQL** n'expose rien : le port 5432 reste **interne au réseau Docker**
  (non publié sur l'hôte) ; seul le backend y accède.
- Le compte `node` (uid 1000, non-root) exécute le backend.
- Les couvertures **téléchargées depuis MusicBrainz / Cover Art Archive,
  Discogs, Google Books / Open Library**
  sont **ré-hébergées localement** (le champ `cover_url` stocke toujours un
  chemin `/uploads/vinyls/...` ou `/uploads/comics/...`, ou une URL distante
  validée) pour ne pas dépendre des CDN tiers.
- **Jeton Discogs** : stocké dans `.env`, **jamais exposé** par l'API ni loggé
  (le statut `GET /api/discogs/status` ne renvoie qu'un booléen `configured`).
- ISBN des BDs **unique** en base (contrainte `UNIQUE`) pour éviter les doublons.

---

## 🧩 Schéma de base de données (résumé)

```sql
users      (id, last_name, first_name, email UNIQUE, login UNIQUE, password_hash,
            role [admin|user], phone, bio, is_public BOOLEAN,
            must_change_password BOOLEAN (défaut FALSE ; TRUE = onboarding forcé),
            totp_secret TEXT, totp_enabled BOOLEAN (2FA Google Authenticator / TOTP),
            password_changed_at TIMESTAMPTZ (dernière modification du mot de passe),
            last_password_reminder_at TIMESTAMPTZ (dernier rappel semestriel envoyé),
            created_at, updated_at)

vinyls     (id, user_id FK->users ON DELETE CASCADE, cover_url TEXT NOT NULL,
            artist, title, track_count, tracklist, genre, label, release_date,
            barcode UNIQUE,
            mbid VARCHAR(40),             -- MBID MusicBrainz (release UUID)
            discogs_release_id BIGINT,   -- id de la release Discogs (recherche code-barres)
            discogs_url TEXT,            -- URL de la fiche release Discogs
            acquired_date DATE, notes,
            is_special_edition BOOL,     -- « Édition spéciale » (case à cocher)
            is_picture_disc BOOL,        -- « Picture Disc » (select Oui/Non)
            discs_count INT 1→5,         -- « Nombre de vinyls » (select 1 → 5, défaut 1)
            color VARCHAR(50),           -- « Couleur » de la galette (défaut 'Noir')
            created_at, updated_at)

comics     (id, user_id FK->users ON DELETE CASCADE, cover_url TEXT,
            title VARCHAR(255) NOT NULL, series VARCHAR(255), tome_number,
            authors VARCHAR(255) NOT NULL, illustrators, publisher NOT NULL,
            release_date, genre, isbn UNIQUE, synopsis,
            condition (défaut 'Bon état'), is_special_edition BOOL,
            created_at, updated_at)

public_vinyls  -- vue : vinyles des collections is_public = TRUE
public_comics  -- vue : BDs des collections is_public = TRUE
```

Triggers `updated_at` automatiques sur les trois tables.

#### Table `vinyls` — détail des colonnes

| Colonne | Type | Contraintes | Description |
|---|---|---|---|
| `id` | `BIGSERIAL` | PK | Identifiant unique du vinyle |
| `user_id` | `BIGINT` | FK→`users(id)` `ON DELETE CASCADE`, NOT NULL | Propriétaire de la fiche |
| `cover_url` | `TEXT` | NOT NULL | Jaquette : `/uploads/vinyls/…` (locale) ou URL distante |
| `artist` | `VARCHAR(255)` | NOT NULL | Artiste (principal) |
| `title` | `VARCHAR(255)` | NOT NULL | Titre de l'album / single |
| `track_count` | `INTEGER` | `>= 0`, défaut `0` | Nombre de titres |
| `tracklist` | `TEXT` | — | Liste des titres (1 titre par ligne) |
| `genre` | `VARCHAR(120)` | — | Genre musical |
| `label` | `VARCHAR(255)` | — | Label discographique |
| `release_date` | `DATE` | — | Date de parution |
| `barcode` | `VARCHAR(64)` | UNIQUE | Code-barres EAN/UPC (clé d'import) |
| `mbid` | `VARCHAR(40)` | — | MBID MusicBrainz (UUID de la release) |
| `discogs_release_id` | `BIGINT` | 🆕 | **Id de la release Discogs** (recherche par code-barres) |
| `discogs_url` | `TEXT` | 🆕 | **URL de la fiche release Discogs** |
| `acquired_date` | `DATE` | NOT NULL, défaut `CURRENT_DATE` | Date d'ajout du vinyle à la collection (remplace « année d'acquisition ») |
| `notes` | `TEXT` | — | Notes libres |
| `is_special_edition` | `BOOLEAN` | 🆕 NOT NULL, défaut `FALSE` | **Édition spéciale** (case à cocher du formulaire) |
| `is_picture_disc` | `BOOLEAN` | 🆕 NOT NULL, défaut `FALSE` | **Picture Disc** (select Oui/Non du formulaire) |
| `discs_count` | `INTEGER` | 🆕 NOT NULL, défaut `1`, `BETWEEN 1 AND 5` | **Nombre de vinyls** (select 1 → 5, défaut 1 — borne resserrée par la migration 006) |
| `color` | `VARCHAR(50)` | 🆕 NOT NULL, défaut `'Noir'` | **Couleur** de la galette (Noir, Blanc, Rouge, Bleu…, Or, Argent, Cuivre, Bronze, Marbré, Splatter…) |
| `created_at` / `updated_at` | `TIMESTAMPTZ` | NOT NULL, défaut `now()` | Horodatage (auto via trigger) |

> Les colonnes **`discogs_release_id`** et **`discogs_url`** sont ajoutées
> automatiquement par la migration idempotente `vinyls.discogs` au démarrage
> de l'API (`backend/src/config/db.js`) et présentes dans `database/init.sql`.
> Elles sont renseignées lors d'un import combiné MusicBrainz + Discogs.
> Idem pour **`is_special_edition`**, **`is_picture_disc`**, **`discs_count`** et
> **`color`** (migration `vinyls.options`, cf. `database/migrations/005_add_vinyl_options.sql`).
> La borne du CHECK **`discs_count`** est resserrée de 1 → 20 à 1 → 5 par la suite
> de migrations `vinyls.discs-count-1-to-5` (`database/migrations/006_vinyls_discs_count_1_to_5.sql`) :
> les valeurs existantes hors plage sont d'abord resserrées aux bornes, puis la contrainte est remplacée.

Index : `users(role)` ; `vinyls(user_id, artist, title, genre, release_date, barcode,
mbid, discogs_release_id)` ; `comics(user_id, isbn, title, authors, publisher)`.

---

## 📡 API REST (référence)

| Méthode | Endpoint | Accès | Description |
|---|---|---|---|
| `POST` | `/api/auth/login` | public | `login`/`login or email` + `password` → `{ token, user }` (le profil renvoyé porte `mustChangePassword`) |
| `POST` | `/api/auth/onboarding` | auth | **Sécurité 1re connexion** : `currentPassword` + `newPassword` (obligatoire) + `login?` (pseudo personnalisable) → `{ token, user }` ; remet `must_change_password = FALSE` |
| `GET`  | `/api/auth/me` | auth | Profil courant |
| `GET`  | `/api/users` | admin | Liste des comptes (+ nb de vinyles / BDs) |
| `POST` | `/api/users` | admin | Créer un compte (rôle `user`) |
| `PUT`  | `/api/users/me` | auth | Modifier son profil / mot de passe |
| `PUT`  | `/api/users/:id` | admin | Modifier un compte |
| `DELETE` | `/api/users/:id` | admin | Supprimer un compte (+ vinyles et BDs) |
| `GET`  | `/api/vinyls` | auth | Ma collection (`?q=` recherche) |
| `POST` | `/api/vinyls` | auth | Créer (multipart `cover` ou `coverRemoteUrl`) |
| `GET`  | `/api/vinyls/:id` | auth (owner) | Détail d'un vinyle |
| `PUT`  | `/api/vinyls/:id` | auth (owner) | Modifier |
| `DELETE` | `/api/vinyls/:id` | auth (owner) | Supprimer (+ fichier local) |
| `GET`  | `/api/vinyls/public` | public | Collections publiques (`?q=&genre=&label=`) |
| `GET`  | `/api/musicbrainz/status` | auth | `{ configured, provider, discogs: { configured } }` — état MusicBrainz + Discogs |
| `GET`  | `/api/musicbrainz/barcode/:code` | auth | **Import combiné par code-barres (8 à 14 chiffres)** : MusicBrainz (réf.) **+ Discogs** si `DISCOGS_TOKEN` configuré → fiche fusionnée `{ data, providers, warnings? }` |
| `GET`  | `/api/discogs/status` | auth | `{ configured, provider: "discogs" }` — `true` si `DISCOGS_TOKEN` renseigné |
| `GET`  | `/api/discogs/barcode/:code` | auth | Recherche Discogs seule par code-barres (8 à 14 chiffres) (débogage) |
| `GET`  | `/api/comics` | auth | Ma collection BD (`?q=` recherche) |
| `POST` | `/api/comics` | auth | Créer (multipart `cover` ou `coverRemoteUrl`) |
| `GET`  | `/api/comics/:id` | auth (owner) | Détail d'une BD |
| `PUT`  | `/api/comics/:id` | auth (owner) | Modifier |
| `DELETE` | `/api/comics/:id` | auth (owner ou admin) | Supprimer (+ fichier local) |
| `GET`  | `/api/comics/public/user/:userId` | public | BDs d'une collection publique (sans auth) |
| `GET`  | `/api/isbn/lookup/:isbn` | auth | Pré-remplissage BD : Google Books, Open Library en secours |
| `GET`  | `/api/health` | public | Sonde de santé (base incluse) |

---

## 🩺 Dépannage

| Symptôme | Cause probable / solution |
|---|---|
| Pages vides après login (navbar visible, aucun bouton *Ajouter*, aucune liste) | `ProtectedRoute` rendait `children` (undefined) en route **layout** sans `<Outlet/>` → corrigé dans `frontend/src/components/ProtectedRoute.jsx`. Rebuild + redéploiement du conteneur frontend : `docker compose up -d --build frontend` + **vidage du cache du navigateur** |
| `502` sur recherche code-barres | Pas/plus de connexion internet côté serveur (MusicBrainz inaccessibles) → vérifier l'egress réseau de la VM |
| `429` sur recherche code-barres | Quota MusicBrainz atteint (1 req/s) → réessayer après quelques secondes |
| `404` sur recherche code-barres | Disque inconnu des deux sources (MusicBrainz ni Discogs) pour cet EAN → saisir la fiche manuellement (un `404` d'une seule source n'est **pas** bloquant : l'autre est renvoyée) |
| `401` / `403` sur recherche code-barres (Discogs) | `DISCOGS_TOKEN` invalide/expiré ou permission manquante → régénérer le jeton sur <https://www.discogs.com/settings/developers> |
| `429` sur recherche code-barres (Discogs) | Quota du jeton atteint (défaut 25 min) → patienter, ou ajuster `DISCOGS_RATE_LIMIT_PER_MINUTE` |
| Fiche sans `discogs_url` / sans `discogs_release_id` | Discogs non configuré (`DISCOGS_TOKEN` vide) ou disque inconnu de Discogs → normal, la fiche MusicBrainz est complète |
| `502` sur recherche ISBN | Pas/plus de connexion internet côté serveur (Google Books & Open Library inaccessibles) → vérifier egress réseau de la VM |
| `404` sur recherche ISBN | ISBN inconnu ou non référencé dans Google Books / Open Library → saisir la fiche manuellement |
| `401` à l'appel d'une API | Jeton expiré → reconnexion |
| Images `/uploads/...` en 403/404 | Vérifier `chown -R 1000:1000 uploads` + `chmod 775` sur les sous-dossiers `vinyls/` et `comics/` au hôte |
| La collection n'apparaît pas en publique (vinyles ou BDs) | Le toggle *Visibilité* du propriétaire doit être sur **Publique** |
| Port 80 occupé sur la VM | Changer `APP_PORT` dans `.env` (ex. `APP_PORT=8080`) |
| `column "acquired_date" does not exist` à la modification d'un vinyle (form. « DATE D'AJOUT ») | Colonne absente de la table `vinyls` : cause racine connue = **la vue `public_vinyls` (init.sql, `SELECT v.*`)** porte une dépendance PostgreSQL sur l'ancienne colonne `year_acquired`, ce qui bloquait le `DROP COLUMN` en fin de migration et **rollback**ait le `ADD COLUMN acquired_date`. Les deux scripts réparent sans effet de bord : `database/migrations/007_ensure_vinyl_acquired_date.sql` (psql) + auto-migration `vinyls.added-date` (`backend/src/config/db.js`, recrée la vue à l'identique après le drop). `GET /api/health` expose `schema_ok: false` tant que la colonne est absente |
| `Base de données incomplète (colonne absente)` sur POST/PUT `/api/vinyls` | Même cause : appliquer `docker compose exec -T db psql -U vinyl -d geek0thek -f /dev/stdin < database/migrations/007_ensure_vinyl_acquired_date.sql` puis `docker compose restart backend` ; vérifier les logs de démarrage (`migration appliquée : vinyls.added-date`) |
| Re-démarrer proprement la base | `docker compose down -v` puis `up -d` (⚠️ efface la base, `init.sql` recrée l'admin) |

### Migrations & réparation du schéma

L'API applique **automatiquement** des migrations idempotentes au démarrage
(`backend/src/config/db.js`) : chaque migration est tracée dans la table
`schema_migrations` et n'est ré-exécutée qu'une fois — un échec antérieur ne
bloque plus les migrations suivantes (notamment `vinyls.added-date`, qui crée
`vinyls.acquired_date`).

**Réparation définitive** d'un schéma incomplet (message
`column "acquired_date" does not exist` à la modification d'un vinyle) :

```bash
# 1. Inspecter : la colonne doit apparaître en sortie.
docker compose exec \
  psql -U vinyl -d geek0thek \
  -c "SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'vinyls' AND column_name = 'acquired_date';"

# 2. Si vide : appliquer la migration 007 (création + backfill + NOT NULL).
docker compose exec -T db \
  psql -U vinyl -d geek0thek -f /dev/stdin < database/migrations/007_ensure_vinyl_acquired_date.sql

# 3. Reconstruire le conteneur API avec le code à jour, redémarrer, confirmer.
docker compose up -d --build backend
curl -s http://172.16.2.75/api/health   # -> { "status": "ok", "schema_ok": true }
```

> Sans la colonne, `GET /api/health` renvoie `schema_ok: false` et tout
> POST/PUT `/api/vinyls` échoue avec le message
> *Base de données incomplète (colonne absente) : appliquez la migration 007
> puis relancez l'API.* Les logs backend affichent l'instruction SQL en échec
> et son nom de migration.

---

## 💙 Soutenir le projet

**Geek0thek est un projet conçu, développé et hébergé en solo, sur fonds propres.**
L'hébergement (VM, base de données, stockage des couvertures), la maintenance et le
développement continu sont entièrement pris en charge par l'auteur.

Si cette médiathèque vous est utile et que vous souhaitez contribuer à sa pérennité,
vous pouvez faire un **don libre** via PayPal :

[![Donner avec PayPal](https://www.paypalobjects.com/images/logos/315x49.gif)](https://paypal.me/geek0thek)

👉 **[Soutenez le projet — paypal.me/geek0thek](https://paypal.me/geek0thek)**

- **Aucun montant minimum ni maximum** : chaque contribution, quelle qu'en soit la
  taille, est la bienvenue et finance directement l'hébergement et le développement.
- Le bouton **« Soutenez le projet »** est également disponible en permanence dans le
  pied de page de l'application (il s'adapte au thème visuel actif).

Merci pour votre soutien ! 🙏

---

## Licence & Politique de contribution

Ce logiciel est distribué sous licence **GNU Affero General Public License v3.0 (AGPLv3)**. 

Toutefois, le dépôt officiel **n'accepte aucune contribution externe ni aucune Pull Request** de la part de tiers. Vous êtes totalement libre de forker le projet et de l'utiliser conformément aux termes de la licence AGPLv3, mais aucun code extérieur ne sera fusionné dans la branche principale.

Consultez le fichier [LICENSE](LICENSE) pour plus d'informations.
