import uuid

from django.db import models

# docs/06-DATA-MODEL.md §6.6 — global terminology catalogs, not tenant-scoped
# (every org searches the same ICD-11/LOINC/drug index). Phase 3-5 seed a
# small illustrative set via data migration; docs/11-ROADMAP-AND-PHASES.md
# Phase 6 replaces that with a real nightly sync job against the WHO/LOINC/
# national drug registry APIs (docs/08-DHA-SHA-INTEGRATION.md §8.2) — do not
# treat the seeded codes here as a certified, complete mirror.


class IcdCodeIndex(models.Model):
    # code IS the primary key — the natural, human-meaningful lookup key
    # (diagnoses reference "6A70", not an opaque internal id).
    code = models.CharField(max_length=16, primary_key=True)
    description = models.CharField(max_length=500)

    class Meta:
        ordering = ["code"]
        verbose_name = "ICD-11 code"
        verbose_name_plural = "ICD-11 codes"

    def __str__(self):
        return f"{self.code} — {self.description}"


class LoincCodeIndex(models.Model):
    code = models.CharField(max_length=16, primary_key=True)
    description = models.CharField(max_length=500)

    class Meta:
        ordering = ["code"]
        verbose_name = "LOINC code"
        verbose_name_plural = "LOINC codes"

    def __str__(self):
        return f"{self.code} — {self.description}"


class NationalDrugIndex(models.Model):
    code = models.CharField(max_length=32, primary_key=True)
    generic_name = models.CharField(max_length=255)
    form = models.CharField(max_length=100, blank=True)
    strength = models.CharField(max_length=100, blank=True)

    class Meta:
        ordering = ["generic_name"]
        verbose_name = "national drug index entry"

    def __str__(self):
        return f"{self.generic_name} {self.strength} ({self.form})".strip()


class ShaTransactionLog(models.Model):
    """
    Every SHA API call, logged for audit/troubleshooting — every SHA
    transaction is financial or medical, never fire-and-forget
    (docs/08-DHA-SHA-INTEGRATION.md §8.3). Not tenant-scoped via
    TenantScopedModel (kept simple like AuditLogEntry) but does carry
    organization_id for filtering.
    """

    TRANSACTION_TYPE_CHOICES = [
        ("MEMBER_VERIFICATION", "Member Verification"),
        ("PRE_AUTHORIZATION", "Pre-Authorization"),
        ("E_CLAIM", "E-Claim"),
    ]
    STATUS_CHOICES = [
        ("PENDING", "Pending"),
        ("SUCCESS", "Success"),
        ("FAILED", "Failed"),
    ]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    organization_id = models.UUIDField(db_index=True)
    transaction_type = models.CharField(max_length=32, choices=TRANSACTION_TYPE_CHOICES)
    request_payload = models.JSONField(default=dict, blank=True)
    response_payload = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="PENDING")
    retry_count = models.PositiveSmallIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.transaction_type} [{self.status}] {self.created_at:%Y-%m-%d %H:%M}"
