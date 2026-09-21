from django.contrib import admin

from .models import (
    BiopsychosocialAssessment,
    CareTeamMembership,
    ClinicalReview,
    NacadaNdoReport,
    PsychotherapySession,
    RehabMilestone,
    ReviewOfSystemEntry,
    SubstanceUseEntry,
    SudRehabPlan,
    SupervisionRequest,
    UrineDrugScreen,
)


@admin.register(CareTeamMembership)
class CareTeamMembershipAdmin(admin.ModelAdmin):
    list_display = ["patient", "user", "role", "assigned_at"]
    list_filter = ["role", "organization"]


class SubstanceUseEntryInline(admin.TabularInline):
    model = SubstanceUseEntry
    extra = 0


class ReviewOfSystemEntryInline(admin.TabularInline):
    model = ReviewOfSystemEntry
    extra = 0


@admin.register(BiopsychosocialAssessment)
class BiopsychosocialAssessmentAdmin(admin.ModelAdmin):
    list_display = ["patient", "author", "status", "date_of_intake", "created_at"]
    list_filter = ["status"]
    inlines = [SubstanceUseEntryInline, ReviewOfSystemEntryInline]


@admin.register(PsychotherapySession)
class PsychotherapySessionAdmin(admin.ModelAdmin):
    list_display = ["patient", "session_type", "therapist", "session_date"]
    list_filter = ["session_type", "organization"]


class RehabMilestoneInline(admin.TabularInline):
    model = RehabMilestone
    extra = 0


@admin.register(SudRehabPlan)
class SudRehabPlanAdmin(admin.ModelAdmin):
    list_display = ["patient", "current_phase", "case_manager", "started_at"]
    list_filter = ["current_phase"]
    inlines = [RehabMilestoneInline]


@admin.register(UrineDrugScreen)
class UrineDrugScreenAdmin(admin.ModelAdmin):
    list_display = ["plan", "collected_at", "collected_by"]


@admin.register(ClinicalReview)
class ClinicalReviewAdmin(admin.ModelAdmin):
    list_display = ["patient", "status", "requested_by", "reviewer", "requested_at"]
    list_filter = ["status"]


@admin.register(SupervisionRequest)
class SupervisionRequestAdmin(admin.ModelAdmin):
    list_display = ["patient", "status", "requested_by", "supervisor", "requested_at"]
    list_filter = ["status"]


@admin.register(NacadaNdoReport)
class NacadaNdoReportAdmin(admin.ModelAdmin):
    list_display = ["period_start", "period_end", "status", "generated_at"]
    list_filter = ["status"]
