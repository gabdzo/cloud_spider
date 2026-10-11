// Is the Shop API's database on the cluster? pgcluster makes namespace shop
// and the CloudNativePG cluster shopdb in it (pods labelled
// cnpg.io/cluster=shopdb; CNPG writes the Secret shopdb-app the API reads).
// true / false from a kube read that can see namespace shop; null when it
// cannot tell (no read, an error, or a read scoped elsewhere).
export function shopReadiness(snapshot, { dbSecret = "" } = {}) {
  if (!snapshot || snapshot.error) return null;
  if (Array.isArray(snapshot.scope) && !snapshot.scope.includes("shop")) return null;
  const inShop = (item) => item?.metadata?.namespace === "shop";
  const namespace = (snapshot.namespaces || []).some((item) => item?.metadata?.name === "shop") || (snapshot.pods || []).some(inShop);
  if (!namespace) return false;
  // A Secret of your own (dbSecret, e.g. an RDS URI): the namespace is enough.
  if (dbSecret && dbSecret !== "shopdb-app") return true;
  return (snapshot.pods || []).some((item) => inShop(item) && item?.metadata?.labels?.["cnpg.io/cluster"] === "shopdb");
}
