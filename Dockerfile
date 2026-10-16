FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# public/ may be empty (and so absent from git); make sure it exists for the COPY below
RUN mkdir -p public && npx prisma generate && npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/data/uploads && chown -R app:app /app/data
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
# Needed at runtime by prisma/seed.ts and scripts/vault-rotate-key.ts (run with tsx in the container)
COPY --from=build /app/src/server/crypto ./src/server/crypto
COPY --from=build /app/src/server/lib ./src/server/lib
USER app
EXPOSE 3000
# Apply pending migrations, then start
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -p 3000"]
