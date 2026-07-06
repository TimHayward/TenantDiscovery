import type { LicenseItem } from "@workspace/api-client-react";

export const LICENSES_HIDDEN_SKUS_STORAGE_KEY = "licenses-hidden-skus";
export const LICENSES_HIDDEN_SKUS_CHANGED_EVENT = "licenses-hidden-skus-changed";

export const FREE_SKUS = new Set([
  "WINDOWS_STORE",
  "FLOW_FREE",
  "POWERAPPS_DEV",
  "POWERAPPS_VIRAL",
  "POWER_BI_STANDARD",
  "TEAMS_FREE",
  "TEAMS_EXPLORATORY",
  "DEVELOPERPACK",
  "DEVELOPERPACK_E5",
  "RIGHTSMANAGEMENT_ADHOC",
  "MCOMEETADV",
  "STREAM",
  "FORMS_PRO",
  "MICROSOFT_BUSINESS_CENTER",
  "DYN365_ACCOUNTANT_PORTAL_IW_SKU",
]);

export function readHiddenLicenseSkus(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const stored = localStorage.getItem(LICENSES_HIDDEN_SKUS_STORAGE_KEY);
    return stored ? new Set<string>(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

export function writeHiddenLicenseSkus(hiddenSkus: Set<string>): void {
  try {
    localStorage.setItem(LICENSES_HIDDEN_SKUS_STORAGE_KEY, JSON.stringify([...hiddenSkus]));
    window.dispatchEvent(new Event(LICENSES_HIDDEN_SKUS_CHANGED_EVENT));
  } catch {
    /* ignore persistence errors (e.g. storage disabled) */
  }
}

export function isFreeLicenseSku(skuPartNumber: string): boolean {
  return FREE_SKUS.has(skuPartNumber);
}

export function isVisibleBillableLicense(license: LicenseItem, hiddenSkus: Set<string>): boolean {
  return !isFreeLicenseSku(license.skuPartNumber) && !hiddenSkus.has(license.skuPartNumber);
}

export function effectiveLicenseTotal(license: LicenseItem): number {
  return license.total > 0 ? license.total : license.assigned;
}

export function calculateLicenseStats(licenses: LicenseItem[]) {
  const totalLicenses = licenses.reduce((s, l) => s + effectiveLicenseTotal(l), 0);
  const assignedLicenses = licenses.reduce((s, l) => s + l.assigned, 0);
  const availableLicenses = licenses.reduce((s, l) => s + Math.max(0, effectiveLicenseTotal(l) - l.assigned), 0);
  const utilizationPercent = totalLicenses > 0 ? Math.round((assignedLicenses / totalLicenses) * 100) : 0;
  return { totalLicenses, assignedLicenses, availableLicenses, utilizationPercent };
}
