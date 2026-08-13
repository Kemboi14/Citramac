import { apiRequest } from "./apiClient";

// Mirrors apps/pharmacy serializers — docs/07-CLINICAL-MODULES-SPEC.md §7.6.

export interface DrugIndexEntry {
  code: string;
  generic_name: string;
  form: string;
  strength: string;
}

export function searchDrugIndex(accessToken: string, query: string) {
  return apiRequest<DrugIndexEntry[]>(
    `/terminology/drug-index/search/?q=${encodeURIComponent(query)}`,
    { accessToken },
  );
}

export interface Store {
  id: string;
  name: string;
  store_type: string;
}

export interface Paginated<T> {
  count: number;
  results: T[];
}

export function listStores(accessToken: string) {
  return apiRequest<Paginated<Store>>("/pharmacy/stores/", { accessToken });
}

export interface StockItem {
  id: string;
  store: string;
  drug: string;
  drug_name: string;
  batch_number: string;
  expiry_date: string;
  quantity_on_hand: number;
}

export function listStockItems(accessToken: string) {
  return apiRequest<Paginated<StockItem>>("/pharmacy/stock-items/", { accessToken });
}

export interface DispenseRecord {
  id: string;
  prescription_item: string;
  stock_item: string | null;
  quantity_dispensed: number;
}

export function dispenseMedication(
  accessToken: string,
  prescriptionItemId: string,
  storeId: string,
  quantity: number,
) {
  return apiRequest<DispenseRecord[]>("/pharmacy/dispense/", {
    method: "POST",
    body: {
      prescription_item: prescriptionItemId,
      store: storeId,
      quantity_dispensed: quantity,
    },
    accessToken,
  });
}
