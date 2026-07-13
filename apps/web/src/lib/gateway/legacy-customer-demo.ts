export function legacyCustomerDemoEnabled() {
  return process.env.GATELM_LEGACY_CUSTOMER_DEMO_ENABLED?.trim().toLowerCase() === 'true';
}
