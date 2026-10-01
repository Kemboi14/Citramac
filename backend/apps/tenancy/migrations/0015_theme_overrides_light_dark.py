"""
Moves theme_overrides from the old flat {"primary", "secondary"} shape to the
per-mode {"light": {...}, "dark": {...}} shape (apps/tenancy/theme.py). The
old values were only ever meant for the light palette, so they become
light.primary / light.primary_dark; dark mode falls back to its defaults.
Reversible: the reverse step writes light.primary/primary_dark back to the
flat keys and drops everything the old shape couldn't express.
"""

from django.db import migrations

# Frozen copy of apps.tenancy.theme.normalize_legacy_theme — migrations must
# not change behaviour if that module evolves.
LEGACY_KEYS = {"primary": "primary", "secondary": "primary_dark"}


def normalize_legacy_theme(value):
    if not isinstance(value, dict) or not (set(value) & set(LEGACY_KEYS)):
        return value
    out = {k: v for k, v in value.items() if k not in LEGACY_KEYS}
    light = dict(out.get("light") or {})
    for legacy, token in LEGACY_KEYS.items():
        if legacy in value:
            light.setdefault(token, value[legacy])
    out["light"] = light
    return out


def forwards(apps, schema_editor):
    for model_name in ("Organization", "PlatformBranding"):
        Model = apps.get_model("tenancy", model_name)
        for obj in Model.objects.exclude(theme_overrides={}).only("pk", "theme_overrides"):
            normalized = normalize_legacy_theme(obj.theme_overrides)
            if normalized != obj.theme_overrides:
                Model.objects.filter(pk=obj.pk).update(theme_overrides=normalized)


def backwards(apps, schema_editor):
    for model_name in ("Organization", "PlatformBranding"):
        Model = apps.get_model("tenancy", model_name)
        for obj in Model.objects.exclude(theme_overrides={}).only("pk", "theme_overrides"):
            light = (obj.theme_overrides or {}).get("light") or {}
            legacy = {}
            if "primary" in light:
                legacy["primary"] = light["primary"]
            if "primary_dark" in light:
                legacy["secondary"] = light["primary_dark"]
            Model.objects.filter(pk=obj.pk).update(theme_overrides=legacy)


class Migration(migrations.Migration):
    dependencies = [
        ("tenancy", "0014_subscription_past_due_since_subscription_started_on_and_more"),
    ]

    operations = [migrations.RunPython(forwards, backwards)]
