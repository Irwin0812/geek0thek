# 💿📚 Geek0thek — Médiathèque Personnelle

---

## Description du projet

Application web full-stack conteneurisée pour la gestion de collections de Disques, de Bandes Dessinées (BD / Mangas / Comics), de (à venir) Jeux de Rôle, Jeux Vidéo, Livres/Magazines.

---

## 💙 Soutenir le projet

**Geek0thek est un projet conçu, développé et hébergé en solo, sur fonds propres.**
L'hébergement (VM, base de données, stockage des couvertures), la maintenance et le développement continu sont entièrement pris en charge par l'auteur.

Si cette médiathèque vous est utile et que vous souhaitez contribuer à sa pérennité, vous pouvez faire un **don libre** via PayPal :

👉 **[Soutenez le projet en faisant un don via PayPal](https://www.paypal.com/donate/?hosted_button_id=Y7LQW3UKPY5VN)**

- **Aucun montant minimum ni maximum** : chaque contribution, quelle qu'en soit la taille, est la bienvenue et finance directement l'hébergement et le développement.
- Le bouton **« Soutenez le projet »** est également disponible en permanence dans le pied de page de l'application (il s'adapte au thème visuel actif).

Merci pour votre soutien ! 🙏

---

## Essayer la démo

🔗 **Démo en ligne :** <https://demothek.igerarts.be>

| Identifiant | Mot de passe |
| --- | --- |
| `demo` | `demo` |

---

## Fonctionnalités clés

**Geek0thek** est une application web full-stack moderne conçue sur mesure pour centraliser, organiser et valoriser la collection complète de vos médias physiques et objets culturels (disques vinyles, bandes dessinées, jeux vidéo, jeux de rôle, livres et magazines). Pensée pour offrir une expérience fluide, immersive et hautement personnalisable, la plateforme combine une gestion rigoureuse des données avec une esthétique visuelle soignée.

### 1. Gestion Multi-Bibliothèques et Collections

- **Diversité des supports :** Prise en charge native de multiples collections physiques (Vinyles, BD, Jeux vidéo, JDR, Livres) avec des fiches descriptives adaptées à chaque univers culturel.
- **Imports et Métadonnées :** Intégration d'API externes (telles que Discogs, Google Books) et de fonctionnalités de scan par code-barres (via smartphone) pour simplifier l'ajout d'œuvres.
- **Cohérence des données :** Mécanismes de normalisation intelligents, garantissant par exemple que le genre musical du premier disque ajouté pour un artiste se réplique automatiquement pour les ajouts ultérieurs du même groupe.

### 2. Identité Visuelle et Thèmes Personnalisés

- **Immersion thématique :** L'application propose plusieurs univers graphiques distincts et mémorisables (comme le thème *Médiathèque* avec ses tons chaleureux, le thème *Néon* utilisant des polices typographiques spécifiques comme Neuropol, ou encore le thème *Disquaire* aux accents rétro inspirés des années 80).
- **Gestion des préférences utilisateur :** Sauvegarde en base de données du thème de prédilection de chaque utilisateur, garantissant la persistance de son choix à chaque reconnexion.
- **Interface responsive :** Boutons d'interaction ergonomiques (navigation rapide, retour en haut de page positionné au-dessus du footer) et support multilingue complet (français, anglais, néerlandais) avec détection automatique de la langue du navigateur.

### 3. Sécurité & Rôles

- **Authentification sécurisée :** Gestion des profils utilisateurs et intégration d'options de sécurité avancées (Double authentification / 2FA).
- **Traçabilité des versions :** Affichage dynamique du numéro de Release GitHub officiel dans le pied de page, assurant un suivi clair des versions déployées.

### 4. Architecture & Stack Technique

- **Stack moderne :** Développé autour d'un backend Node.js / Express et d'un frontend React / Tailwind CSS, reposant sur une base de données PostgreSQL robuste optimisée pour traiter des volumes de données et des libellés étendus.
- **Approche native et auto-hébergée :** Conçu pour tourner nativement sous Linux, témoignant d'une volonté d'indépendance vis-à-vis des solutions cloud propriétaires au profit d'une infrastructure locale, performante et souveraine. Une installation locale sous Windows (mode natif) est également possible.

