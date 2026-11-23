# 💿📚 Geek0thek — Personal Media Library

---

## Project description

A containerized full-stack web application for managing collections of **Records (vinyl / CD)** and **Comics (BD / Manga / Comics)** — both fully supported today. **Video games, role-playing games, books/magazines** and other collections are on the roadmap (*coming soon*) and are not yet active.

---

## 💙 Support the project

**Geek0thek is a solo project — designed, developed and hosted by a single developer, at their own expense.**
Hosting (VM, database, cover storage), maintenance and ongoing development are entirely funded by the author.

If this media library is useful to you and you'd like to help keep it running, you can make a **free donation** via PayPal:

👉 **[Support the project with a PayPal donation](https://www.paypal.com/donate/?hosted_button_id=Y7LQW3UKPY5VN)**

- **No minimum or maximum amount**: every contribution, of any size, is welcome and directly funds hosting and development.
- The **"Support the project"** button is also permanently available in the application footer (it adapts to the active visual theme).

Thank you for your support! 🙏

---

## Try the demo

🔗 **Live demo:** <https://demothek.igerarts.be>

| Username | Password |
| --- | --- |
| `demo` | `demo` |

---

## Key features

**Geek0thek** is a modern full-stack web application built from scratch to centralize, organize and showcase your collection of physical media: **vinyl records / CDs** and **comics (BD / manga)** are fully supported today, while **video games, role-playing games, books and magazines** are on the roadmap (*coming soon*). Designed for a smooth, immersive and highly customizable experience, the platform combines rigorous data management with a polished visual aesthetic.

### 1. Multi-library & collection management

- **Media diversity:** Native support for the active collections — **Records (vinyl / CD)** and **Comics** — with descriptive record sheets tailored to each cultural domain. Video games, RPGs, books and other collections are on the roadmap (*coming soon*).
- **Imports & metadata:** Integration of external APIs (such as Discogs and Google Books) plus barcode scanning (via smartphone) to simplify adding items.
- **Data consistency:** Smart normalization mechanisms — for example, the musical genre of the first record added for an artist is automatically replicated for subsequent additions by the same group.

### 2. Visual identity & custom themes

- **Thematic immersion:** The application offers several distinct, memorable visual universes (such as the *Library* theme with its warm tones, the *Neon* theme using specific typographic fonts like Neuropol, or the *Record Shop* theme with retro 80s-inspired accents).
- **User preference management:** Each user's favorite theme is stored in the database, ensuring their choice persists across reconnections.
- **Responsive interface:** Ergonomic interaction buttons (quick navigation, back-to-top button positioned above the footer) and full multilingual support (French, English, Dutch) with automatic browser language detection.

### 3. Security & roles

- **Secure authentication:** User profile management and integration of advanced security options (Two-Factor Authentication / 2FA).
- **Version traceability:** Dynamic display of the official GitHub Release number in the footer, ensuring clear tracking of deployed versions.

### 4. Architecture & tech stack

- **Modern stack:** Built around a Node.js / Express backend and a React / Tailwind CSS frontend, backed by a robust PostgreSQL database optimized for large data volumes and extended labels.
- **Native, self-hosted approach:** Designed to run natively on Linux, reflecting a commitment to independence from proprietary cloud solutions in favor of local, high-performance and sovereign infrastructure. A native Windows installation is also possible.

---

## 📂 Project structure & layers / technologies

```text
geek0thek/
├── .env                        # Production environment variables
├── .gitignore
├── package.json                # Global configuration / scripts
├── README.md
├── database/
│   └── init.sql                # Database schema (tables, widened TEXT/VARCHAR types)
├── uploads/                    # Local volume for covers and images
│   ├── vinyls/                 # Record sleeves
│   └── comics/                 # Comic covers
├── backend/
│   ├── package.json            # Backend dependencies (express, pg, multer, etc.)
│   └── src/
│       ├── server.js           # Express app, static /uploads, proxy trust, routes
│       ├── config/
│       │   ├── db.js           # PostgreSQL pool (pg)
│       │   └── env.js          # Centralized configuration (env)
│       ├── middlewares/
│       │   ├── auth.js         # JWT (authenticate) + requireAdmin
│       │   └── upload.js       # Multer (independent sleeve/series upload handling)
│       ├── controllers/
│       │   ├── authController.js
│       │   ├── userController.js    # Profile, preference and theme management
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
│           ├── discogsClient.js     # Discogs (barcode / release lookup)
│           └── isbnClient.js        # Google Books / Open Library by ISBN
└── frontend/
    ├── package.json            # Frontend dependencies (React, Vite, Tailwind, i18next)
    ├── tailwind.config.js
    └── src/
        ├── App.jsx             # Routing + contexts (auth, themes, i18n)
        ├── index.css           # Visual themes and Tailwind styles
        ├── main.jsx
        ├── components/
        │   ├── Navbar.jsx
        │   ├── Footer.jsx      # Footer including dynamic GitHub release display
        │   ├── TopButton.jsx   # Back-to-top button positioned above the footer
        │   ├── ProtectedRoute.jsx
        │   ├── VinylCard.jsx
        │   ├── BarcodeModal.jsx
        │   ├── ComicCard.jsx
        │   └── IsbnModal.jsx
        ├── locales/            # i18n translation dictionaries (fr, en, nl) for all sections
        ├── pages/
        │   ├── Login.jsx
        │   ├── Onboarding.jsx      # First-login security
        │   ├── Dashboard.jsx
        │   ├── Collection.jsx      # User's vinyl records
        │   ├── ComicCollection.jsx # User's comics
        │   ├── PublicCollection.jsx# Public collections
        │   ├── AddVinyl.jsx
        │   ├── AddComic.jsx
        │   ├── Profile.jsx         # User settings, security (2FA) and themes
        │   └── AdminUsers.jsx
        └── services/
            └── api.js          # REST client (JWT, multipart, 401 handling)
```

| Layer | Technologies / Tools | Role & characteristics |
| --- | --- | --- |
| **Frontend (Presentation)** | **React**, **Vite**, **Tailwind CSS** | Dynamic user interface (SPA), responsive, with customizable themes (Library, Neon, Record Shop). |
| **Internationalization & UI** | **i18next**, **Lucide Icons** / **React Icons** | Multilingual support (FR, EN, NL), language detection and UI components (Top button, dynamic footer). |
| **Backend (API / Server)** | **Node.js**, **Express.js** | REST API for data management, authentication and multipart processing (uploads). |
| **Security & Authentication** | **JWT (JSON Web Tokens)**, **bcrypt**, **express-rate-limit** | Secure authentication, password hashing, 2FA handling and anti-bot/rate-limiting protection. |
| **Database (Data)** | **PostgreSQL** (`pg`) | Robust relational database with widened types (`TEXT`) to avoid label size limitations. |
| **File Storage** | **Multer**, local file system | Local management and organization of record sleeves, comic covers and media images in `/uploads`. |
| **External Services & APIs** | **Discogs API**, **MusicBrainz**, **Cover Art Archive**, **Google Books / Open Library** | Collection metadata and automatic information retrieval via barcode / ISBN. |
| **Infrastructure & Host** | **Debian 12 (Bookworm)**, **Nginx** | Native self-hosted deployment on a dedicated VM with HTTPS reverse proxy and local DNS management (`dnsmasq`). |

---

## ⚙️ Minimum system specifications

The application runs under **Docker Compose** with **3 containers**: PostgreSQL 16, Node.js 22 backend (Express API) and nginx frontend. The specifications below are those recommended to run it **comfortably** on the host VM.

### Hardware

| Resource | Minimum | Recommended |
| --- | --- | --- |
| **CPU** | 2 cores (vCPU) | 4 cores (vCPU) |
| **RAM** | 2 GB | 4 GB |
| **Free disk space** | 10 GB | 30 GB+ (uploaded/downloaded covers accumulate in `./uploads`) |
| **Network** | Outgoing internet connection (egress) | — |

> **Indicative RAM breakdown**: PostgreSQL ~500 MB, Node.js backend ~300 MB, nginx ~50 MB, the rest for the OS and Docker. Below 2 GB, barcode/ISBN imports (cover download + re-hosting) can become slow or trigger OOM errors.

### Software (host prerequisites)

| Software | Version | Role |
| --- | --- | --- |
| **Operating system** | Debian 12 (target) — any Docker-compatible Linux works, or Windows 10/11 with Docker Desktop (WSL 2) | A native Windows mode (without Docker) is also available |
| **Docker Engine** | ≥ 24.x (latest stable) | Container execution |
| **Docker Compose** | v2 (`docker compose` plugin) | Orchestration of db + backend + frontend |
| **Git** | recent | Deployment (`git clone`) and updates (`git pull`) |

### Outgoing network access (egress)

The application requires an **outgoing internet connection** for:

- **Vinyl imports**: MusicBrainz, Cover Art Archive, Discogs (if `DISCOGS_TOKEN` is set), Last.fm.
- **Comic imports**: Google Books, Open Library.
- **Update indicator**: GitHub API (private repository → `GITHUB_TOKEN`).

Without egress, the application works normally (local collections, authentication) but barcode/ISBN imports fail (`502`).

> The only required incoming port is **port 80** (frontend). PostgreSQL (5432) and the backend API (8080) remain **internal to the Docker network** and are not exposed on the host.

---

## 🚀 Step-by-step installation

### A. Linux — Docker Compose

#### 1. System preparation (Docker Engine + Docker Compose)

Connect to your VM over SSH, then prepare the system and install the required tools:

```bash
# Update the system
sudo apt update && sudo apt upgrade -y

# Install dependencies and the official Docker repository
sudo apt install -y curl git apt-transport-https ca-certificates gnupg lsb-release
curl -fsSL https://get.docker.com | sudo sh

# Add your user to the docker group to avoid using sudo for every command
sudo usermod -aG docker $USER
```

*Note: If you just added your user to the docker group, log out of the SSH session (`exit`) and reconnect to apply the change.*

Verify that everything is in place:

```bash
docker --version
docker compose version
```

Also verify that the VM's IP address matches the one expected by the configuration (`your_ip_address_here`):

```bash
ip addr
```

#### 2. Fetching the project files (Git)

Create the installation directory (e.g. in `/opt`), clone your repository, then move into it:

```bash
sudo mkdir -p /opt && cd /opt

# Clone the repository into the geek0thek folder (adjust your repository URL if needed)
sudo git clone <url-of-git-repo> geek0thek

# Give ownership of the folder to your current user
sudo chown -R $USER:$USER /opt/geek0thek
cd /opt/geek0thek
```

#### 3. Configuring the `.env` file

The project ships with a configuration template. Duplicate it to create your active `.env` file:

```bash
cp .env.example .env
```

Open the `.env` file with your favorite editor (e.g. `nano .env`) and adjust the key values:

1. **JWT security (required):** Generate a secure random string by running the following command in another terminal:

   ```bash
   openssl rand -hex 64
   ```

   Copy the result and paste it in place of the default value:

   ```env
   JWT_SECRET=your_generated_random_string_here
   ```

2. **Network and database settings:** Make sure the listening IP matches your environment (`your_ip_address_here`) and that the database password suits you:

   ```env
   APP_HOST_IP=your_ip_address_here
   APP_PORT=80
   POSTGRES_PASSWORD=your_db_password
   CORS_ORIGIN=http://your_ip_address_here
   APP_URL=http://your_ip_address_here
   ```

3. **Optional keys and tokens (Discogs, Google Books, Last.fm, GitHub):** Fill in your API keys if you want to enable the advanced metadata import features and the GitHub update indicator (leave them empty if you don't need them right away).

#### 4. Configuring storage folders and permissions

The backend uses a local folder to persist sleeves and images securely on the host disk. Prepare this directory:

```bash
mkdir -p uploads/vinyls uploads/comics

# The backend container runs as UID 1000 (node user).
# Set the right permissions to avoid write errors:
sudo chown -R 1000:1000 uploads
chmod 775 uploads uploads/vinyls uploads/comics
```

#### 5. Authenticating to the GHCR registry (if packages are not public)

The backend and frontend images are pre-built by the GitHub Actions workflow (`docker-publish.yml`) and published on GitHub Container Registry (`ghcr.io`). If your GitHub packages are **not** publicly visible, authenticate on the production server with a Personal Access Token (PAT) having the `read:packages` permission:

```bash
# CR_PAT = your GitHub PAT (scope read:packages)
echo $CR_PAT | docker login ghcr.io -u Irwin0812 --password-stdin
```

> If the packages are public, this step is optional.

#### 6. Starting the application with Docker Compose

Everything is ready. Start the deployment in the background (images are pulled from GHCR):

```bash
docker compose pull
docker compose up -d
```

#### 7. Verifying the deployment

Follow the startup logs to make sure the services (`db`, `backend`, `frontend`) initialize correctly without errors:

```bash
docker compose logs -f
```

Check the container status:

```bash
docker compose ps
```

- **Database:** On the very first creation, PostgreSQL automatically runs the initialization script (`database/init.sql`) to create the tables and the default administrator account.
- **Access:** The application is now accessible on the network at **`http://your_ip_address_here`**.

### B. Windows — Docker Desktop (WSL 2)

This section describes how to run the full Docker Compose stack on a Windows machine using **Docker Desktop** with the **WSL 2** backend. The same `docker-compose.yml` and `.env` files as on Linux are used; only the preparation steps differ.

#### 1. System preparation (Docker Desktop + Git)

On Windows, do not use `apt` or the `get.docker.com` script: install **Docker Desktop** (which includes Docker Engine, Docker Compose and the WSL 2 backend) as well as **Git for Windows**.

Install both via `winget` in an **elevated PowerShell** terminal:

```powershell
winget install -e --id Docker.DockerDesktop
winget install -e --id Git.Git
```

- Launch Docker Desktop and let it start completely (make sure **Use the WSL 2 based engine** is enabled in *Settings > General*).
- Verify Docker and Compose in PowerShell (or Git Bash):

```powershell
docker --version
docker compose version
```

- Check the local IP address of your Windows machine on the network (`ipconfig` → locate the IPv4 address of your active Wi-Fi or Ethernet adapter, e.g. `192.168.1.50` or `172.16.x.x`).

#### 2. Fetching the project files (Git)

Create a dedicated folder (e.g. `C:\geek0thek` or `C:\Users\YourName\geek0thek`) and clone the repository:

```powershell
mkdir C:\geek0thek
cd C:\geek0thek
git clone <url-of-git-repo> .
```

- Verification: `dir` (or `ls` in Git Bash) displays `docker-compose.yml` and `.env.example` at the root of `C:\geek0thek`.

#### 3. Configuring the `.env` file

Duplicate the configuration template:

```powershell
copy .env.example .env
```

*(In Git Bash, use `cp .env.example .env`.)*

- Open `.env` with Notepad or VS Code (`notepad .env`) and fill in your settings:
  - **JWT secret (required):** Generate a random 64-byte hex string via PowerShell:

    ```powershell
    -join ((1..64) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
    ```

    *(If OpenSSL is installed, `openssl rand -hex 64` also works.)* Paste the result into `JWT_SECRET=...`.

  - **Network and database:** Adapt the IP address to the one found with `ipconfig` (or `localhost` if accessing only from this PC):

    ```env
    APP_HOST_IP=your_local_ip
    APP_PORT=80
    POSTGRES_PASSWORD=your_db_password
    CORS_ORIGIN=http://your_local_ip
    APP_URL=http://your_local_ip
    ```

    > **Note:** If port `80` is already in use on Windows (by IIS, Skype, another web server or a local service), set `APP_PORT=8080` and update `CORS_ORIGIN` / `APP_URL` accordingly (`http://your_local_ip:8080`).

  - **Optional API keys:** Fill in Discogs, Google Books, Last.fm or GitHub tokens if needed, or leave them empty for now.

#### 4. Preparing storage folders

On Windows there is no `chown` or POSIX permissions (`chmod 775`): WSL 2 / Docker Desktop automatically handles host-to-container volume mounts.

Create the local folders:

```powershell
mkdir uploads\vinyls
mkdir uploads\comics
```

- Verification: `C:\geek0thek\uploads\vinyls` and `C:\geek0thek\uploads\comics` exist. If the backend container encounters a write error on `uploads`, verify that Docker Desktop has access to the `C:` drive in *Settings > Resources > File sharing*.

#### 5. Authenticating to the GHCR registry (if packages are private)

If the images on `ghcr.io` are private, authenticate with your GitHub Personal Access Token (PAT with `read:packages` scope):

In PowerShell:

```powershell
"YOUR_GITHUB_TOKEN" | docker login ghcr.io -u Irwin0812 --password-stdin
```

In Git Bash:

```bash
echo "$CR_PAT" | docker login ghcr.io -u Irwin0812 --password-stdin
```

- If the images are public, you can skip this step.

#### 6. Starting with Docker Compose

Pull the images and start the stack in the background:

```powershell
docker compose pull
docker compose up -d
```

- Verification: Docker pulls the `db`, `backend` and `frontend` images and starts the services without blocking errors.

#### 7. Verifying the deployment

Follow the startup logs to check PostgreSQL initialization (`database/init.sql`) and the services:

```powershell
docker compose logs -f
```

*(Press `Ctrl + C` to exit the logs.)*

Check the container status:

```powershell
docker compose ps
```

- Verification: the containers (`db`, `backend`, `frontend`) appear as started (`Up` / `running`). Open `http://your_local_ip` (or `http://localhost` if `APP_HOST_IP=localhost`) in your browser.

#### Key differences compared to Linux

- **No `sudo`, `chown` or `chmod`:** file permissions are handled on the Windows / WSL 2 side.
- **Paths and shell commands:** use `\` or `/` in paths, and adapt `cp` / `mkdir -p` when working in PowerShell (`copy` / `mkdir`).
- **Port 80 and Windows Firewall:** Windows sometimes blocks or occupies port 80, or prompts for firewall network authorization on first access from another device on the local network.

### C. Windows — native mode (without Docker)

This section describes the **native** installation of the application on a Windows machine: Node.js and PostgreSQL run directly on the machine, without containers. The project is structured into two distinct folders (`backend/` and `frontend/`), each with its own `package.json`.

#### Technical prerequisites

| Software | Version | Role |
| --- | --- | --- |
| **Node.js** | **LTS 20.x or 22.x** (≥ 20, recommended: latest LTS) + bundled npm | Runtime for the Express backend and Vite/React frontend |
| **PostgreSQL** | **16.x** (Windows x64, official EDB installer) | Local database |
| **Git for Windows** | recent | Cloning the repository and updates (`git pull`) |

Quick checks in a **PowerShell** terminal:

```powershell
node --version    # v20.x / v22.x
npm --version     # 10.x
psql --version    # PostgreSQL 16.x (after installation)
git --version
```

> **PostgreSQL on Windows**: download the official package from the EDB/PostgreSQL website. The installer automatically configures the "PostgreSQL 16" Windows service at startup. Make a note of the `postgres` superuser password set during installation — it will be required to initialize the database.

#### Step 1 — Fetching the project

Move to your working folder (e.g. `C:\Users\your_user`) and clone or place the project files into `geek0thek`:

```powershell
cd C:\Users\your_user
git clone <url-of-git-repo> geek0thek
cd geek0thek
```

The local structure is then as follows:

```text
geek0thek/
├── .env.example        # Environment variables template
├── database/init.sql   # Schema and initial data (admin seed)
├── uploads/            # Sleeve storage folder (created automatically)
├── backend/            # Express API
└── frontend/           # React + Vite interface
```

#### Step 2 — Configuring the PostgreSQL database

Open the **psql** tool (available from the Start menu or via the installation path `C:\Program Files\PostgreSQL\16\bin\psql.exe`) and connect as administrator (`-U postgres`). Enter the password set during installation.

Create the dedicated user and the database (replace `your_postgres_password` with a strong password of your choice):

```sql
CREATE USER vinyl WITH PASSWORD 'your_postgres_password';
CREATE DATABASE geek0thek OWNER vinyl;
\q
```

Then run the initialization script to set up the schema (`users`, `vinyls`, `comics` tables, public views) and the default administrator account (`admin` / `admin`):

```powershell
psql -U postgres -d geek0thek -f "C:\Users\your_user\geek0thek\database\init.sql"
```

Verify that the tables were created correctly:

```powershell
psql -U vinyl -d geek0thek -c "\dt"
```

> **psql path**: if the `psql` command is not recognized directly in your terminal, prefix it with the full executable path: `"C:\Program Files\PostgreSQL\16\bin\psql.exe"`.

#### Step 3 — Configuring environment variables

Duplicate the `.env.example` template file to create your active `.env` file at the project root:

```powershell
cd C:\Users\your_user\geek0thek
copy .env.example .env
```

Open the `.env` file with your editor and adjust the settings for native Windows mode:

```env
# --- PostgreSQL database (local) -------------------------
DB_HOST=localhost
DB_PORT=5432
DB_USER=vinyl
DB_PASSWORD=your_postgres_password
DB_NAME=geek0thek

# --- Backend (Express API) --------------------------------------
PORT=8080
NODE_ENV=development
# REQUIRED: generate a long random string (e.g. openssl rand -hex 64)
JWT_SECRET=your-long-random-secret-here
CORS_ORIGIN=http://localhost:5173

# --- Sleeve storage (absolute local path) ---------------
UPLOAD_DIR=C:\Users\your_user\geek0thek\uploads
MAX_UPLOAD_MB=10

# --- Public URL of the application ------------------------------
APP_URL=http://localhost:5173
```

#### Step 4 — Installing dependencies and starting

Open **two separate PowerShell terminals** to run the backend and frontend in parallel:

**Terminal 1 — Backend (Express API on port 8080):**

```powershell
cd C:\Users\your_user\geek0thek\backend
npm install
npm run dev       # Development mode with automatic reload
```

**Terminal 2 — Frontend (Vite server on port 5173):**

```powershell
cd C:\Users\your_user\geek0thek\frontend
npm install
npm run dev       # Vite dev server with built-in proxy to the backend
```

The application is now accessible in your browser at **`http://localhost:5173`**. Log in with the initial administrator account (`admin` / `admin`).

#### Useful commands (native Windows mode)

- **Stop the services**: press `Ctrl+C` in each PowerShell terminal.
- **Check API health**:

  ```powershell
  curl http://localhost:8080/api/health
  ```

- **Back up the database**:

  ```powershell
  pg_dump -U vinyl -Fc geek0thek > backup.dump
  ```

- **Update the code**:

  ```powershell
  git pull
  cd backend; npm install
  cd ../frontend; npm install
  ```

---

## 💙 Support the project

**Geek0thek is a solo project — designed, developed and hosted by a single developer, at their own expense.**
Hosting (VM, database, cover storage), maintenance and ongoing development are entirely funded by the author.

If this media library is useful to you and you'd like to help keep it running, you can make a **free donation** via PayPal:

👉 **[Support the project with a PayPal donation](https://www.paypal.com/donate/?hosted_button_id=Y7LQW3UKPY5VN)**

- **No minimum or maximum amount**: every contribution, of any size, is welcome and directly funds hosting and development.
- The **"Support the project"** button is also permanently available in the application footer (it adapts to the active visual theme).

Thank you for your support! 🙏

---

## 🔑 How to log in for the first time?

- **Starting credentials:** For your very first login, use the default account with username `admin` and password `admin`.
- **Administrator role:** This administrator account is the only one with the rights to create, modify or delete other user accounts.
- **Password security:** Your passwords are never stored in plain text: they are systematically protected and encrypted using a highly secure hashing system (bcrypt).

---

## 🔒 Security when creating an account (forced onboarding)

If an administrator creates a new account for you, the application forces you to secure your access on your very first login:

1. **Temporary lockout:** When you log in with an account newly created by an administrator, access to the rest of the application is blocked. You are automatically redirected to a special page (**Onboarding**).
2. **Mandatory change:** On this page, you must choose a new password (at least 8 characters, different from the temporary one, entered twice). You can also customize your username if you wish.
3. **Back to normal:** Once validated, your new password is securely stored, the lockout is lifted, and you go straight to the application dashboard.

> **Note:** If an administrator resets your password in the future, this security procedure will automatically re-trigger on your next login.

---

## 📅 The 6-monthly security reminder (accounts without 2FA)

To help you keep your account secure, the application performs a regular automatic check:

- **A friendly e-mail reminder:** If you have not enabled **Two-Factor Authentication (2FA)** to protect your account, you will receive an e-mail **every 6 months** recommending that you change your password and enable this extra security.
- **No account lockout:** This is only an e-mail recommendation. It **never blocks your access** to the application and does not change your credentials. You can continue using your account normally.
- **No spam:** The system records the date of the last send to ensure you **never receive more than one reminder e-mail every 6 months**.
- **Condition:** These preventive e-mails are only sent if the application's mail service (SMTP) has been configured by the administrator.

---

## 🔄 The automatic update indicator (GitHub)

The application checks by itself whether a new version is available online:

- **Automatic check:** Every time the application is opened (then discreetly every 5 minutes), the system compares the version installed on your server with the latest version published in the project's GitHub repository.
- **The alert button:**
  - As long as your application is fully up to date, **no button is displayed**.
  - As soon as a new update is published, an **"Update available"** button appears at the top right of the screen.
- **How to update?** Hovering over this button shows a small tooltip with the command to run on your server (`git pull && docker compose pull && docker compose up -d`).
- **Automatic disappearance:** Once the update has been applied on the server, the application detects it and the button disappears automatically.

---

## ✉️ E-mail notification configuration (SMTP)

The application can send **automatic e-mail notifications** in the following cases:

- **Account creation by an admin**: the new user receives an e-mail confirming their account creation with their credentials (username + temporary password).
- **Library sharing**: when a user opens read-only access to their collection for another user, the latter receives a notification e-mail.
- **Password reset** ("forgot username / password"): the account owner receives a temporary link (single-use token, 1-hour validity).
- **Semi-annual security reminder (accounts WITHOUT 2FA)**: every 6 months, each active user who has **not** enabled Two-Factor Authentication (2FA) receives an **informational** e-mail inviting them to change their password and enable 2FA. This reminder is **non-blocking**: it never blocks access to the application (see the *Semi-annual security reminder* section above).

These sends are driven **exclusively by the environment variables** in the `.env` file (at the project root). Each user thus configures **their own SMTP server** — no code changes required.

### Filling in your SMTP settings

Add (or complete) the following block in `.env`:

```env
# SMTP configuration for e-mail notifications
SMTP_HOST=smtp.your-server.com
SMTP_PORT=465 # or 587 depending on TLS/SSL
SMTP_USER=your-email@domain.com
SMTP_PASS=your-password
SMTP_FROM="Geek0thek <your-email@domain.com>"
```

| Variable | Description |
| --- | --- |
| `SMTP_HOST` | SMTP server host (e.g. `smtp.gmail.com`, `mail.example.com`) |
| `SMTP_PORT` | Port: **465** (implicit TLS/SSL) or **587** (STARTTLS) |
| `SMTP_USER` | SMTP login identifier (usually your e-mail address) |
| `SMTP_PASS` | SMTP password (or "app password" if your provider requires one, e.g. Gmail) |
| `SMTP_FROM` | Displayed sender: `"Name <address>"` (optional — falls back to `SMTP_USER`) |

> **Port 465 vs 587**: the backend automatically detects the encryption mode from the port (`465` → implicit TLS, `587` → STARTTLS). A manual override is possible via `SMTP_SECURE=true|false`.

### Empty variables = notifications disabled (without error)

If `SMTP_HOST`, `SMTP_USER` or `SMTP_PASS` remain **empty**, the application works **normally**: e-mail notifications are simply **disabled** cleanly (a warning is logged to the console at startup, never a crash). E-mail sending is **non-blocking**: a send failure (network, authentication, invalid address…) **never** fails the action that triggered it (account creation, library sharing).

### Applying the configuration

After modifying `.env`, recreate the backend container to load the new variables:

```bash
cd /opt/geek0thek
docker compose up -d --force-recreate backend
# or a full restart:
docker compose down && docker compose up -d --build
```

Verify in the logs (the "SMTP not configured" warning should disappear):

```bash
docker compose logs -f backend
```

---

## 🖥️ External reverse proxy configuration (Nginx)

The frontend (internal nginx) and the backend (Express `trust proxy = 1`) are already wired to receive the `X-Forwarded-*` headers. Example **nginx** configuration for a reverse proxy on the VM (domain `vinyle.example.com`):

```nginx
# 1. Backend definition with Keep-Alive
upstream stream-[namechosenforVM] {
    server [your_local_ip];
    keepalive 32; # Keeps connections open towards the VM
}

# 2. Main HTTPS server
server {
    listen 443 ssl; # managed by Certbot
    server_name [your_domain_name];

    # Large uploads (sleeves / comic covers)
    client_max_body_size 15m;

    # Let's Encrypt certificates (Certbot)
    ssl_certificate /etc/letsencrypt/live/[your_domain_name]/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/[your_domain_name]/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

    # Inclusion of the centralized security.txt rule
    include /etc/nginx/snippets/security-txt.conf;

    # Logs
    access_log /var/log/nginx/[namechosenforVM].access.log;
    error_log  /var/log/nginx/[namechosenforVM].error.log;

    # --- HARDENED SECURITY HEADERS (Properly declared) ---
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

    # Proxy communication with the VM
    location / {
        proxy_pass http://stream-[namechosenforVM];
        proxy_redirect default;

        # HTTP/1.1 + Keep-Alive
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        # Forward the full client information to the internal VM
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;

        proxy_headers_hash_max_size 512;
        proxy_headers_hash_bucket_size 128;

        # WebSocket support (if needed upstream of the API)
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}

# 3. Clean HTTP to HTTPS redirect (Port 80)

server {
    if ($host = [your_domain_name]) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    server_name [your_domain_name];
    listen 80;
    return 404; # managed by Certbot


}
```

> The application works **without** a reverse proxy (HTTP port 80); the proxy is only needed for HTTPS/SNI or a public domain.

---

## 🐳 Useful Docker Compose commands

```bash
# Pull the latest images from GHCR then start
docker compose pull
docker compose up -d

# Stop everything (volumes remain: data + uploads)
docker compose down

# Stop and DELETE the volumes (⚠️ WIPES the database)
docker compose down -v

# Follow the logs
docker compose logs -f
docker compose logs -f backend

# Status
docker compose ps

# Enter a container
docker compose exec backend sh
docker compose exec db psql -U vinyl -d geek0thek

# Recreate the admin after a "down -v" (already done by init.sql on first boot)
docker compose up -d db

# Quick database backup
docker compose exec db pg_dump -U vinyl -Fc vinyl > backup-$(date +%F).dump
# Restore:
docker compose exec -T db pg_restore -U vinyl -d geek0thek --clean < backup.dump
```

---

## 🩺 Troubleshooting

| Symptom | Likely cause / solution |
| --- | --- |
| Empty pages after login (navbar visible, no *Add* button, no lists) | `ProtectedRoute` was rendering `children` (undefined) as a **layout** route without `<Outlet/>` → fixed in `frontend/src/components/ProtectedRoute.jsx`. Rebuild + redeploy the frontend container: `docker compose up -d --build frontend` + **clear the browser cache** |
| `502` on barcode lookup | No (or lost) internet connection on the server side (MusicBrainz unreachable) → check the VM's network egress |
| `429` on barcode lookup | MusicBrainz quota reached (1 req/s) → retry after a few seconds |
| `404` on barcode lookup | Record unknown to both sources (MusicBrainz and Discogs) for this EAN → fill in the record manually (a `404` from a single source is **not** blocking: the other one is returned) |
| `401` / `403` on barcode lookup (Discogs) | Invalid/expired `DISCOGS_TOKEN` or missing permission → regenerate the token at <https://www.discogs.com/settings/developers> |
| `429` on barcode lookup (Discogs) | Token quota reached (default 25 min) → wait, or adjust `DISCOGS_RATE_LIMIT_PER_MINUTE` |
| Record without `discogs_url` / without `discogs_release_id` | Discogs not configured (`DISCOGS_TOKEN` empty) or record unknown to Discogs → normal, the MusicBrainz record is complete |
| `502` on ISBN lookup | No (or lost) internet connection on the server side (Google Books & Open Library unreachable) → check the VM's network egress |
| `404` on ISBN lookup | ISBN unknown or not referenced in Google Books / Open Library → fill in the record manually |
| `401` on an API call | Expired token → log in again |
| `/uploads/...` images returning 403/404 | Check `chown -R 1000:1000 uploads` + `chmod 775` on the `vinyls/` and `comics/` subfolders on the host |
| Collection not showing publicly (vinyl or comics) | The owner's *Visibility* toggle must be set to **Public** |
| Port 80 in use on the VM | Change `APP_PORT` in `.env` (e.g. `APP_PORT=8080`) |
| `column "acquired_date" does not exist` when editing a vinyl ("ADDED DATE" form) | Column missing from the `vinyls` table: known root cause = **the `public_vinyls` view (init.sql, `SELECT v.*`)** carries a PostgreSQL dependency on the old `year_acquired` column, which blocked the `DROP COLUMN` at the end of the migration and **rolled back** the `ADD COLUMN acquired_date`. Both scripts repair it with no side effects: `database/migrations/007_ensure_vinyl_acquired_date.sql` (psql) + auto-migration `vinyls.added-date` (`backend/src/config/db.js`, recreates the view identically after the drop). `GET /api/health` reports `schema_ok: false` as long as the column is missing |
| `Incomplete database (missing column)` on POST/PUT `/api/vinyls` | Same cause: run `docker compose exec -T db psql -U vinyl -d geek0thek -f /dev/stdin < database/migrations/007_ensure_vinyl_acquired_date.sql` then `docker compose restart backend`; check the startup logs (`migration applied: vinyls.added-date`) |
| Cleanly restart the database | `docker compose down -v` then `up -d` (⚠️ wipes the database, `init.sql` recreates the admin) |

---

## 💙 Support the project

**Geek0thek is a solo project — designed, developed and hosted by a single developer, at their own expense.**
Hosting (VM, database, cover storage), maintenance and ongoing development are entirely funded by the author.

If this media library is useful to you and you'd like to help keep it running, you can make a **free donation** via PayPal:

👉 **[Support the project with a PayPal donation](https://www.paypal.com/donate/?hosted_button_id=Y7LQW3UKPY5VN)**

- **No minimum or maximum amount**: every contribution, of any size, is welcome and directly funds hosting and development.
- The **"Support the project"** button is also permanently available in the application footer (it adapts to the active visual theme).

Thank you for your support! 🙏

---

## License & contribution policy

This software is distributed under the **GNU Affero General Public License v3.0 (AGPLv3)** license.

However, the official repository **accepts no external contributions nor any Pull Request** from third parties. You are completely free to fork the project and use it in accordance with the terms of the AGPLv3 license, but no outside code will be merged into the main branch.

See the [LICENSE](LICENSE) file for more information.
