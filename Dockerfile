FROM node:24-alpine AS build-env
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build-env /app/build/client /usr/share/nginx/html/cycler
EXPOSE 80
