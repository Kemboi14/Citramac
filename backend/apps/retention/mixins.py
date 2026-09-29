from rest_framework.views import APIView


class NoHardDeleteMixin:
    """
    For every ViewSet over clinical or financial records: DELETE is not an
    offered method at all (405, and absent from the Allow header), because
    those records are corrected or archived, never removed — docs/06-DATA-
    MODEL.md §6.7 "never hard-delete patient data". A mistaken entry is
    fixed by editing or by its own status (cancelled, entered-in-error,
    resolved); a client record past its retention period is archived
    through apps.retention.

    Must precede the DRF base class in the bases list so this
    `http_method_names` wins.
    """

    http_method_names = [m for m in APIView.http_method_names if m != "delete"]