---

## 📂 Arborescence du projet & Couches / Technologies

```text
geek0thek/
├── .env                        # Variables d'environnement de production
├── .gitignore
├── package.json                # Configuration globale / scripts
├── README.md
├── database/
│   └── init.sql                # Schéma de la base de données (tables, types élargis TEXT/VARCHAR)
├── uploads/                    # Volume local des couvertures et images
│   ├── vinyls/                 # Jaquettes de disques
│   └── comics/                 # Couvertures de BD
├── backend/
│   ├── package.json            # Dépendances backend (express, pg, multer, etc.)
│   └── src/
│       ├── server.js           # App Express, statique /uploads, proxy trust, routes
│       ├── config/
│       │   ├── db.js           # Pool PostgreSQL (pg)
│       │   └── env.js          # Configuration centralisée (env)
│       ├── middlewares/
│       │   ├── auth.js         # JWT (authenticate) + requireAdmin
│       │   └── upload.js       # Multer (gestion des uploads indépendants jaquettes/séries)
│       ├── controllers/
│       │   ├── authController.js
│       │   ├── userController.js    # Gestion des profils, préférences et thèmes utilisateur
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
│           ├── musicBrainzClient.js # MusicBrainz + Cover Art Archive
│           ├── discogsClient.js     # Discogs (recherche par code-barres / release)
│           └── isbnClient.js        # Google Books / Open Library par ISBN
└── frontend/
    ├── package.json            # Dépendances frontend (React, Vite, Tailwind, i18next)
    ├── tailwind.config.js
    └── src/
        ├── App.jsx             # Routage + contextes (auth, thèmes, i18n)
        ├── index.css           # Thèmes graphiques et styles Tailwind
        ├── main.jsx
        ├── components/
        │   ├── Navbar.jsx
        │   ├── Footer.jsx      # Footer incluant l'affichage dynamique de la release GitHub
        │   ├── TopButton.jsx   # Bouton retour en haut positionné au-dessus du footer
        │   ├── ProtectedRoute.jsx
        │   ├── VinylCard.jsx
        │   ├── BarcodeModal.jsx
        │   ├── ComicCard.jsx
        │   └── IsbnModal.jsx
        ├── locales/            # Dictionnaires de traduction i18n (fr, en, nl) pour toutes les sections
        ├── pages/
        │   ├── Login.jsx
        │   ├── Onboarding.jsx      # Sécurité 1re connexion
        │   ├── Dashboard.jsx
        │   ├── Collection.jsx      # Vinyles de l'utilisateur
        │   ├── ComicCollection.jsx # BDs de l'utilisateur
        │   ├── PublicCollection.jsx# Collections publiques
        │   ├── AddVinyl.jsx
        │   ├── AddComic.jsx
        │   ├── Profile.jsx         # Paramètres utilisateur, sécurité (2FA) et thèmes
        │   └── AdminUsers.jsx
        └── services/
            └── api.js          # Client REST (JWT, multipart, gestion 401)
```

| Couche | Technologies / Outils | Rôle & Caractéristiques |
| --- | --- | --- |
| **Frontend (Présentation)** | **React**, **Vite**, **Tailwind CSS** | Interface utilisateur dynamique (SPA), responsive, avec thèmes personnalisables (Médiathèque, Néon, Disquaire). |
| **Internationalisation & UI** | **i18next**, **Lucide Icons** / **React Icons** | Support multilingue (FR, EN, NL), détection de langue et composant d'UI (bouton Top, footer dynamique). |
| **Backend (API / Serveur)** | **Node.js**, **Express.js** | API REST pour la gestion des données, de l'authentification et du traitement multipart (uploads). |
| **Sécurité & Authentification** | **JWT (JSON Web Tokens)**, **bcrypt**, **express-rate-limit** | Authentification sécurisée, hachage de mots de passe, gestion du 2FA et protection anti-bot/rate-limiting. |
| **Base de données (Données)** | **PostgreSQL** (`pg`) | Base de données relationnelle robuste avec types élargis (`TEXT`) pour éviter la limitation de taille des libellés. |
| **Stockage Fichiers** | **Multer**, Système de fichiers local | Gestion et organisation locale des jaquettes de disques, couvertures de BD et images médias dans `/uploads`. |
| **Services & APIs Externes** | **Discogs API**, **MusicBrainz**, **Cover Art Archive**, **Google Books / Open Library** | Métadonnées de collections et récupération automatique d'informations via codes-barres / ISBN. |
| **Infrastructure & Hôte** | **Debian 12 (Bookworm)**, **Nginx** | Déploiement natif auto-hébergé sur VM dédié avec reverse proxy HTTPS et gestion DNS local (`dnsmasq`). |

