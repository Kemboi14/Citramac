from django.urls import path
from rest_framework.routers import DefaultRouter

from . import views
from .views import InsuranceClaimViewSet, PreAuthorizationViewSet, RemittanceViewSet

router = DefaultRouter()
router.register("claims/pre-authorizations", PreAuthorizationViewSet, basename="pre-authorization")
router.register("claims/e-claims", InsuranceClaimViewSet, basename="e-claim")
router.register("claims/remittances", RemittanceViewSet, basename="remittance")
router.register("claims/payer-codes", views.ServicePayerCodeViewSet, basename="payer-code")

urlpatterns = [
    path(
        "claims/clients/<uuid:patient_id>/billing/",
        views.ClientBillingWorkspaceView.as_view(),
        name="client-billing-workspace",
    ),
    path(
        "claims/clients/<uuid:patient_id>/billing/claims/",
        views.ClientClaimCreateView.as_view(),
        name="client-billing-claims",
    ),
    path(
        "claims/clients/<uuid:patient_id>/billing/invoice/",
        views.ClientInvoiceView.as_view(),
        name="client-billing-invoice",
    ),
    path(
        "claims/clients/<uuid:patient_id>/billing/payments/",
        views.ClientPaymentView.as_view(),
        name="client-billing-payments",
    ),
    path(
        "claims/clients/<uuid:patient_id>/billing/export/",
        views.ClientBillingExportView.as_view(),
        name="client-billing-export",
    ),
    path(
        "claims/billing-claims/<uuid:pk>/", views.BillingClaimView.as_view(), name="billing-claim"
    ),
    path(
        "claims/billing-claims/<uuid:pk>/submit/",
        views.BillingClaimSubmitView.as_view(),
        name="billing-claim-submit",
    ),
    path(
        "claims/billing-claims/<uuid:pk>/status/",
        views.BillingClaimStatusView.as_view(),
        name="billing-claim-status",
    ),
    path(
        "claims/billing-claims/<uuid:pk>/lines/<uuid:line_id>/",
        views.BillingClaimLineView.as_view(),
        name="billing-claim-line",
    ),
    path(
        "claims/billing-claims/<uuid:pk>/lines/<uuid:line_id>/preauth/",
        views.BillingClaimLinePreauthView.as_view(),
        name="billing-claim-line-preauth",
    ),
    path(
        "claims/billing-claims/<uuid:pk>/attachments/",
        views.BillingClaimAttachmentsView.as_view(),
        name="billing-claim-attachments",
    ),
    path(
        "claims/billing-claims/<uuid:pk>/attachments/<uuid:attachment_id>/",
        views.BillingClaimAttachmentView.as_view(),
        name="billing-claim-attachment",
    ),
    path(
        "claims/billing-preauths/<uuid:pk>/decision/",
        views.BillingPreauthDecisionView.as_view(),
        name="billing-preauth-decision",
    ),
    # SHA through the DHA HIE.
    path(
        "claims/clients/<uuid:patient_id>/sha/eligibility/",
        views.ClientShaEligibilityView.as_view(),
        name="client-sha-eligibility",
    ),
    path(
        "claims/clients/<uuid:patient_id>/sha/interventions/",
        views.ClientShaInterventionsView.as_view(),
        name="client-sha-interventions",
    ),
    path(
        "claims/clients/<uuid:patient_id>/sha/contacts/",
        views.ClientShaContactsView.as_view(),
        name="client-sha-contacts",
    ),
    path(
        "claims/clients/<uuid:patient_id>/sha/otp/",
        views.ClientShaOtpView.as_view(),
        name="client-sha-otp",
    ),
    path(
        "claims/clients/<uuid:patient_id>/sha/visits/",
        views.ClientShaVisitView.as_view(),
        name="client-sha-visits",
    ),
    path(
        "claims/clients/<uuid:patient_id>/sha/otp-whitelist/",
        views.ClientShaWhitelistView.as_view(),
        name="client-sha-otp-whitelist",
    ),
    path(
        "claims/sha-visits/<uuid:pk>/<str:action_name>/",
        views.ShaVisitActionView.as_view(),
        name="sha-visit-action",
    ),
    path(
        "claims/billing-claims/<uuid:pk>/sha/<str:action_name>/",
        views.BillingClaimShaView.as_view(),
        name="billing-claim-sha",
    ),
    path("claims/sha-remittances/", views.ShaRemittanceView.as_view(), name="sha-remittances"),
    # Public: the HIE posts status callbacks here (sha_callbacks.CALLBACK_PATHS).
    path(
        "integrations/dha/<str:token>/callbacks/<str:entity>-status/",
        views.ShaCallbackReceiverView.as_view(),
        name="sha-callback",
    ),
] + router.urls
