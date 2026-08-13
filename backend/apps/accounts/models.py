import secrets
import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.utils import timezone

from apps.tenancy.managers import TenantScopedManager
from apps.tenancy.models import Branch, Organization, TenantScopedModel, TimestampedModel


def _opaque_token():
    return secrets.token_urlsafe(32)


class Permission(models.Model):
    """
    Codename-based permission, e.g. "clinical_encounter.view",
    "billing.approve_writeoff", "audit.view". Deliberately separate from
    django.contrib.auth's built-in Permission/ContentType machinery — RBAC
    here is per-organization assignable (docs/09-SECURITY-COMPLIANCE.md §9.3),
    which the built-in model doesn't support.
    """

    codename = models.CharField(max_length=150, unique=True)
    description = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["codename"]

    def __str__(self):
        return self.codename


class Role(TimestampedModel):
    """
    organization=None is a platform-level template role (curated by Super
    Admin); Org Admin assigns/customizes permission subsets within their
    org from those templates but cannot grant permissions the platform
    template doesn't allow. See docs/09-SECURITY-COMPLIANCE.md §9.3.

    Deliberately uses the plain default manager, not TenantScopedManager:
    its visibility rule is "your org's roles OR the platform templates",
    which TenantScopedManager's single organization_id match can't express.
    The Postgres RLS policy (accounts_role, see migration 0002) enforces
    that exact rule at the database layer regardless.
    """

    name = models.CharField(max_length=100)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="roles",
    )
    permissions = models.ManyToManyField(Permission, blank=True, related_name="roles")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["name", "organization"], name="unique_role_name_per_org"
            )
        ]

    def __str__(self):
        scope = self.organization.name if self.organization_id else "platform template"
        return f"{self.name} ({scope})"


class UserManager(TenantScopedManager, BaseUserManager):
    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("User must have an email address")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        extra_fields.setdefault("email_verified_at", None)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True")

        # A superuser row always has organization=None, which can only ever
        # satisfy accounts_user's RLS WITH CHECK via the platform-admin
        # clause (see apps/accounts/migrations/0002_rls.py) — and unlike
        # create_user(), this is called from contexts with no tenant context
        # of their own at all (`manage.py createsuperuser`, a bootstrap
        # script), so it has to establish that context itself rather than
        # relying on a caller to have set one up.
        from apps.tenancy.context import platform_admin_context

        with platform_admin_context():
            return self._create_user(email, password, **extra_fields)