---

## ⚙️ Spécifications système minimales

L'application tourne sous **Docker Compose** avec **3 conteneurs** : PostgreSQL 16, backend Node.js 22 (API Express) et frontend nginx. Les spécifications ci-dessous sont celles recommandées pour l'exécuter **sereinement** sur la VM hôte.

### Matériel

| Ressource | Minimum | Recommandé |
| --- | --- | --- |
| **CPU** | 2 cœurs (vCPU) | 4 cœurs (vCPU) |
| **Mémoire RAM** | 2 Go | 4 Go |
| **Espace disque libre** | 10 Go | 30 Go+ (les couvertures téléversées/téléchargées s'accumulent dans `./uploads`) |
| **Réseau** | Connexion internet sortante (egress) | — |

> **Répartition indicative de la RAM** : PostgreSQL ~500 Mo, backend Node.js ~300 Mo, nginx ~50 Mo, le reste pour l'OS et Docker. En dessous de 2 Go, les imports par code-barres/ISBN (téléchargement + ré-hébergement des couvertures) peuvent devenir lents ou provoquer des OOM.

### Logiciels (prérequis hôte)

| Logiciel | Version | Rôle |
| --- | --- | --- |
| **Système d'exploitation** | Debian 12 (cible) — tout Linux compatible Docker fonctionne | Windows natif sans Docker |
| **Docker Engine** | ≥ 24.x (dernière stable) | Exécution des conteneurs |
| **Docker Compose** | v2 (plugin `docker compose`) | Orchestration db + backend + frontend |
| **Git** | récent | Déploiement (`git clone`) et mises à jour (`git pull`) |

### Accès réseau sortant (egress)

L'application a besoin d'une **connexion internet sortante** pour :

- **Imports vinyles** : MusicBrainz, Cover Art Archive, Discogs (si `DISCOGS_TOKEN`), Last.fm.
- **Imports BD** : Google Books, Open Library.
- **Indicateur de mise à jour** : API GitHub (dépôt privé → `GITHUB_TOKEN`).

Sans egress, l'application fonctionne normalement (collections locales, authentification) mais les imports par code-barres/ISBN échouent (`502`).

> Les ports entrants requis sont uniquement le **port 80** (frontend). PostgreSQL (5432) et l'API backend (8080) restent **internes au réseau Docker** et ne sont pas exposés sur l'hôte.

---

## 🚀 Installation pas à pas

### A. Linux — Docker Compose

#### 1. Préparation du système (Docker Engine + Docker Compose)

Connectez-vous en SSH à votre VM, puis préparez le système et installez les outils requis :

```bash
# Mettre à jour le système
sudo apt update && sudo apt upgrade -y

# Installer les dépendances et le dépôt officiel Docker
sudo apt install -y curl git apt-transport-https ca-certificates gnupg lsb-release
curl -fsSL https://get.docker.com | sudo sh

# Ajouter votre utilisateur au groupe docker pour éviter d'utiliser sudo à chaque commande
sudo usermod -aG docker $USER
```

*Note : Si vous venez d'ajouter votre utilisateur au groupe docker, déconnectez-vous de la session SSH (`exit`) puis reconnectez-vous pour appliquer le changement.*

Vérifiez que tout est bien en place :

```bash
docker --version
docker compose version
```

Vérifiez également que l'adresse IP de la VM correspond bien à celle attendue par la configuration (`votre_adresse_ip_ici`) :

```bash
ip addr
```

#### 2. Récupération des fichiers du projet (Git)

Créez le répertoire d'installation (par exemple dans `/opt`), clonez votre dépôt, puis positionnez-vous dedans :

```bash
sudo mkdir -p /opt && cd /opt

# Cloner le dépôt dans le dossier geek0thek (ajustez l'URL de votre dépôt si nécessaire)
sudo git clone <url-du-depot-git> geek0thek

# Donner la propriété du dossier à votre utilisateur courant
sudo chown -R $USER:$USER /opt/geek0thek
cd /opt/geek0thek
```

#### 3. Configuration du fichier `.env`

Le projet fournit un modèle de configuration. Dupliquez-le pour créer votre fichier `.env` actif :

```bash
cp .env.example .env
```

Ouvrez le fichier `.env` avec votre éditeur favori (ex. `nano .env`) et adaptez les valeurs clés :

1. **Sécurité JWT (obligatoire) :** Générez une chaîne aléatoire sécurisée en exécutant la commande suivante dans un autre terminal :

   ```bash
   openssl rand -hex 64
   ```

   Copiez le résultat et collez-le à la place de la valeur par défaut :

   ```env
   JWT_SECRET=votre_chaine_aleatoire_generee_ici
   ```

2. **Paramètres réseau et base de données :** Vérifiez que l'IP d'écoute correspond bien à votre environnement (`votre_adresse_ip_ici`) et que le mot de passe de la base de données vous convient :

   ```env
   APP_HOST_IP=votre_adresse_ip_ici
   APP_PORT=80
   POSTGRES_PASSWORD=your_db_password
   CORS_ORIGIN=http://votre_adresse_ip_ici
   APP_URL=http://votre_adresse_ip_ici
   ```

3. **Clés et jetons optionnels (Discogs, Google Books, Last.fm, GitHub) :** Renseignez vos clés API si vous souhaitez activer les fonctionnalités avancées d'import de métadonnées et l'indicateur de mise à jour GitHub (laissez vide si vous n'en avez pas l'utilité immédiate).

#### 4. Configuration des dossiers et des permissions de stockage

Le backend utilise un dossier local pour persister les jaquettes et images de manière sécurisée sur le disque de l'hôte. Préparez ce répertoire :

```bash
mkdir -p uploads/vinyls uploads/comics

# Le conteneur backend s'exécute sous l'UID 1000 (utilisateur node).
# Attribuez les bonnes permissions pour éviter les erreurs d'écriture :
sudo chown -R 1000:1000 uploads
chmod 775 uploads uploads/vinyls uploads/comics
```

#### 5. Lancement de l'application avec Docker Compose

Tout est prêt. Lancez le déploiement en arrière-plan en demandant la construction des images :

```bash
docker compose up -d --build
```

#### 6. Vérification du déploiement

Suivez les logs de démarrage pour vous assurer que les services (`db`, `backend`, `frontend`) s'initialisent correctement sans erreur :

```bash
docker compose logs -f
```

Vérifiez l'état des conteneurs :

```bash
docker compose ps
```

- **Base de données :** À la toute première création, PostgreSQL exécutera automatiquement le script d'initialisation (`database/init.sql`) pour créer les tables et le compte administrateur par défaut.
- **Accès :** L'application est désormais accessible sur le réseau à l'adresse **`http://votre_adresse_ip_ici`**.

### B. Windows — mode natif (sans Docker)

Cette section décrit l'installation **native** de l'application sur une machine Windows : Node.js et PostgreSQL s'exécutent directement sur la machine, sans conteneur. Le projet est structuré en deux dossiers distincts (`backend/` et `frontend/`), chacun disposant de son propre `package.json`.

#### Prérequis techniques

| Logiciel | Version | Rôle |
| --- | --- | --- |
| **Node.js** | **LTS 20.x ou 22.x** (≥ 20, recommandé : dernière LTS) + npm inclus | Runtime du backend Express et du frontend Vite/React |
| **PostgreSQL** | **16.x** (Windows x64, installateur officiel EDB) | Base de données locale |
| **Git for Windows** | Récent | Clonage du dépôt et mises à jour (`git pull`) |

Vérifications rapides dans un terminal **PowerShell** :

```powershell
node --version    # v20.x / v22.x
npm --version     # 10.x
psql --version    # PostgreSQL 16.x (après l'installation)
git --version
```

> **PostgreSQL sur Windows** : téléchargez le package officiel sur le site d'EDB/PostgreSQL. L'installateur configure automatiquement le service Windows « PostgreSQL 16 » au démarrage. Notez bien le mot de passe du superutilisateur `postgres` défini lors de l'installation, il vous sera demandé pour initialiser la base.

#### Étape 1 — Récupération du projet

Placez-vous dans votre dossier de travail (par exemple `C:\Users\votre_utilisateur`) et clonez ou placez les fichiers du projet dans `geek0thek` :

```powershell
cd C:\Users\votre_utilisateur
git clone <url-du-depot-git> geek0thek
cd geek0thek
```

L'arborescence locale est alors la suivante :

```text
geek0thek/
├── .env.example        # Template des variables d'environnement
├── database/init.sql   # Schéma et données initiales (seed admin)
├── uploads/            # Dossier de stockage des jaquettes (créé automatiquement)
├── backend/            # API Express
└── frontend/           # Interface React + Vite
```

#### Étape 2 — Configuration de la base de données PostgreSQL

Ouvrez l'outil **psql** (disponible depuis le menu Démarrer ou via le chemin d'installation `C:\Program Files\PostgreSQL\16\bin\psql.exe`) en vous connectant en tant qu'administrateur (`-U postgres`). Saisissez le mot de passe défini à l'installation.

