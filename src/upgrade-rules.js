export function cardName(spec, values = {}) {
  if (spec?.id === "eks") return values.clusterName || ""
  // An add-on confirms with its whole stack name: kyverno-cloudspider-up.
  if (spec?.addon) return stackFor(spec, values)
  // Cards without a name (pgcluster, shopapi) confirm with the stack name.
  if (!spec?.parameters?.some((item) => item.name === "name")) return spec?.stack || ""
  return values.name || ""
}

export function confirmMatches(expected, typed) {
  return Boolean(expected) && typed === expected
}

export function upgradeSpiderLine({ action, title, sample, response }) {
  if (sample) return { status: "fail", text: "sample, not the account." }
  if (response?.error) return { status: "fail", text: response.error }
  if (response?.running) {
    const text = action === "destroy" ? `taking ${title} down` : action === "preview" ? `previewing ${title}` : `raising ${title}`
    return { status: "ok", text }
  }
  return { status: "fail", text: "the upgrade did not start" }
}

export function watchLine({ cluster, history }) {
  if (history?.missing) {
    return { status: "ok", text: `no stack ${history.stack || ""} yet. Run makes it.`.replace("  ", " ") }
  }
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

// The first cluster lived in the stack "upgrade" before clusters had their
// own stacks. It keeps that stack (and its state) so nothing is replaced.
export const LEGACY_CLUSTER = "cloudspider-up"

// Which Pulumi stack a card runs. EKS: one stack per cluster name, so a new
// name is a new stack with its own state, lock and Pulumi.<stack>.yaml,
// never a rename of the cluster that is already up.
// legacyName: the cluster the old stack actually holds (its `name` output),
// in case it is not cloudspider-up.
export function stackFor(spec, values = {}, legacyName = LEGACY_CLUSTER) {
  if (spec?.addon) return `${spec.stack}-${values.clusterName || LEGACY_CLUSTER}`
  if (spec?.id !== "eks") return spec?.stack || ""
  const name = values.clusterName || LEGACY_CLUSTER
  return name === (legacyName || LEGACY_CLUSTER) ? spec.stack : `eks-${name}`
}

// Up is refused only for a NEW cluster when the account already runs max.
// Re-running up on a cluster that exists is always fine.
export function tooManyClusters(clusters, wanted, max = 2) {
  if (!Array.isArray(clusters) || clusters.includes(wanted)) return false
  return clusters.length >= max
}

// What the card shows when a pulumi step fails: Pulumi's own words. Pulumi
// prints its diagnostics ("error: ...") on stdout during up and on stderr
// for everything else, so look at both, newest first.
export function failureText(args, code, lines = [], errLines = [], stack = "") {
  const head = `pulumi ${args[0]}${stack ? ` (stack ${stack})` : ""} failed, exit ${code}`
  const all = lines.flatMap((chunk) => String(chunk).split("\n"))
  const errors = all.filter((line) => /^\s*(error|Details):/i.test(line)).map((line) => line.trim())
  const unique = [...new Set(errors)].slice(-6)
  let detail = unique
  if (!detail.length) {
    detail = errLines.flatMap((chunk) => String(chunk).split("\n")).map((line) => line.trim()).filter(Boolean).slice(-8)
  }
  if (!detail.length) detail = all.map((line) => line.trim()).filter(Boolean).slice(-8)
  return [head, ...detail].join("\n")
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
  "aws:lambda/functionUrl:FunctionUrl",
  "aws:s3/bucket:Bucket",
  "aws:lambda/function:Function",
  "aws:dynamodb/table:Table",
  "aws:secretsmanager/secret:Secret",
])

const KIND = {
  "aws:lambda/functionUrl:FunctionUrl": "url",
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
  // A function URL goes by its host: abc123.lambda-url.eu-north-1.on.aws
  if (typeof outputs.functionUrl === "string" && /^https:\/\//.test(outputs.functionUrl)) {
    return outputs.functionUrl.replace(/^https:\/\//, "").replace(/\/$/, "")
  }
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
      ...(KIND[type] === "url" ? { url: resource.outputs.functionUrl } : {}),
      status: "ok",
      uses: resource.dependencies || [],
      // For vaults: match by ARN or tags.
      arn: typeof resource.outputs?.arn === "string" ? resource.outputs.arn : "",
      tags: resource.outputs?.tags && typeof resource.outputs.tags === "object" ? resource.outputs.tags : {},
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

// The same steps by hand, from the repo root (docs/RUN-ME.md §16).
export function addonCommands(spec, cluster) {
  const stack = `${spec.id}-${cluster}`
  const extras = (spec.parameters || []).filter((item) => item.name !== "clusterName").map((item) => ` && pulumi config set ${item.name} ${item.default}`).join("")
  return [
    { label: "select", text: `cd upgrades/addons && pulumi stack select --create ${stack} && pulumi config set clusterName ${cluster}${extras}` },
    { label: "preview", text: "pulumi preview --diff" },
    { label: "up", text: "pulumi up" },
    { label: "destroy", text: `pulumi destroy && pulumi stack rm ${stack}` },
  ]
}
