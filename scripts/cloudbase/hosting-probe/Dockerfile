FROM node:24.18.0-bookworm-slim
WORKDIR /probe
RUN npm install --ignore-scripts --omit=dev --no-audit --no-fund ws@8.18.3
COPY server.mjs client.mjs ./
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server.mjs"]
