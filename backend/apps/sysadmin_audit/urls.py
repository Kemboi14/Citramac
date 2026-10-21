from django.urls import path

from .views import AuditLogListView, PatientAuditEventView

urlpatterns = [
    path("audit-log/", AuditLogListView.as_view(), name="audit-log-list"),
    path("fhir/AuditEvent/", PatientAuditEventView.as_view(), name="fhir-auditevent-search"),
]
