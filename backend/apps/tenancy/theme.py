"""
Theme token registry and validation for PlatformBranding.theme_overrides and
Organization.theme_overrides (docs/03-DESIGN-SYSTEM.md §3.6).

Stored shape — one palette per color mode, each a map of token key to a
``#rrggbb`` hex string::

    {"light": {"primary": "#1d5fa8", "sidebar_top": "#15457a"},
     "dark":  {"primary": "#6aa8ff"}}

Keys must match frontend/src/theme/themeTokens.ts ``THEME_TOKENS`` exactly.
Status colors (STATUS_THEME_KEYS) are platform-wide only: Super Admin's
PlatformBranding may set them, an Organization never can — so "danger"
reads the same in every tenant, whoever edits that tenant's theme.
"""

import re

from rest_framework import serializers

HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

THEME_MODES = ("light", "dark")

ORG_THEME_KEYS = frozenset(
    {
        # Brand
        "primary",
        "primary_dark",
        "on_primary",
        # Sidebar
        "sidebar_top",
        "sidebar_bottom",
        "sidebar_text",
        "sidebar_text_strong",
        "sidebar_muted",
        "sidebar_active_bg",
        "sidebar_active_text",
        # Surfaces
        "bg",
        "card",
        "border",
        "scrim",
        "shadow",
        # Text
        "ink_900",
        "ink_700",
        "ink_500",
        "ink_400",
        "ink_300",
        # Accents
        "info",
        "violet",
        # Charts
        "chart_1",
        "chart_2",
        "chart_3",
        "chart_4",
        "chart_5",
        "chart_6",
    }
)

STATUS_THEME_KEYS = frozenset({"danger", "warning", "on_status"})

# The pre-light/dark shape was a flat {"primary", "secondary"} pair applied
# in light mode; still accepted on input and normalized into `light`.
LEGACY_KEYS = {"primary": "primary", "secondary": "primary_dark"}


def normalize_legacy_theme(value):
    """Fold a flat legacy {"primary", "secondary"} dict into the light palette."""
    if not isinstance(value, dict) or not (set(value) & set(LEGACY_KEYS)):
        return value
    out = {k: v for k, v in value.items() if k not in LEGACY_KEYS}
    light = dict(out.get("light") or {})
    for legacy, token in LEGACY_KEYS.items():
        if legacy in value:
            light.setdefault(token, value[legacy])
    out["light"] = light
    return out


def validate_theme_overrides_shape(value, *, allow_status=False):
    """
    Shared by every serializer that writes a theme_overrides field. Returns
    the normalized value (legacy keys folded in, hex lower-cased, empty
    palettes dropped).
    """
    value = normalize_legacy_theme(value)
    if not isinstance(value, dict):
        raise serializers.ValidationError("Must be an object.")

    extra_modes = set(value) - set(THEME_MODES)
    if extra_modes:
        raise serializers.ValidationError(
            f"Unsupported key(s): {', '.join(sorted(extra_modes))}. Only "
            f"{', '.join(THEME_MODES)} palettes are allowed."
        )

    allowed = ORG_THEME_KEYS | STATUS_THEME_KEYS if allow_status else ORG_THEME_KEYS
    normalized = {}
    for mode in THEME_MODES:
        palette = value.get(mode)
        if palette is None:
            continue
        if not isinstance(palette, dict):
            raise serializers.ValidationError(f"'{mode}' must be an object.")
        blocked = set(palette) & STATUS_THEME_KEYS if not allow_status else set()
        if blocked:
            raise serializers.ValidationError(
                f"{', '.join(sorted(blocked))} can only be changed in the platform theme, "
                "so status colors read the same in every organization."
            )
        unknown = set(palette) - allowed
        if unknown:
            raise serializers.ValidationError(
                f"Unknown color token(s) in '{mode}': {', '.join(sorted(unknown))}."
            )
        clean = {}
        for key, color in palette.items():
            if not isinstance(color, str) or not HEX_COLOR_RE.match(color):
                raise serializers.ValidationError(
                    f"'{mode}.{key}' must be a hex color like #006e51, got {color!r}."
                )
            clean[key] = color.lower()
        if clean:
            normalized[mode] = clean
    return normalized
