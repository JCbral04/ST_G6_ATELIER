FROM node:22-bookworm-slim
WORKDIR /app/backend
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node backend/server.js ./server.js
COPY --chown=node:node backend/src ./src
COPY --chown=node:node frontend/ /app/frontend/
USER node
EXPOSE 3000
CMD ["npm", "start"]
