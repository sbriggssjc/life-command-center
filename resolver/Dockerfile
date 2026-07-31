# Entity-Resolution microservice (LCC audit W4.2) — Railway service, CPU-only.
#
# Builds libpostal from source (the Python `postal` bindings need the C library), then
# installs the Python deps and bakes the sentence-transformers bge-small model + the
# committed default resolver models into the image so first request is warm.
#
# Multi-stage: stage 1 compiles libpostal; stage 2 is the slim runtime.

# ---------- stage 1: build libpostal ----------
# PINNED to bookworm (Debian 12 / GCC 12): the trixie-based python:3.11-slim ships
# GCC 14, where implicit function declarations are hard errors and libpostal v1.1's
# crf_context.c (double_equals without float_utils.h) fails to compile.
# Found via Railway build failure 2026-07-31 — see docs/resolver/RUNBOOK §1 note.
FROM python:3.11-slim-bookworm AS libpostal-build

# PINNED to a modern master commit (2026-07 HEAD), NOT the 2018 v1.1 tag: pypostal
# >=1.1.10 (requirements.txt) binds APIs the v1.1 C library lacks (e.g.
# libpostal_expand_address_root) — with v1.1 the wheel compiles with implicit-decl
# warnings, then fails at link. Found via the second Railway build failure 2026-07-31.
# This commit also carries the upstream GCC-14 crf_context.c fix.
ARG LIBPOSTAL_REF=25099c506612b34b23b1bfe286ca6321fcf06f35
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates build-essential autoconf automake libtool pkg-config git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt
# Tarball fetch works for any ref (sha or tag) and skips git history.
RUN curl -fsSL https://github.com/openvenues/libpostal/archive/${LIBPOSTAL_REF}.tar.gz | tar -xz \
    && mv libpostal-${LIBPOSTAL_REF}* libpostal
# Data dir kept OUTSIDE the source tree so it survives into the runtime image.
# Belt-and-suspenders for newer GCC: give crf_context.c the float_utils.h include
# it relies on implicitly (upstream v1.1 omission; harmless no-op when already fixed).
RUN grep -q 'float_utils.h' libpostal/src/crf_context.c || \
    sed -i 's/#include "crf_context.h"/#include "crf_context.h"\n#include "float_utils.h"/' libpostal/src/crf_context.c
RUN cd libpostal \
    && ./bootstrap.sh \
    && ./configure --datadir=/opt/libpostal_data --prefix=/usr/local \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig

# ---------- stage 2: runtime ----------
# Same base as stage 1 — the copied libpostal .so must match this stage's glibc.
FROM python:3.11-slim-bookworm AS runtime

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
