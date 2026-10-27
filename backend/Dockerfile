FROM node:22.13.1-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY backend backend
RUN npm run db:generate -w backend
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "backend"]
