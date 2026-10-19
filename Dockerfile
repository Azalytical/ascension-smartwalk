# SmartWalk for Google Cloud Run. No runtime npm dependencies: Node serves public/ and the API.
FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY scripts/dev.mjs ./scripts/dev.mjs
COPY data/pois.json ./data/pois.json
ENV NODE_ENV=production SMARTWALK_PRODUCTION=1 HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
CMD ["node", "scripts/dev.mjs"]
