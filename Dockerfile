# -- Stage 1: Build Web Front-End --
FROM node:18-alpine AS web-build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm install
COPY web/ .
RUN npm run build

# -- Stage 2: Backend Node API --
FROM node:18-alpine
WORKDIR /app

# Install server dependencies
COPY server/package*.json ./
RUN npm install

# Copy server application
COPY server/ .

# Inject the compiled compiled Vite website into the server's public directory
COPY --from=web-build /app/web/dist ./public

# Setup variables and container volume target
EXPOSE 3000
RUN mkdir -p /app/data
ENV DB_PATH=/app/data/geologger.sqlite
ENV PORT=3000

CMD ["node", "index.js"]