Créez l'utilisateur dédié et la base de données (remplacez `votre_mot_de_passe_postgres` par un mot de passe fort de votre choix) :

```sql
CREATE USER vinyl WITH PASSWORD 'votre_mot_de_passe_postgres';
CREATE DATABASE geek0thek OWNER vinyl;
\q
```

Exécutez ensuite le script d'initialisation pour mettre en place le schéma (tables `users`, `vinyls`, `comics`, vues publiques) et le compte administrateur par défaut (`admin` / `admin`) :

```powershell
psql -U postgres -d geek0thek -f "C:\Users\votre_utilisateur\geek0thek\database\init.sql"
```

Vérification de la bonne création des tables :

```powershell
psql -U vinyl -d geek0thek -c "\dt"
```

> **Chemin psql** : si la commande `psql` n'est pas reconnue directement dans votre terminal, préfixez-la avec le chemin complet de l'exécutable : `"C:\Program Files\PostgreSQL\16\bin\psql.exe"`.

#### Étape 3 — Configuration des variables d'environnement

Dupliquez le fichier modèle `.env.example` pour créer votre fichier `.env` actif à la racine du projet :

```powershell
cd C:\Users\votre_utilisateur\geek0thek
copy .env.example .env
```

Ouvrez le fichier `.env` avec votre éditeur et ajustez les paramètres pour le mode natif Windows :

