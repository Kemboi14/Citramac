from django.urls import path

from . import views

urlpatterns = [
    path("care/valuesets/", views.ValueSetsView.as_view(), name="care-valuesets"),
    path(
        "care/registration/search/",
        views.RegistrationSearchView.as_view(),
        name="care-registration-search",
    ),
    path("care/registrations/", views.RegistrationView.as_view(), name="care-registrations"),
    path(
        "care/patients/<uuid:patient_id>/resolve-identity/",
        views.ResolveIdentityView.as_view(),
        name="care-resolve-identity",
    ),
    path("care/triage/worklist/", views.TriageWorklistView.as_view(), name="care-triage-worklist"),
    path("care/triage/<uuid:pk>/", views.TriageEncounterView.as_view(), name="care-triage"),
    path("care/triage/<uuid:pk>/start/", views.TriageStartView.as_view(), name="care-triage-start"),
    path("care/triage/<uuid:pk>/draft/", views.TriageDraftView.as_view(), name="care-triage-draft"),
    path(
        "care/triage/<uuid:pk>/evaluate/",
        views.TriageEvaluateView.as_view(),
        name="care-triage-evaluate",
    ),
    path("care/triage/<uuid:pk>/sign/", views.TriageSignView.as_view(), name="care-triage-sign"),
    path("care/triage/<uuid:pk>/tasks/", views.TriageTasksView.as_view(), name="care-triage-tasks"),
    path(
        "care/triage/<uuid:pk>/recheck/draft/",
        views.TriageRecheckDraftView.as_view(),
        name="care-recheck-draft",
    ),
    path(
        "care/triage/<uuid:pk>/recheck/sign/",
        views.TriageRecheckSignView.as_view(),
        name="care-recheck-sign",
    ),
    path(
        "care/triage/<uuid:pk>/full-retriage/",
        views.TriageFullRetriageView.as_view(),
        name="care-full-retriage",
    ),
    path("care/triage/<uuid:pk>/fhir/", views.TriageFhirView.as_view(), name="care-triage-fhir"),
    path(
        "care/triage/<uuid:pk>/open-review/",
        views.OpenPsychiatryReviewView.as_view(),
        name="care-open-review",
    ),
    path("care/tasks/<uuid:pk>/", views.CareTaskView.as_view(), name="care-task"),
    path("care/psychiatry/queue/", views.PsychiatryQueueView.as_view(), name="care-psych-queue"),
    path("care/documents/", views.SignedDocumentsView.as_view(), name="care-documents"),
    path(
        "care/assessments/<uuid:pk>/", views.SignedAssessmentView.as_view(), name="care-assessment"
    ),
    path(
        "care/clients/<uuid:patient_id>/banner/",
        views.ClientBannerView.as_view(),
        name="care-client-banner",
    ),
    path(
        "care/clients/<uuid:patient_id>/snapshot/",
        views.ClientSnapshotView.as_view(),
        name="care-client-snapshot",
    ),
    path(
        "care/clients/<uuid:patient_id>/timeline/",
        views.ClientTimelineView.as_view(),
        name="care-client-timeline",
    ),
    path(
        "care/clients/<uuid:patient_id>/vitals/",
        views.ClientVitalsView.as_view(),
        name="care-client-vitals",
    ),
    path(
        "care/clients/<uuid:patient_id>/legal/",
        views.ClientLegalView.as_view(),
        name="care-client-legal",
    ),
    path(
        "care/clients/<uuid:patient_id>/intake/",
        views.ClientIntakeView.as_view(),
        name="care-client-intake",
    ),
    path(
        "care/clients/<uuid:patient_id>/outcomes/",
        views.ClientOutcomesView.as_view(),
        name="care-client-outcomes",
    ),
    path(
        "care/clients/<uuid:patient_id>/care-plan/",
        views.ClientCarePlanView.as_view(),
        name="care-client-care-plan",
    ),
    path(
        "care/clients/<uuid:patient_id>/care-plan/activities/",
        views.ClientCarePlanActivitiesView.as_view(),
        name="care-client-activities",
    ),
    path(
        "care/care-plan-activities/<uuid:pk>/",
        views.CarePlanActivityView.as_view(),
        name="care-activity",
    ),
    path(
        "care/clients/<uuid:patient_id>/interventions/",
        views.ClientInterventionsView.as_view(),
        name="care-client-interventions",
    ),
    path(
        "care/clients/<uuid:patient_id>/billing/",
        views.ClientBillingView.as_view(),
        name="care-client-billing",
    ),
    path("care/billing/", views.BillingOverviewView.as_view(), name="care-billing"),
    path(
        "care/billing-services/", views.BillingServicesView.as_view(), name="care-billing-services"
    ),
    path(
        "care/billing-services/<uuid:pk>/",
        views.BillingServiceView.as_view(),
        name="care-billing-service",
    ),
    path("care/dashboard/", views.DashboardView.as_view(), name="care-dashboard"),
    path("care/outpatients/", views.OutpatientsView.as_view(), name="care-outpatients"),
    path("care/reports/", views.ReportsView.as_view(), name="care-reports"),
    path(
        "care/consent-templates/",
        views.ConsentTemplatesView.as_view(),
        name="care-consent-templates",
    ),
    path(
        "care/clients/<uuid:patient_id>/consent/",
        views.ClientConsentView.as_view(),
        name="care-client-consent",
    ),
    path(
        "care/alerts/<uuid:pk>/resolve/",
        views.ResolveAlertView.as_view(),
        name="care-alert-resolve",
    ),
    path(
        "care/triage/thresholds/",
        views.TriageThresholdsView.as_view(),
        name="care-triage-thresholds",
    ),
    path("care/follow-ups/", views.FollowUpsView.as_view(), name="care-follow-ups"),
    path("care/discharges/", views.DischargeWorklistView.as_view(), name="care-discharges"),
    path(
        "care/admissions/<uuid:pk>/discharge/",
        views.AdmissionDischargeView.as_view(),
        name="care-admission-discharge",
    ),
    path(
        "care/admissions/<uuid:pk>/discharge/sign/",
        views.AdmissionDischargeSignView.as_view(),
        name="care-admission-discharge-sign",
    ),
    path(
        "care/discharges/<uuid:pk>/amend/",
        views.DischargeAmendView.as_view(),
        name="care-discharge-amend",
    ),
    path(
        "care/discharges/<uuid:pk>/fhir/",
        views.DischargeFhirView.as_view(),
        name="care-discharge-fhir",
    ),
]
