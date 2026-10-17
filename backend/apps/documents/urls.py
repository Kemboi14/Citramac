from django.urls import path

from . import views

urlpatterns = [
    path("catalogue/", views.CatalogueView.as_view(), name="documents-catalogue"),
    path(
        "catalogue/<str:template_id>/",
        views.TemplateDetailView.as_view(),
        name="documents-template",
    ),
    path("generated/", views.GeneratedListView.as_view(), name="documents-generated"),
    path(
        "generated/<uuid:pk>/",
        views.GeneratedDetailView.as_view(),
        name="documents-generated-detail",
    ),
    path(
        "generated/<uuid:pk>/transition/",
        views.GeneratedTransitionView.as_view(),
        name="documents-transition",
    ),
    path("disclosures/", views.DisclosureListView.as_view(), name="documents-disclosures"),
    path(
        "authorizations/", views.ReleaseAuthorizationView.as_view(), name="documents-authorizations"
    ),
]
