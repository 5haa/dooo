FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages/control ./packages/control
COPY packages/ui-tars/package.json ./packages/ui-tars/package.json
RUN npm ci --workspace @dooo/api --omit=dev --ignore-scripts && npm cache clean --force
COPY src/server ./src/server
COPY src/shared ./src/shared
USER node
EXPOSE 8080
CMD ["node", "src/server/server.js"]
