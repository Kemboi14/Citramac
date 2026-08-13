"""
Security response headers not covered by Django's SecurityMiddleware
settings — docs/09-SECURITY-COMPLIANCE.md §9.7: "Content Security Policy
headers ... set on all HTTP responses." (X-Frame-Options comes from
Django's own XFrameOptionsMiddleware; HSTS/nosniff come from the SECURE_*
settings below/in config/settings/{staging,production}.py — this version of
Django has no native CSP middleware.)

The policy here is deliberately permissive on 'unsafe-inline' for
script/style: Django Admin and drf-spectacular's Swagger UI both rely on
inline scripts/styles with no nonce support wired up. A stricter
nonce-based CSP is a further hardening step once those two callers are
audited, not something to fake as "done" here.
"""

CONTENT_SECURITY_POLICY = (
    "default-src 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "frame-ancestors 'none'; "
    "object-src 'none'; "
    "base-uri 'self'"
)


class SecurityHeadersMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        response.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
        return response
