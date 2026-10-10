export function cardName(spec, values = {}) {
  if (spec?.id === "eks") return values.clusterName || ""
  return values.name || ""
}

export function confirmMatches(expected, typed) {
  return Boolean(expected) && typed === expected
}

export function upgradeSpiderLine({ action, title, sample, response }) {
  if (sample) return { status: "fail", text: "sample, not the account." }
  if (response?.error) return { status: "fail", text: response.error }
  if (response?.running) {
    const text = action === "destroy" ? `taking ${title} down` : `raising ${title}`
    return { status: "ok", text }
  }
  return { status: "fail", text: "the upgrade did not start" }
}

export function watchLine({ cluster, history }) {
  const kind = history?.kind || ""
  const resources = Number.isInteger(history?.resources) ? history.resources : 0
  const count = `${resources} resources`
  if (cluster) {
    if (cluster.error) return { status: "fail", text: cluster.error }
    if (!cluster.found) return { status: "ok", text: `the cluster is gone. ${count}` }
    if (kind !== "destroy") {
      return { status: "fail", text: `the cluster is still ${cluster.status}. Pulumi has no destroy. ${count}` }
    }
    return { status: "fail", text: `Pulumi finished and the cluster is still ${cluster.status}. ${count}` }
  }
  if (kind === "destroy" && resources === 0) return { status: "ok", text: "the stack is gone" }
  if (kind !== "destroy") return { status: "fail", text: `the stack still has ${count}. Pulumi has no destroy.` }
  return { status: "fail", text: `Pulumi finished and the stack still has ${count}` }
}

export function blocksSecondCluster(clusters, wanted) {
  return Array.isArray(clusters) && clusters.some((name) => name !== wanted)
}

export function pulumiMissing(status) {
  return status !== 0
}

export function pulumiWarning(status) {
  return pulumiMissing(status) ? "pulumi is not on PATH. The stacks will not run.\n" : ""
}

export function historyFact(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { kind: "", resources: 0 }
  }
  const last = Array.isArray(data) ? data[0] : null
  return { kind: last?.kind || "", resources: 0 }
}

const COARSE = new Set([
  "aws:s3/bucket:Bucket",
  "aws:lambda/function:Function",
  "aws:dynamodb/table:Table",
  "aws:secretsmanager/secret:Secret",
])

const KIND = {
  "aws:s3/bucket:Bucket": "bucket",
  "aws:lambda/function:Function": "function",
  "aws:dynamodb/table:Table": "table",
  "aws:secretsmanager/secret:Secret": "secret",
}

function secretValues(outputs) {
  return Object.entries(outputs)
    .filter(([key]) => /secret|password|token/i.test(key))
    .map(([, value]) => value)
    .filter((value) => typeof value === "string")
}

function resourceLabel(resource) {
  const outputs = resource?.outputs || {}
  const hidden = secretValues(outputs)
  for (const key of ["bucket", "functionName", "name", "id"]) {
    const value = outputs[key]
    if (typeof value === "string" && value && !hidden.includes(value)) return value
  }
  const tail = String(resource?.urn || "").split("::").pop()
  if (tail && !hidden.includes(tail)) return tail
  return ""
}

// gstack-shortcut(dec-6b984f98-b288-4b2f-b4e4-e203812e4644): one stack, upgrade when a second tear-down stack needs its own picture
// gstack-shortcut(dec-ffe38b30-ac3a-43b0-901e-67c2cb161c56): page, function, table, secret, upgrade when a domain is owned or a paid database is wanted
export function campFixtures(resources, grain) {
  const fine = grain === "fine"
  const fixtures = []
  for (const resource of resources || []) {
    const type = resource?.type || ""
    if (!type || type === "pulumi:pulumi:Stack") continue
    if (/iam/i.test(type)) continue
    if (!fine && !COARSE.has(type)) continue
    const name = resourceLabel(resource)
    if (!name) continue
    fixtures.push({
      id: resource.urn || name,
      vpcId: "",
      kind: KIND[type] || "generic",
      name,
      status: "ok",
      uses: resource.dependencies || [],
    })
  }
  const ids = new Set(fixtures.map((item) => item.id))
  for (const item of fixtures) {
    item.uses = (item.uses || []).filter((id) => ids.has(id) && id !== item.id)
  }
  const fn = fixtures.find((item) => item.kind === "function")
  if (fn) {
    for (const kind of ["bucket", "table", "secret"]) {
      const other = fixtures.find((item) => item.kind === kind)
      if (other && !fn.uses.includes(other.id)) fn.uses.push(other.id)
    }
  }
  return fixtures
}

export function resourceFact(text, stackName) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return 0
  }
  const rows = Array.isArray(data) ? data : []
  const row = rows.find((item) => item.name === stackName) || rows.find((item) => item.current)
  return Number.isInteger(row?.resourceCount) ? row.resourceCount : 0
}
