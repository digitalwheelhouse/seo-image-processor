FROM node:20-alpine

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json ./
RUN npm install --omit=dev

# Copy the rest of the app
COPY server.js ./
COPY public ./public

EXPOSE 3000

# Env vars (ANTHROPIC_API_KEY, TEAM_PASSWORD, SESSION_SECRET) are provided at runtime,
# not baked into the image.
CMD ["node", "server.js"]
