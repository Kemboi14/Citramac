from rest_framework import serializers

from .models import Admission, Bed, MedicationAdministration, NursingNote, Ward


class WardSerializer(serializers.ModelSerializer):
    bed_count = serializers.SerializerMethodField()

    class Meta:
        model = Ward
        fields = ["id", "name", "branch", "ward_type", "bed_count"]

    def get_bed_count(self, obj):
        return getattr(obj, "bed_count", None) or obj.beds.count()


class BedSerializer(serializers.ModelSerializer):
    occupant_name = serializers.SerializerMethodField()

    class Meta:
        model = Bed
        fields = ["id", "ward", "bed_number", "status", "occupant_name"]

    def get_occupant_name(self, obj):
        if obj.status != "OCCUPIED":
            return None
        admission = (
            obj.admissions.filter(status__in=("ADMITTED", "TRANSFERRED"))
            .order_by("-admitted_at")
            .first()
        )
        return admission.patient.get_full_name() if admission else None


class AdmissionSerializer(serializers.ModelSerializer):
    patient_name = serializers.SerializerMethodField()
    bed_label = serializers.SerializerMethodField()

    class Meta:
        model = Admission
        fields = [
            "id",
            "patient",
            "patient_name",
            "encounter",
            "bed",
            "bed_label",
            "admitted_by",
            "admitted_at",
            "status",
            "discharged_at",
            "discharge_summary",
            "follow_up_date",
            "admission_type",
            "admission_source",
            "priority",
            "reason_for_admission",
            "clinical_summary",
            "primary_diagnosis",
            "associated_conditions",
            "risk_self_harm",
            "risk_to_others",
            "risk_absconding",
            "risk_medical",
            "observation_level",
            "safety_actions",
            "risk_summary",
            "primary_care_team",
            "consultant",
            "initial_care_priorities",
            "consent_status",
            "consent_at",
            "consent_obtained_by",
            "capacity_assessed",
            "consent_notes",
            "legal_status",
            "legal_order_reference",
            "legal_order_date",
            "legal_review_due_date",
            "authorizing_professional",
            "legal_rationale",
            "oversight_notes",
            "next_of_kin_notification",
            "next_of_kin_notes",
            "handover_note",
            "clinical_priority",
            "episode",
            "consultant_name",
            "patient_citramac_number",
            "legal_status_record",
        ]
        # admitted_at is writable: the admission form records the admission date
        # (docs/15-CLINICAL-WORKSPACE-V3.md §1.10); it defaults to now.
        # The legacy discharge_summary / follow_up_date columns are frozen: a
        # discharge is now a signed DischargeSummary (apps.care_pathway), and
        # leaving these writable would let signed content be bypassed by PATCH.
        read_only_fields = [
            "legal_status_record",
            "admitted_by",
            "status",
            "discharged_at",
            "episode",
            "discharge_summary",
            "follow_up_date",
        ]

    consultant_name = serializers.SerializerMethodField()
    patient_citramac_number = serializers.CharField(
        source="patient.citramac_number", read_only=True
    )

    # Owner decision 2026-10-07 (docs/15 §4): the legal basis of an admission is
    # captured when the admission is created. Later updates (a renewed review
    # date, consent changing) are allowed, may not blank a required field, and
    # every change is kept with before/after values by the write-audit signal
    # (apps.sysadmin_audit.signals).
    INVOLUNTARY_REQUIRED = (
        "legal_status",
        "legal_order_reference",
        "legal_order_date",
        "authorizing_professional",
    )

    # Master prompt §7A: once an admission is linked to the episode's LegalStatus,
    # that object is the single store — its category and the legacy legal fields
    # change only through the legal-status workflow (signed forms + decision).
    LEGAL_STATUS_OWNED = ("admission_type", *INVOLUNTARY_REQUIRED, "legal_review_due_date", "legal_rationale")

    def validate(self, attrs):
        if self.instance is not None and self.instance.legal_status_record_id:
            owned = {
                field: "Set by the client's legal admission status — use Legal & consent."
                for field in self.LEGAL_STATUS_OWNED
                if field in attrs and attrs[field] != getattr(self.instance, field)
            }
            if owned:
                raise serializers.ValidationError(owned)
        if self.instance is not None:
            merged = {
                field: attrs.get(field, getattr(self.instance, field))
                for field in ("admission_type", "consent_status", *self.INVOLUNTARY_REQUIRED)
            }
            if merged["admission_type"] == "INVOLUNTARY":
                blanked = {
                    field: "Required for an involuntary admission."
                    for field in self.INVOLUNTARY_REQUIRED
                    if field in attrs and not attrs[field]
                }
                if blanked:
                    raise serializers.ValidationError(blanked)
            elif "consent_status" in attrs and not attrs["consent_status"]:
                raise serializers.ValidationError(
                    {"consent_status": "Record the consent status for a voluntary admission."}
                )
            return attrs
        # Owner decision 2026-10-22 ("legal status first"): a new admission's legal
        # basis is the client's Active legal admission status — the single store
        # (CLAUDE.md §5). Voluntary: the signed application and the admitting
        # officer's decision; involuntary: the application, the signed medical
        # recommendation(s) and the decision. No free-text legal basis at create.
        from apps.care_pathway.legal_models import LegalStatus
        from apps.care_pathway.services import open_episode_for

        patient = attrs.get("patient")
        episode = open_episode_for(patient) if patient else None
        ls = LegalStatus.objects.filter(episode=episode).first() if episode else None
        if ls is None or ls.status != "ACTIVE":
            raise serializers.ValidationError(
                {
                    "legal_status_record": "Complete the client's legal admission status first — "
                    "a signed application and the admitting officer's decision (and, for an "
                    "involuntary admission, the signed medical recommendation)."
                }
            )
        requested = attrs.get("admission_type")
        if requested and requested != ls.category:
            raise serializers.ValidationError(
                {"admission_type": f"The client's legal status is {ls.get_category_display().lower()}."}
            )
        for field in self.LEGAL_STATUS_OWNED:
            attrs.pop(field, None)
        attrs["admission_type"] = ls.category
        attrs["legal_status_record"] = ls
        if ls.category == "VOLUNTARY" and not attrs.get("consent_status"):
            # The signed voluntary application is the client's consent to admission.
            attrs["consent_status"] = "OBTAINED"
            attrs.setdefault("consent_at", ls.decision_at)
        return attrs

    def get_consultant_name(self, obj):
        if not obj.consultant_id:
            return ""
        user = obj.consultant
        return f"{user.first_name} {user.last_name}".strip() or user.email

    def get_patient_name(self, obj):
        return obj.patient.get_full_name() if obj.patient_id else ""

    def get_bed_label(self, obj):
        return f"{obj.bed.ward.name} / Bed {obj.bed.bed_number}" if obj.bed_id else ""


class MedicationAdministrationSerializer(serializers.ModelSerializer):
    class Meta:
        model = MedicationAdministration
        fields = [
            "id",
            "admission",
            "prescription_item",
            "scheduled_time",
            "status",
            "administered_by",
            "administered_at",
            "notes",
        ]
        read_only_fields = ["status", "administered_by", "administered_at"]


class NursingNoteSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = NursingNote
        fields = ["id", "admission", "author", "author_name", "shift", "note", "recorded_at"]
        read_only_fields = ["author", "recorded_at"]

    def get_author_name(self, obj):
        user = obj.author
        if not user:
            return ""
        return f"{user.first_name} {user.last_name}".strip() or user.email
