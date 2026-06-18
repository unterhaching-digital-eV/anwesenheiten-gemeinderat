FROM nginx:stable-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY index.html styles.css app.js sitzungen.json /usr/share/nginx/html/
