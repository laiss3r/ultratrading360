# Backend engine image: API (ASGI/daphne) + bot worker, from one image.
FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Never run as root: a compromised container should not own its own files.
RUN useradd --create-home --uid 10001 appuser \
    && mkdir -p /app/staticfiles \
    && chown -R appuser:appuser /app
USER appuser

RUN python manage.py collectstatic --noinput || true

EXPOSE 8000

# A non-root container must not claim a privileged port, and the orchestrator health-checks this.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/health/ || exit 1

# Default command serves the ASGI app (HTTP + WebSocket). docker-compose overrides this for the
# worker service.
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]
