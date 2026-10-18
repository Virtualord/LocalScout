# The deployed Localscout: one long-lived process serving the API, the built
# interface, and Lighthouse audits, with SQLite under DATA_DIR.
#
# Development does not use this image; `pnpm dev` stays the dev loop. It exists
# so a container platform can run the same code with the same guarantees:
# Chromium is present, so audits produce real numbers instead of degrading to
# stale, and DATA_DIR is writable, so the database has a home.
#
# The platform must provide AUTH_TOKEN or a deliberate ALLOW_PUBLIC_ACCESS=true
# (the config loader refuses a network-reachable HOST with neither); mounting
# a disk at /var/data is what makes the database outlive the instance (see
# render.yaml).

FROM node:24-bookworm-slim AS build

# better-sqlite3 ships prebuilds for Node 24; the toolchain is the fallback
# for when a platform image cannot fetch one.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# The root `prepare` script is husky, which needs a .git directory that this
# build context deliberately does not contain.
ENV HUSKY=0

# The exact version in package.json's packageManager field, not corepack's
# resolution, so the image and CI install the same pnpm.
RUN npm install --global pnpm@11.8.0

WORKDIR /app

# Manifests first, so the dependency layer survives source edits. Every
# workspace member's manifest has to be present or a frozen install refuses.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY eval/package.json eval/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @localscout/web build


FROM node:24-bookworm-slim AS runtime

# Chromium is what Lighthouse drives. Without a browser, audits still run
# their HTTP and HTML checks but claim no performance number at all, so a
# deployed image without it would ship the degraded version. fonts-liberation
# is there so pages render text while being measured, not tofu boxes.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates chromium fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
ENV HUSKY=0

RUN npm install --global pnpm@11.8.0

WORKDIR /app

COPY --from=build /app /app

# A platform reaches the process over its private network, which is the one
# place 0.0.0.0 is correct: nothing outside the platform can route to it, and
# the platform terminates TLS. The loader insists that the platform has said
# how the deploy is reached: an AUTH_TOKEN or a deliberate public flag.
ENV HOST=0.0.0.0
ENV SERVE_WEB=true
ENV DATA_DIR=/var/data
# The value Render assigns. API_PORT, when set, wins over this.
ENV PORT=10000

EXPOSE 10000

CMD ["pnpm", "--filter", "@localscout/api", "start"]
