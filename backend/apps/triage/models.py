import math

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone

from apps.clinical_encounter.models import Encounter
from apps.tenancy.models import TenantScopedModel


class VitalSigns(TenantScopedModel):
    """docs/06-DATA-MODEL.md §6.3, docs/07-CLINICAL-MODULES-SPEC.md §7.2 — Module 2."""

    encounter = models.ForeignKey(Encounter, on_delete=models.CASCADE, related_name="vital_signs")
    systolic_bp = models.PositiveSmallIntegerField(null=True, blank=True)
    diastolic_bp = models.PositiveSmallIntegerField(null=True, blank=True)
    heart_rate = models.PositiveSmallIntegerField(null=True, blank=True)
    respiratory_rate = models.PositiveSmallIntegerField(null=True, blank=True)
    temperature_c = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    spo2 = models.PositiveSmallIntegerField(null=True, blank=True)

    height_cm = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    weight_kg = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True)
    bmi = models.DecimalField(max_digits=5, decimal_places=1, null=True, blank=True, editable=False)
    bsa = models.DecimalField(max_digits=4, decimal_places=2, null=True, blank=True, editable=False)

    esi_acuity_level = models.PositiveSmallIntegerField(
        "ESI acuity level",
        null=True,
        blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(5)],
        help_text="Emergency Severity Index, 1 (most acute) to 5 (least).",
    )

    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    recorded_at = models.DateTimeField(default=timezone.now)

    def save(self, *args, **kwargs):
        if self.height_cm and self.weight_kg:
            height_m = float(self.height_cm) / 100
            self.bmi = round(float(self.weight_kg) / (height_m**2), 1)
            self.bsa = round(math.sqrt((float(self.height_cm) * float(self.weight_kg)) / 3600), 2)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Vitals for {self.encounter} @ {self.recorded_at:%Y-%m-%d %H:%M}"


class MentalStatusExam(TenantScopedModel):
    """
    Replaces vitals-only triage for CCP tenants — docs/07-CLINICAL-MODULES-SPEC.md
    §7.14.2. Field set mirrors mockups/citramac_clinical_workspace.html's
    lettered MSE sections (A. Appearance through I. Judgement/Insight/Plan).
    """

    encounter = models.ForeignKey(
        Encounter, on_delete=models.CASCADE, related_name="mental_status_exams"
    )

    appearance = models.TextField(blank=True)
    behavior = models.TextField(blank=True)
    speech = models.TextField(blank=True)
    mood = models.TextField(blank=True)
    affect = models.TextField(blank=True)
    thought_process = models.TextField(blank=True)
    thought_content = models.TextField(blank=True)
    perception = models.TextField(blank=True)
    cognition = models.TextField(blank=True)
    insight = models.TextField(blank=True)
    judgment = models.TextField(blank=True)
    plan = models.TextField(blank=True)

    risk_assessment = models.JSONField(
        default=dict,
        blank=True,
        help_text=(
            "Structured SI/HI flags, e.g. "
            "{'suicidal_ideation': false, 'homicidal_ideation': false, 'notes': ''}"
        ),
    )
    risk_escalated_to_supervisor = models.BooleanField(default=False)

    recorded_by = models.ForeignKey(
        "accounts.User", on_delete=models.SET_NULL, null=True, blank=True, related_name="+"
    )
    recorded_at = models.DateTimeField(default=timezone.now)

    def save(self, *args, **kwargs):
        if self.risk_assessment.get("suicidal_ideation") or self.risk_assessment.get(
            "homicidal_ideation"
        ):
            self.risk_escalated_to_supervisor = True
        super().save(*args, **kwargs)

    def __str__(self):
        return f"MSE for {self.encounter} @ {self.recorded_at:%Y-%m-%d %H:%M}"
