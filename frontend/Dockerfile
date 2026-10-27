FROM node:22.13.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend frontend
ARG VITE_API_URL=http://localhost:3000/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w frontend
FROM nginx:1.27.3-alpine
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
