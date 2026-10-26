# Build from the repo root, because the agent reads the app's map layers, translations and docs:
#   docker build -f agent/Dockerfile -t vauban-agent .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv
WORKDIR /srv/agent

COPY agent/pyproject.toml agent/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
ENV PYTHONPATH=/srv/agent

COPY agent/vauban_agent ./vauban_agent
# the public files the agent reads (same ones the website serves)
COPY public/data /srv/app/public/data
COPY src/i18n.js src/vauban.js /srv/app/src/
COPY docs/MAP-DATA-AND-API.md /srv/app/docs/

ENV APP_DIR=/srv/app DATA_DIR=/srv/app/public/data PORT=8080 PYTHONUNBUFFERED=1
RUN useradd --uid 10001 agent
USER agent
EXPOSE 8080
# start straight from the venv: the "agent" user has no home folder for uv to keep a cache in
CMD ["sh", "-c", "exec /srv/agent/.venv/bin/uvicorn vauban_agent.api:app --host 0.0.0.0 --port ${PORT}"]
