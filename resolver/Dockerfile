# Entity-Resolution microservice (LCC audit W4.2) — Railway service, CPU-only.
#
# Builds libpostal from source (the Python `postal` bindings need the C library), then
# installs the Python deps and bakes the sentence-transformers bge-small model + the
# committed default resolver models into the image so first request is warm.
#
# Multi-stage: stage 1 compiles libpostal; stage 2 is the slim runtime.

# ---------- stage 1: build libpostal ----------
FROM python:3.11-slim AS libpostal-build

ARG LIBPOSTAL_REF=v1.1
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates build-essential autoconf automake libtool pkg-config git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
RUN git clone --depth 1 --branch ${LIBPOSTAL_REF} https://github.com/openvenues/libpostal || \
    git clone --depth 1 https://github.com/openvenues/libpostal
# Data dir kept OUTSIDE the source tree so it survives into the runtime image.
RUN cd libpostal \
    && ./bootstrap.sh \
    && ./configure --datadir=/opt/libpostal_data --prefix=/usr/local \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

# ---------- stage 2: runtime ----------
FROM python:3.11-slim AS runtime

# Runtime shared libs for libpostal + build tools for the `postal` python wheel.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Bring compiled libpostal + its data over from the build stage.
COPY --from=libpostal-build /usr/local/lib/libpostal* /usr/local/lib/
COPY --from=libpostal-build /usr/local/include/libpostal /usr/local/include/libpostal
COPY --from=libpostal-build /usr/local/lib/pkgconfig/libpostal.pc /usr/local/lib/pkgconfig/libpostal.pc
COPY --from=libpostal-build /opt/libpostal_data /opt/libpostal_data
RUN ldconfig

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/opt/hf-cache \
    SENTENCE_TRANSFORMERS_HOME=/opt/hf-cache \
    RESOLVER_EMBED_MODEL=BAAI/bge-small-en-v1.5

WORKDIR /app
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Pre-download the embedding model so cold-start doesn't fetch at request time.
# (Best-effort: if the network is unavailable at build time the service falls back to
# the hashing embedding at runtime — see README.)
RUN python -c "from sentence_transformers import SentenceTransformer as S; S('BAAI/bge-small-en-v1.5')" || \
    echo "WARN: bge-small pre-download skipped; runtime will fetch or fall back."

COPY . .

# Regenerate the default models against the committed fixtures so the image is
# self-consistent even if the JSON was edited (idempotent).
RUN python scripts/gen_models_and_calibration.py || echo "WARN: model gen skipped"

EXPOSE 8080
# Railway injects $PORT; default to 8080 locally.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