```env
# --- Base de données PostgreSQL (locale) -------------------------
DB_HOST=localhost
DB_PORT=5432
DB_USER=vinyl
DB_PASSWORD=votre_mot_de_passe_postgres
DB_NAME=geek0thek

# --- Backend (API Express) --------------------------------------
PORT=8080
NODE_ENV=development
# OBLIGATOIRE : générer une longue chaîne aléatoire (ex: openssl rand -hex 64)
JWT_SECRET=votre-secret-aleatoire-long-ici
CORS_ORIGIN=http://localhost:5173

# --- Stockage des jaquettes (chemin absolu local) ---------------
UPLOAD_DIR=C:\Users\votre_utilisateur\geek0thek\uploads
MAX_UPLOAD_MB=10

# --- URL publique de l'application ------------------------------
APP_URL=http://localhost:5173
```

#### Étape 4 — Installation des dépendances et lancement

Ouvrez **deux terminaux PowerShell séparés** pour lancer le backend et le frontend en parallèle :

**Terminal 1 — Backend (API Express sur le port 8080) :**

```powershell
cd C:\Users\votre_utilisateur\geek0thek\backend
npm install
npm run dev       # Mode développement avec rechargement automatique
```

**Terminal 2 — Frontend (Serveur Vite sur le port 5173) :**

