"""Calendar used by usage policies, matching the backend and dashboard."""

from datetime import timedelta, timezone

# Contemporary Asia/Ho_Chi_Minh uses UTC+7 without daylight saving. An explicit
# offset also works in the frozen Windows Service without an installed IANA
# timezone database. Never derive policy hours or quota dates from Windows local time.
POLICY_TIME_ZONE = timezone(timedelta(hours=7), "Asia/Ho_Chi_Minh")
