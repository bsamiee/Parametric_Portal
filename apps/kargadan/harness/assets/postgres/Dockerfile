# syntax=docker/dockerfile:1

FROM pgvector/pgvector:0.8.2-pg18@sha256:b48c110f4911eb3d73ba7b6bd8964a5f26be740c2d580158530471c3c0f66487

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-18-partman=5.4.3-1.pgdg12+1 \
    && rm -rf /var/lib/apt/lists/*

USER postgres
