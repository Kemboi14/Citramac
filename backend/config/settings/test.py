from .dev import *  # noqa: F401,F403

# locmem stores sent messages in django.core.mail.outbox instead of talking
# to a real SMTP server (Mailhog in dev/docker-compose) — standard Django
# test practice, lets auth-flow tests read the OTP that was "emailed".
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
