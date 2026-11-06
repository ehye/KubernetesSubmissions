FROM node:26.13.0-alpine AS build

WORKDIR /app
RUN npm install --global pnpm@12.16.1

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build

FROM node:26.13.0-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=3000
ENV IMAGE_CACHE_FILE=/shared/todo-image/image.jpg
ENV TODO_BACKEND_URL=http://todo-backend-svc:2345
WORKDIR /app

COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
