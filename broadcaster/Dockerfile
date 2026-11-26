FROM node:26.13.0-alpine
WORKDIR /app
RUN npm install --global pnpm@12.16.1
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY src ./src
USER node
CMD ["node", "src/index.js"]
