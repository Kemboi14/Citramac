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


class VerifyOtpSerializer(serializers.Serializer):
    otp_token = serializers.CharField()
    otp = serializers.RegexField(r"^\d{6}$")


class SetPasswordSerializer(serializers.Serializer):
    password_setup_token = serializers.CharField()
    password = serializers.CharField()

    def validate_password(self, value):
        validate_password(value)
        return value


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField()


class LoginVerifyOtpSerializer(serializers.Serializer):
    otp_token = serializers.CharField()
    otp = serializers.RegexField(r"^\d{6}$")


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()


class RefreshSerializer(serializers.Serializer):
    refresh = serializers.CharField(required=False)


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField(required=False)
