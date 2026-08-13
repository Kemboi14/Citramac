import { apiRequest } from "./apiClient";

// Mirrors apps/billing serializers — docs/10-API-SPECIFICATION.md §10.11.

export interface Invoice {
  id: string;
  status: string;
  total_amount: string;
  amount_paid: string;
}

export function createInvoice(
  accessToken: string,
  patientId: string,
  encounterId: string,
  description: string,
  unitPrice: string,
) {
  return apiRequest<Invoice>("/billing/invoices/", {
    method: "POST",
    body: {
      patient: patientId,
      encounter: encounterId,
      lines: [{ description, quantity: 1, unit_price: unitPrice }],
    },
    accessToken,
  });
}

export function recordPayment(
  accessToken: string,
  invoiceId: string,
  amount: string,
  method: string,
) {
  return apiRequest<Invoice>(`/billing/invoices/${invoiceId}/payments/`, {
    method: "POST",
    body: { amount, method, reference: "" },
    accessToken,
  });
}
