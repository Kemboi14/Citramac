"""
Versioned jurisdiction config for the legal admission status module (master
prompt LGL-DATA-03). Statute citations, form wording, notice periods and
maximum durations live in `jurisdiction_config/<version>.json` — supplied by the
project owner from the paper forms — and are rendered verbatim from there, never
from code. settings.LEGAL_JURISDICTION_CONFIG names the version in force;
settings.LEGAL_STATUS_OVERRIDES may override the *operational* values only
(review lead time, required recommendations), never statutory wording.

No module here imports a model, so migrations may import it.
"""

import json
import re
from functools import lru_cache
from pathlib import Path

from django.conf import settings

CONFIG_DIR = Path(__file__).resolve().parent / "jurisdiction_config"
DEFAULT_VERSION = "KE-MHA-FORMS-1"

# LGL-WF-06 — legal-status alert codes for the served `clinical-alert` value set.
LEGAL_ALERT_LABELS = {
    "INVOLUNTARY_STATUS": "Involuntary admission — legal status in force",
    "LEGAL_STATUS_EXPIRING": "Involuntary legal status nearing its maximum — review due",
    "LEGAL_STATUS_EXPIRED": "Involuntary legal status expired without a recorded decision",
    "DISCHARGE_NOTICE_ACTIVE": "Written discharge notice active",
}


def version():
    return getattr(settings, "LEGAL_JURISDICTION_CONFIG", None) or DEFAULT_VERSION


@lru_cache(maxsize=8)
def _load(name):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
        raise ValueError("Invalid jurisdiction config name.")
    with open(CONFIG_DIR / f"{name}.json", encoding="utf-8") as handle:
        return json.load(handle)


def load(name=None):
    return _load(name or version())


def operational(name=None):
    values = {k: v for k, v in load(name)["operational"].items() if k != "notes"}
    values.update(getattr(settings, "LEGAL_STATUS_OVERRIDES", None) or {})
    return values


def form(template_id, name=None):
    return load(name)["forms"][template_id]


def statutory_basis(category, name=None):
    config = load(name)
    return [{"key": key, **config["statutes"][key]} for key in config["statutoryBasis"][category]]


def rights(name=None):
    return load(name)["rights"]


def privacy(name=None):
    return load(name)["privacy"]


def document_templates(name=None):
    return load(name)["documentTemplates"]


class _Keep(dict):
    def __missing__(self, key):
        return "{" + key + "}"


def fill(text, **values):
    """Insert record values into a config text's {placeholders}; unknown ones stay visible."""
    return (text or "").format_map(_Keep({k: ("" if v is None else v) for k, v in values.items()}))


def text(entry):
    """A config text entry is {"text", "verbatim", ...} or a plain string."""
    return entry.get("text", "") if isinstance(entry, dict) else (entry or "")
