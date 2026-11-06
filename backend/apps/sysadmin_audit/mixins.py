from .audit import log_view, write_event
from .models import AuditLogEntry


class AuditedReadMixin:
    """CLAUDE.md §4: an AuditEvent on every access to a psychiatric record.

    A detail read logs the row it returned. A list logs one VIEW entry naming the
    model and the filters it was asked for (the patient, usually) — never row content."""

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        instance = getattr(self, "_audited_instance", None) or self.get_object()
        log_view(instance)
        return response

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        model = self.get_queryset().model
        write_event(
            request.user.organization_id,
            AuditLogEntry.ACTION_VIEW,
            f"{model._meta.app_label}.{model._meta.model_name}",
            "list",
            {"filters": {k: v for k, v in request.query_params.items() if k != "page"}},
        )
        return response
