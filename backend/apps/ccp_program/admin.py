from django.contrib import admin

from .models import BiopsychosocialAssessment, CareTeamMembership, PsychotherapySession


@admin.register(CareTeamMembership)
class CareTeamMembershipAdmin(admin.ModelAdmin):
    list_display = ["patient", "user", "role", "assigned_at"]
    list_filter = ["role", "organization"]


@admin.register(BiopsychosocialAssessment)
class BiopsychosocialAssessmentAdmin(admin.ModelAdmin):
    list_display = ["patient", "author", "created_at"]


@admin.register(PsychotherapySession)
class PsychotherapySessionAdmin(admin.ModelAdmin):
    list_display = ["patient", "session_type", "therapist", "session_date"]
    list_filter = ["session_type", "organization"]
