# ============================================================
# Geek0thek - Backend (API Express)
# ============================================================
FROM node:22-alpine

WORKDIR /app

# Hash du commit déployé (injecté au build par GitHub Actions via
# --build-arg GIT_COMMIT=${{ github.sha }}) : l'indicateur « Mise à jour
# disponible » (/api/version) le lit en fallback quand le dossier .git est
# absent de l'image (cf. backend/src/utils/githubClient.js).
ARG GIT_COMMIT=""
ENV GIT_COMMIT=${GIT_COMMIT}

# Dépendances d'abord (cache des couches)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Code source
COPY src ./src

# version.json généré au build : 2e source de vérité du commit déployé
# (fallback de process.env.GIT_COMMIT dans githubClient.js).
RUN printf '{ "commit": "%s" }\n' "${GIT_COMMIT}" > /app/version.json

# Dossier de uploads (monté en volume ./uploads -> /app/uploads)
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

# Exécution en utilisateur non root (sécurité)
USER node

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=15s --retries=10 \
  CMD node -e "fetch('http://localhost:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
