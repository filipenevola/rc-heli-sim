FROM node:24-alpine
WORKDIR /app
COPY server/index.mjs ./index.mjs
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/rankings.sqlite
EXPOSE 8787
CMD ["node", "index.mjs"]
