"""Super Admin → Service Catalogue (guide.md 2026-11-26): the platform's list of
services, by name, category and medicine strength — never a price. Entries are
retired, never deleted, so tariff lines added from them keep their link."""

from django.db import IntegrityError, transaction
from django.shortcuts import get_object_or_404
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsPlatformSuperAdmin
from apps.tenancy.context import platform_admin_context

from .models import ServiceCatalogueItem


class ServiceCatalogueItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = ServiceCatalogueItem
        fields = [
            "id",
            "category",
            "name",
            "description",
            "medicine_name",
            "mass",
            "active",
            "updated_at",
        ]
        read_only_fields = ["name", "updated_at"]

    def validate(self, attrs):
        instance = self.instance
        category = attrs.get("category", instance.category if instance else "") or ""
        if category.strip().lower() == "medication":
            medicine = attrs.get("medicine_name", instance.medicine_name if instance else "")
            mass = attrs.get("mass", instance.mass if instance else "")
            if not str(medicine or "").strip() or not str(mass or "").strip():
                raise ValidationError({"medicine_name": "A medicine needs its name and strength."})
        return attrs


def _name(data, instance=None):
    category = str(data.get("category", instance.category if instance else "") or "")
    if category.strip().lower() == "medication":
        medicine = str(data.get("medicine_name", instance.medicine_name if instance else ""))
        mass = str(data.get("mass", instance.mass if instance else ""))
        return " ".join(f"{medicine.strip()} {mass.strip()}".split())
    if "name" in data:
        return " ".join(str(data.get("name") or "").split())
    return instance.name if instance else ""


def _save(serializer, name):
    if not name:
        raise ValidationError({"name": "Enter the service name."})
    if len(name) > 150:
        raise ValidationError({"name": "Use at most 150 characters."})
    try:
        with transaction.atomic():
            return serializer.save(name=name)
    except IntegrityError as err:
        raise ValidationError(
            {"name": "The catalogue already has a service with this name."}
        ) from err


class ServiceCatalogueView(APIView):
    permission_classes = [IsPlatformSuperAdmin]

    def get(self, request):
        with platform_admin_context():
            items = ServiceCatalogueItem.objects.all()
            return Response(ServiceCatalogueItemSerializer(items, many=True).data)

    def post(self, request):
        serializer = ServiceCatalogueItemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        item = _save(serializer, _name(request.data))
        return Response(ServiceCatalogueItemSerializer(item).data, status=201)


class ServiceCatalogueItemView(APIView):
    permission_classes = [IsPlatformSuperAdmin]

    def patch(self, request, pk):
        item = get_object_or_404(ServiceCatalogueItem, pk=pk)
        serializer = ServiceCatalogueItemSerializer(item, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        item = _save(serializer, _name(request.data, item))
        return Response(ServiceCatalogueItemSerializer(item).data)
