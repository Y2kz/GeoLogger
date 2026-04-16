FROM node:18-alpine

WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

RUN npm install

# Copy application code
COPY . .

# Expose port
EXPOSE 3000

# The data directory where SQLite database will be stored
RUN mkdir -p /app/data

# Environment variable for database path
ENV DB_PATH=/app/data/geologger.sqlite
ENV PORT=3000

CMD ["node", "index.js"]
