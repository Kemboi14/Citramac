from rest_framework.routers import DefaultRouter

from .views import (
    AdmissionViewSet,
    BedViewSet,
    MedicationAdministrationViewSet,
    NursingNoteViewSet,
    WardViewSet,
)

router = DefaultRouter()
router.register("ipd/wards", WardViewSet, basename="ipd-ward")
router.register("ipd/beds", BedViewSet, basename="ipd-bed")
router.register("ipd/admissions", AdmissionViewSet, basename="ipd-admission")
router.register("ipd/mar", MedicationAdministrationViewSet, basename="ipd-mar")
router.register("ipd/nursing-notes", NursingNoteViewSet, basename="ipd-nursing-note")

urlpatterns = router.urls
