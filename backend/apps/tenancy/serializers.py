from rest_framework import serializers

from .models import Branch, Organization


class OrgAdminInviteSerializer(serializers.Serializer):
    email = serializers.EmailField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()


class CreateOrganizationSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255)
    slug = serializers.SlugField(max_length=50)
    facility_type = serializers.ChoiceField(choices=Organization.FACILITY_TYPE_CHOICES)
    org_admin = OrgAdminInviteSerializer()

    def validate_slug(self, value):
        if Organization.objects.filter(slug=value).exists():
            raise serializers.ValidationError("An organization with this slug already exists.")
        return value


class OrganizationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Organization
        fields = [
            "id",
            "name",
            "slug",
            "facility_type",
            "dha_facility_code",
            "sha_provider_code",
            "enabled_modules",
            "is_active",
            "created_at",
        ]


class BranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = [
            "id",
            "organization",
            "name",
            "facility_level",
            "address",
            "county",
            "gps_coordinates",
            "is_active",
        ]
        read_only_fields = ["organization"]
