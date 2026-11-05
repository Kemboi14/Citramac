FROM python:3.12-slim AS base
WORKDIR /app

RUN adduser --disabled-password appuser

# Pango / HarfBuzz and fonts for WeasyPrint (server-made document PDFs —
# apps/documents/printing.py). Liberation is metric-compatible with Arial /
# Times; DejaVu covers the remaining characters.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev gcc \
       libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 \
       fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY requirements/ requirements/
ARG REQUIREMENTS_FILE=requirements/production.txt
RUN pip install --no-cache-dir -r ${REQUIREMENTS_FILE}

COPY . .

RUN DJANGO_SETTINGS_MODULE=config.settings.production \
    DJANGO_SECRET_KEY=collectstatic-only \
    python manage.py collectstatic --noinput

RUN chown -R appuser:appuser /app

USER appuser
EXPOSE 8000

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "4"]
