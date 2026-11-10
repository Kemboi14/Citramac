from rest_framework import serializers

from .models import IcdCodeIndex, LoincCodeIndex, NationalDrugIndex


class IcdCodeIndexSerializer(serializers.ModelSerializer):
    class Meta:
        model = IcdCodeIndex
        # is_leaf: no more specific code below it (WHO: code to the most specific level).
        fields = ["code", "description", "release", "chapter", "is_leaf", "is_residual"]


class LoincCodeIndexSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoincCodeIndex
        fields = ["code", "description"]


class NationalDrugIndexSerializer(serializers.ModelSerializer):
    class Meta:
        model = NationalDrugIndex
        fields = ["code", "generic_name", "form", "strength"]
