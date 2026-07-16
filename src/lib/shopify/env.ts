function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const shopifyEnv = {
  get shop() {
    return required("SHOPIFY_SHOP");
  },
  get accessToken() {
    return required("SHOPIFY_ADMIN_API_ACCESS_TOKEN");
  },
  get apiVersion() {
    return process.env.SHOPIFY_API_VERSION ?? "2026-07";
  },
  get graphqlUrl() {
    return `https://${this.shop}.myshopify.com/admin/api/${this.apiVersion}/graphql.json`;
  },
};
