"""
Facility wall-clock time.

The database stores instants (USE_TZ, TIME_ZONE = "UTC"). Clinicians work in
the facility's local time: a group session "at 14:00", the 08:00 drug round,
"today". Every conversion between a naive facility date/time and a stored
instant goes through here, in settings.FACILITY_TIME_ZONE — never through
UTC, which would show a 14:00 Nairobi session as 17:00.
"""

from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.utils import timezone


def facility_tz():
    return ZoneInfo(settings.FACILITY_TIME_ZONE)


def combine_local(day, at=None):
    """A facility date + wall-clock time as an aware instant."""
    return datetime.combine(day, at or time.min, tzinfo=facility_tz())


def make_local_aware(value):
    """A naive datetime entered as facility wall-clock time, made aware.
    Aware values are returned unchanged."""
    if value is None or timezone.is_aware(value):
        return value
    return value.replace(tzinfo=facility_tz())


def local_now():
    return timezone.now().astimezone(facility_tz())


def local_datetime(value):
    return value.astimezone(facility_tz()) if value else value


def local_date(value=None):
    """The facility date of an instant (default: now)."""
    return local_datetime(value or timezone.now()).date()


def local_time(value):
    """The facility wall-clock time of an instant."""
    return local_datetime(value).time() if value else None


def day_bounds(day):
    """[start, end) instants of one facility day, for range filters in place of
    a `__date` lookup (which would truncate in UTC)."""
    start = combine_local(day)
    return start, combine_local(day + timedelta(days=1))


def local_format(value, fmt="%Y-%m-%d %H:%M"):
    return local_datetime(value).strftime(fmt) if value else ""
