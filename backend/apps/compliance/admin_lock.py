"""
Django admin must not be a side door into tenant clinical records. Platform
staff reach tenant clinical data only through a tenant-approved
SupportAccessGrant on the API, where every request is scoped to that tenant
and audited (legal opinion of 2 Oct 2026, §4.2, §6; DPA s.42(3)). Every model
in the client-record registry is therefore hidden from the admin entirely.
"""


def hide_clinical_models_from_admin():
    from django.contrib import admin

    from apps.retention.registry import patient_models

    protected = {model for model, _ in patient_models()}

    for model in list(admin.site._registry):
        if model in protected:
            admin.site.unregister(model)
