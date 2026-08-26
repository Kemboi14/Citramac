from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers


class IdentifySerializer(serializers.Serializer):
    activation_token = serializers.CharField()
    name = serializers.CharField()


class ConfirmEmailSerializer(serializers.Serializer):
    activation_token = serializers.CharField()
    email = serializers.EmailField()


class ResendOtpSerializer(serializers.Serializer):
    otp_token = serializers.CharField()
    # Lets the tenant-branded MFA screen (docs/14-TENANT-BRANDED-LOGIN-UX.md)
    # switch delivery channel before resending, e.g. user picks "Email"
    # after the default SMS send. Ignored for non-login OTP purposes.
    channel = serializers.ChoiceField(choices=["EMAIL", "SMS"], required=False)


class VerifyOtpSerializer(serializers.Serializer):
    otp_token = serializers.CharField()
    otp = serializers.RegexField(r"^\d{6}$")


class TenantDiscoverySerializer(serializers.Serializer):
    email = serializers.EmailField()


class SetPasswordSerializer(serializers.Serializer):
    password_setup_token = serializers.CharField()
    password = serializers.CharField()

    def validate_password(self, value):
        validate_password(value)
        return value


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()
    # "Remember me" (docs/14-TENANT-BRANDED-LOGIN-UX.md) — only controls
    # whether the refresh-token cookie persists across browser restarts, not
    # the token's own lifetime (SIMPLE_JWT.REFRESH_TOKEN_LIFETIME).
    remember = serializers.BooleanField(required=False, default=False)


class LoginVerifyOtpSerializer(serializers.Serializer):
    otp_token = serializers.CharField()
    otp = serializers.RegexField(r"^\d{6}$")


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()


class RefreshSerializer(serializers.Serializer):
    refresh = serializers.CharField(required=False)


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField(required=False)
