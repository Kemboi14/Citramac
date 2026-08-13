from rest_framework import serializers

from .models import IcdCodeIndex, LoincCodeIndex, NationalDrugIndex


class IcdCodeIndexSerializer(serializers.ModelSerializer):
    class Meta:
        model = IcdCodeIndex
        fields = ["code", "description"]


class LoincCodeIndexSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoincCodeIndex
        fields = ["code", "description"]


class NationalDrugIndexSerializer(serializers.ModelSerializer):
    class Meta:
        model = NationalDrugIndex
        fields = ["code", "generic_name", "form", "strength"]