class User(AbstractBaseUser):
    """
    docs/06-DATA-MODEL.md §6.1. `organization` is nullable — platform-level
    Super Admin staff (docs/04-MULTI-TENANCY.md §4.1) aren't scoped to a
    tenant, everyone else must have one. is_staff/is_superuser are plain
    fields (not PermissionsMixin) since Django-admin-site access is the only
    thing they gate here — real RBAC is the Role/Permission model above,
    enforced at the API layer (docs/09-SECURITY-COMPLIANCE.md §9.3).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization = models.ForeignKey(
        Organization,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="users",
    )
    primary_branch = models.ForeignKey(
        Branch, on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )

    staff_id = models.CharField(max_length=64, blank=True)
    first_name = models.CharField(max_length=150, blank=True)
    last_name = models.CharField(max_length=150, blank=True)
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=32, blank=True)

    is_active = models.BooleanField(default=False)
    is_staff = models.BooleanField(default=False)
    is_superuser = models.BooleanField(default=False)
    email_verified_at = models.DateTimeField(null=True, blank=True)

    roles = models.ManyToManyField(Role, blank=True, related_name="users")
    branch_access = models.ManyToManyField(Branch, blank=True, related_name="staff_members")

    mfa_enabled = models.BooleanField(default=True)
    last_login_ip = models.GenericIPAddressField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = UserManager()
    all_objects = models.Manager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["first_name", "last_name"]

    class Meta:
        base_manager_name = "all_objects"
        constraints = [
            models.UniqueConstraint(
                fields=["organization", "staff_id"],
                name="unique_staff_id_per_org",
                condition=~models.Q(staff_id=""),
            )
        ]

    def __str__(self):
        return self.email

    def has_perm(self, perm, obj=None):
        return self.is_superuser

    def has_module_perms(self, app_label):
        return self.is_superuser

    def get_full_name(self):
        return f"{self.first_name} {self.last_name}".strip() or self.email

    def get_short_name(self):
        return self.first_name or self.email


class ActivationInvite(TenantScopedModel):
    """
    The one-time link an Org Admin sends a pre-provisioned staff member
    (docs/04-MULTI-TENANCY.md §4.5). `token` is what the activation link
    encodes alongside organization_id — it's what makes Screen A of the
    auth flow safe (docs/05-AUTHENTICATION-FLOW.md §5.5): without a valid,
    unexpired token the identify endpoint can't be used as a name-guessing
    oracle across the whole platform.
    """

    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="activation_invites"
    )
    token = models.CharField(max_length=64, unique=True, default=_opaque_token)
    created_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    def is_valid(self):
        return self.used_at is None and self.expires_at > timezone.now()

    def __str__(self):
        return f"invite:{self.token[:8]}… for {self.user.email}"


class OneTimePassword(TimestampedModel):
    """
    docs/05-AUTHENTICATION-FLOW.md §5.2 Screen C / §5.3 login 2FA / §5.4
    forgot-password. The 6-digit code is CSPRNG-generated and stored hashed
    (Argon2, via Django's password hasher) — never in plaintext, never
    logged. `token` opaquely addresses this specific OTP challenge so the
    client can reference it without the server having to guess which of a
    user's (possibly several, after a resend) OTP rows is current.
    """

    PURPOSE_ACTIVATION = "ACTIVATION"
    PURPOSE_LOGIN_2FA = "LOGIN_2FA"
    PURPOSE_RESET = "RESET"
    PURPOSE_CHOICES = [
        (PURPOSE_ACTIVATION, "Activation"),
        (PURPOSE_LOGIN_2FA, "Login 2FA"),
        (PURPOSE_RESET, "Password Reset"),
    ]

    MAX_ATTEMPTS = 5
    CODE_TTL_MINUTES = 10

    token = models.CharField(max_length=64, unique=True, default=_opaque_token)
    user = models.ForeignKey("accounts.User", on_delete=models.CASCADE, related_name="otps")
    purpose = models.CharField(max_length=16, choices=PURPOSE_CHOICES)
    code_hash = models.CharField(max_length=128)
    activation_invite = models.ForeignKey(
        ActivationInvite, on_delete=models.CASCADE, null=True, blank=True, related_name="otps"
    )
    expires_at = models.DateTimeField()
    is_used = models.BooleanField(default=False)
    failed_attempts = models.PositiveSmallIntegerField(default=0)

    @classmethod
    def issue(cls, user, purpose, activation_invite=None):
        code = f"{secrets.randbelow(1_000_000):06d}"
        otp = cls.objects.create(
            user=user,
            purpose=purpose,
            activation_invite=activation_invite,
            code_hash=make_password(code),
            expires_at=timezone.now() + timezone.timedelta(minutes=cls.CODE_TTL_MINUTES),
        )
        return otp, code

    def is_valid(self):
        return (
            not self.is_used
            and self.failed_attempts < self.MAX_ATTEMPTS
            and self.expires_at > timezone.now()
        )

    def check_code(self, code):
        return check_password(code, self.code_hash)

    def __str__(self):
        return f"otp:{self.token[:8]}… ({self.purpose}) for {self.user.email}"


class PasswordSetupToken(TimestampedModel):
    """Issued after OTP verification succeeds — docs/05-AUTHENTICATION-FLOW.md Screen C→D."""

    PURPOSE_ACTIVATION = "ACTIVATION"
    PURPOSE_RESET = "RESET"
    PURPOSE_CHOICES = [
        (PURPOSE_ACTIVATION, "Activation"),
        (PURPOSE_RESET, "Password Reset"),
    ]

    TOKEN_TTL_MINUTES = 15

    token = models.CharField(max_length=64, unique=True, default=_opaque_token)
    user = models.ForeignKey(
        "accounts.User", on_delete=models.CASCADE, related_name="password_setup_tokens"
    )
    purpose = models.CharField(max_length=16, choices=PURPOSE_CHOICES)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def issue(cls, user, purpose):
        return cls.objects.create(
            user=user,
            purpose=purpose,
            expires_at=timezone.now() + timezone.timedelta(minutes=cls.TOKEN_TTL_MINUTES),
        )

    def is_valid(self):
        return self.used_at is None and self.expires_at > timezone.now()

    def __str__(self):
        return f"password-setup:{self.token[:8]}… for {self.user.email}"