```powershell
cd C:\Users\votre_utilisateur\geek0thek\frontend
npm install
npm run dev       # Serveur de dev Vite avec proxy intégré vers le backend
```

L'application est désormais accessible sur votre navigateur à l'adresse **`http://localhost:5173`**. Connectez-vous avec le compte administrateur initial (`admin` / `admin`).

#### Commandes utiles (mode natif Windows)

- **Arrêter les services** : appuyez sur `Ctrl+C` dans chacun des terminaux PowerShell.
- **Vérifier la santé de l'API** :

  ```powershell
  curl http://localhost:8080/api/health
  ```

- **Sauvegarde de la base de données** :

  ```powershell
  pg_dump -U vinyl -Fc geek0thek > backup.dump
  ```

- **Mise à jour du code** :

  ```powershell
  git pull
  cd backend; npm install
  cd ../frontend; npm install
  ```

---

## 💙 Soutenir le projet

**Geek0thek est un projet conçu, développé et hébergé en solo, sur fonds propres.**
L'hébergement (VM, base de données, stockage des couvertures), la maintenance et le développement continu sont entièrement pris en charge par l'auteur.

Si cette médiathèque vous est utile et que vous souhaitez contribuer à sa pérennité, vous pouvez faire un **don libre** via PayPal :

👉 **[Soutenez le projet en faisant un don via PayPal](https://www.paypal.com/donate/?hosted_button_id=Y7LQW3UKPY5VN)**

- **Aucun montant minimum ni maximum** : chaque contribution, quelle qu'en soit la taille, est la bienvenue et finance directement l'hébergement et le développement.
- Le bouton **« Soutenez le projet »** est également disponible en permanence dans le pied de page de l'application (il s'adapte au thème visuel actif).

Merci pour votre soutien ! 🙏

---

## 🔑 Comment se connecter pour la première fois ?

- **Identifiants de départ :** Pour votre toute première connexion, utilisez le compte par défaut avec le nom d'utilisateur `admin` et le mot de passe `admin`.
- **Rôle Administrateur :** Ce compte administrateur est le seul qui possède les droits pour créer, modifier ou supprimer d'autres comptes utilisateurs.
- **Sécurité des mots de passe :** Vos mots de passe ne sont jamais enregistrés en clair : ils sont systématiquement protégés et cryptés grâce à un système de hachage hautement sécurisé (bcrypt).

---

## 🔒 La sécurité lors de la création d'un compte (Onboarding forcé)

Si un administrateur vous crée un nouveau compte, l'application vous oblige à sécuriser votre accès dès votre première connexion :

1. **Le blocage temporaire :** Lorsque vous vous connectez avec un compte nouvellement créé par un administrateur, l'accès au reste de l'application est bloqué. Vous êtes automatiquement redirigé vers une page spéciale (**Onboarding**).
2. **Le changement obligatoire :** Sur cette page, vous devez obligatoirement choisir un nouveau mot de passe (qui doit faire au moins 8 caractères, être différent du provisoire et être saisi deux fois). Vous pouvez également personnaliser votre nom d'utilisateur si vous le souhaitez.
3. **Le retour à la normale :** Une fois validé, votre nouveau mot de passe est enregistré en toute sécurité, le blocage est levé, et vous accédez directement au tableau de bord de l'application.

> **À noter :** Si un administrateur réinitialise votre mot de passe à l'avenir, cette procédure de sécurité se réenclenchera automatiquement lors de votre connexion suivante.

---

## 📅 Le rappel de sécurité tous les 6 mois (Comptes sans 2FA)

Pour vous aider à garder votre compte en sécurité, l'application effectue une vérification automatique régulière :

