from django.urls import path

from .views import DrugIndexSearchView, Icd11SearchView, LoincSearchView

urlpatterns = [
    path("terminology/icd11/search/", Icd11SearchView.as_view(), name="terminology-icd11-search"),
    path("terminology/loinc/search/", LoincSearchView.as_view(), name="terminology-loinc-search"),
    path(
        "terminology/drug-index/search/",
        DrugIndexSearchView.as_view(),
        name="terminology-drug-index-search",
    ),
]
