# Aidem for Google Cloud Run: the same API and app as the Worker, served by Node (scripts/dev.mjs).
# Runtime npm packages are only the vendored map and fonts that prepare-public.mjs copies into public/.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY scripts/dev.mjs scripts/prepare-public.mjs scripts/demo-answers.mjs ./scripts/
COPY data/places.json data/events.json ./data/
# dev.mjs regenerates public/ at start, so the node user must be able to write there.
RUN node scripts/prepare-public.mjs && chown -R node:node public
ENV NODE_ENV=production SMARTWALK_PRODUCTION=1 HOST=0.0.0.0 PORT=8080 WEATHER=1
USER node
EXPOSE 8080
CMD ["node", "scripts/dev.mjs"]