- **Un rappel amical par e-mail :** Si vous n'avez pas activé la **double authentification (2FA)** pour protéger votre compte, vous recevrez un e-mail **tous les 6 mois** vous conseillant de changer votre mot de passe et d'activer cette sécurité supplémentaire.
- **Aucun blocage de votre compte :** Il s'agit uniquement d'une recommandation par e-mail. Cela **ne bloque jamais votre accès** à l'application et ne change pas vos identifiants. Vous pouvez continuer à utiliser votre compte normalement.
- **Pas de spam :** Le système enregistre la date du dernier envoi pour s'assurer que vous ne receviez **jamais plus d'un e-mail de rappel tous les 6 mois**.
- **Condition :** Ces e-mails de prévention ne sont envoyés que si le service de messagerie (SMTP) de l'application est configuré par l'administrateur.

---

## 🔄 L'indicateur automatique de mise à jour (GitHub)

L'application vérifie d'elle-même si une nouvelle version est disponible sur internet :

- **Vérification automatique :** À chaque ouverture de l'application (puis discrètement toutes les 5 minutes), le système compare la version installée sur votre serveur avec la dernière version publiée sur le dépôt GitHub du projet.
- **Le bouton d'alerte :**
  - Tant que votre application est parfaitement à jour, **aucun bouton ne s'affiche**.
  - Dès qu'une nouvelle mise à jour est publiée, un **bouton « Mise à jour disponible »** apparaît en haut à droite de l'écran.
- **Comment faire la mise à jour ?** En passant votre souris sur ce bouton, une petite bulle s'affiche avec la commande à exécuter sur votre serveur (`git pull && docker compose up -d --build`).
- **Disparition automatique :** Une fois la mise à jour appliquée sur le serveur, l'application le détecte toute seule et le bouton disparaît automatiquement.

---

## ✉️ Configuration des notifications E-mail (SMTP)

L'application peut envoyer des **notifications par e-mail** automatiques dans les cas suivants :

- **Création de compte par un admin** : le nouvel utilisateur reçoit un e-mail confirmant la création de son compte avec ses accès (identifiant + mot de passe provisoire).
- **Partage de bibliothèque** : quand un utilisateur ouvre l'accès en consultation à sa collection à un autre utilisateur, ce dernier reçoit un e-mail de notification.
- **Réinitialisation du mot de passe** (« identifiant / mot de passe oublié ») : le propriétaire du compte reçoit un lien temporaire (jeton à usage unique, validité 1 h).
- **Rappel de sécurité semestriel (comptes SANS 2FA)** : tous les 6 mois, chaque utilisateur actif qui n'a **pas** activé l'authentification à deux facteurs (2FA) reçoit un e-mail d'**information** l'invitant à changer son mot de passe et à activer la 2FA. Ce rappel est **non bloquant** : il ne bloque jamais l'accès à l'application (voir section *Rappel de sécurité semestriel* ci-dessus).

