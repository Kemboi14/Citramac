import re

from django.core.exceptions import ValidationError


class SecurityPolicyPasswordValidator:
    """
    Enforces the Super Admin's live SecurityPolicy (Security Policies screen)
    instead of Django's static AUTH_PASSWORD_VALIDATORS alone — registered
    alongside those, not instead of them, so the hardcoded MinimumLengthValidator
    floor still applies even if this policy is ever misconfigured too low.

    Reads SecurityPolicy.get_solo() at call time, same live-read pattern as
    apps.accounts.throttling.enforce_general_rate_limit and the lockout checks
    in apps.accounts.auth_views.LoginView.
    """

    def validate(self, password, user=None):
        from .models import SecurityPolicy

        policy = SecurityPolicy.get_solo()
        errors = []

        if len(password) < policy.minimum_password_length:
            errors.append(
                f"This password must contain at least {policy.minimum_password_length} characters."
            )
        if policy.require_uppercase and not re.search(r"[A-Z]", password):
            errors.append("This password must contain at least one uppercase letter.")
        if policy.require_lowercase and not re.search(r"[a-z]", password):
            errors.append("This password must contain at least one lowercase letter.")
        if policy.require_number and not re.search(r"[0-9]", password):
            errors.append("This password must contain at least one number.")
        if policy.require_symbol and not re.search(r"[^A-Za-z0-9]", password):
            errors.append("This password must contain at least one symbol.")

        if user is not None and getattr(user, "pk", None) and policy.password_history_count > 0:
            from apps.accounts.models import PasswordHistory

            if PasswordHistory.matches_recent(user, password, policy.password_history_count):
                errors.append(
                    f"This password matches one of your last {policy.password_history_count} "
                    "passwords. Choose a different one."
                )

        if errors:
            raise ValidationError(errors)

    def get_help_text(self):
        return "Must meet this platform's configured password policy (length, complexity, reuse)."
