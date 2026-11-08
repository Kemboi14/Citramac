"""Email backend for an environment with no SMTP server configured.

production.py used Django's console backend for this, which prints every
message, sign-in codes and activation links included, into the container log.
This one sends nothing and logs only that a message was withheld (subject,
recipient count), never its body or addresses.
"""

import structlog
from django.core.mail.backends.base import BaseEmailBackend

log = structlog.get_logger(__name__)

NO_SMTP_BACKEND = "apps.notifications.backends.NoSmtpEmailBackend"


class NoSmtpEmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        for message in email_messages or []:
            log.warning(
                "email.not_sent_no_smtp",
                subject=message.subject,
                recipients=len(message.recipients()),
            )
        return 0


def smtp_not_configured(backend_path):
    """True for a backend that does not deliver mail (no SMTP configured)."""
    return backend_path == NO_SMTP_BACKEND or backend_path.endswith("console.EmailBackend")