Ces envois sont pilotés **exclusivement par les variables d'environnement** du fichier `.env` (à la racine du projet). Chaque utilisateur configure ainsi **son propre serveur SMTP** — aucun code à modifier.

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
| --- | --- |
| `SMTP_HOST` | Hôte du serveur SMTP (ex. `smtp.gmail.com`, `mail.exemple.fr`) |
| `SMTP_PORT` | Port : **465** (TLS/SSL implicite) ou **587** (STARTTLS) |
| `SMTP_USER` | Identifiant de connexion SMTP (généralement votre adresse e-mail) |
| `SMTP_PASS` | Mot de passe SMTP (ou « app password » si votre fournisseur l'exige, ex. Gmail) |
| `SMTP_FROM` | Expéditeur affiché : `« Nom <adresse> »` (optionnel — repli sur `SMTP_USER`) |

> **Port 465 vs 587** : le backend détecte automatiquement le mode de chiffrement à partir du port (`465` → TLS implicite, `587` → STARTTLS). Une surcharge manuelle est possible via `SMTP_SECURE=true|false`.

### Variables vides = notifications désactivées (sans erreur)

Si `SMTP_HOST`, `SMTP_USER` ou `SMTP_PASS` restent **vides**, l'application fonctionne **normalement** : les notifications e-mail sont simplement **désactivées** proprement (un avertissement est journalisé en console au démarrage, jamais de crash). L'envoi d'e-mails est **non bloquant** : un échec d'envoi (réseau, authentification, adresse invalide…) ne fait **jamais** échouer l'action qui l'a déclenché (création du compte, partage de la bibliothèque).

### Appliquer la configuration

Après avoir modifié `.env`, recréez le conteneur backend pour charger les nouvelles variables :

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

## 🖥️ Configuration d'un reverse proxy externe (Nginx)

Le frontend (nginx interne) et le backend (Express `trust proxy = 1`) sont déjà câblés pour recevoir les en-têtes `X-Forwarded-*`. Exemple **nginx** pour un reverse proxy sur la VM (domaine `vinyle.exemple.fr`) :

```nginx
# 1. Définition du Backend avec Keep-Alive
upstream stream-[nomchoisipourVM] {
    server [votre_ip_locale];
    keepalive 32; # Maintient les connexions ouvertes vers la VM
}

# 2. Serveur HTTPS Principal
server {
    listen 443 ssl; # managed by Certbot
    server_name [votre_nom_domaine];

    # Uploads volumineux (jaquettes / couvertures BD)
    client_max_body_size 15m;

    # Certificats Let's Encrypt (Certbot)
    ssl_certificate /etc/letsencrypt/live/[votre_nom_domaine]/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/[votre_nom_domaine]/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

    # Inclusion de la règle centralisée security.txt
    include /etc/nginx/snippets/security-txt.conf;

    # Logs
    access_log /var/log/nginx/[nomchoisipourVM].access.log;
    error_log  /var/log/nginx/[nomchoisipourVM].error.log;

    # --- EN-TÊTES DE SÉCURITÉ SÉCURISÉS (Proprement déclarés) ---
    add_header Content-Security-Policy "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; script-src 'self' 'unsafe-inline';" always;
    #add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline';" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Cross-Origin-Resource-Policy "same-origin" always;
    add_header Cross-Origin-Embedder-Policy "require-corp" always;

    # Communication Proxy avec la VM
    location / {
        proxy_pass http://stream-[nomchoisipourVM];
        proxy_redirect default;

        # HTTP/1.1 + Keep-Alive
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        # Transmettre les informations complètes du client à la VM interne
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        proxy_headers_hash_max_size 512;
        proxy_headers_hash_bucket_size 128;

        # Support WebSocket (si besoin en amont de l'API)
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}

# 3. Redirection HTTP vers HTTPS propre (Port 80)

server {
    if ($host = [votre_nom_domaine]) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    server_name [votre_nom_domaine];
    listen 80;
    return 404; # managed by Certbot


}
```

> L'application fonctionne **sans** reverse proxy (HTTP port 80) ; le proxy n'est nécessaire que pour HTTPS/SNI ou un domaine public.

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

## 🩺 Dépannage

| Symptôme | Cause probable / solution |
| --- | --- |
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

---

## 💙 Soutenir le projet

**Geek0thek est un projet conçu, développé et hébergé en solo, sur fonds propres.**
L'hébergement (VM, base de données, stockage des couvertures), la maintenance et le développement continu sont entièrement pris en charge par l'auteur.

Si cette médiathèque vous est utile et que vous souhaitez contribuer à sa pérennité, vous pouvez faire un **don libre** via PayPal :

👉 **[Soutenez le projet en faisant un don via PayPal](https://www.paypal.com/donate/?hosted_button_id=Y7LQW3UKPY5VN)**

- **Aucun montant minimum ni maximum** : chaque contribution, quelle qu'en soit la taille, est la bienvenue et finance directement l'hébergement et le développement.
- Le bouton **« Soutenez le projet »** est également disponible en permanence dans le pied de page de l'application (il s'adapte au thème visuel actif).

Merci pour votre soutien ! 🙏

---

## Licence & Politique de contribution

Ce logiciel est distribué sous licence **GNU Affero General Public License v3.0 (AGPLv3)**.

Toutefois, le dépôt officiel **n'accepte aucune contribution externe ni aucune Pull Request** de la part de tiers. Vous êtes totalement libre de forker le projet et de l'utiliser conformément aux termes de la licence AGPLv3, mais aucun code extérieur ne sera fusionné dans la branche principale.

Consultez le fichier [LICENSE](LICENSE) pour plus d'informations.
