export function cardName(spec, values = {}) {
  if (spec?.id === "eks") return values.clusterName || ""
  // An add-on confirms with its whole stack name: kyverno-cloudspider-up.
  if (spec?.addon) return stackFor(spec, values)
  // Cards without a name (pgcluster, shopapi) confirm with the stack name.
  if (!spec?.parameters?.some((item) => item.name === "name")) return spec?.stack || ""
  return values.name || ""
}

// TAKE IT DOWN accepts the card's name or its stack name (camp's name is
// cloudspider-camp, its stack is camp: both work).
export function confirmNames(spec, values = {}, legacyName = LEGACY_CLUSTER) {
  return [...new Set([cardName(spec, values), stackFor(spec, values, legacyName)].filter(Boolean))]
}

export function confirmMatches(expected, typed) {
  const names = (Array.isArray(expected) ? expected : [expected]).filter(Boolean)
  const text = typeof typed === "string" ? typed.trim() : ""
  return Boolean(text) && names.includes(text)
}

// What the confirm field asks for, and what a mismatch says.
export function confirmPrompt(spec, values = {}, legacyName = LEGACY_CLUSTER) {
  const [name, other] = confirmNames(spec, values, legacyName)
  if (!name) return "type the name"
  return other ? `type ${name} (or ${other})` : `type ${name}`
}

export function confirmMismatch(spec, values = {}, legacyName = LEGACY_CLUSTER) {
  const names = confirmNames(spec, values, legacyName)
  return names.length ? `the name does not match: type ${names.join(" or ")} to take it down` : "the name does not match"
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
  if (history?.never && !(cluster?.found)) {
    return { status: "ok", text: `stack ${history.stack || ""} is set up but nothing is made yet (a preview creates nothing). RUN makes it.`.replace("  ", " ") }
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
export function failureText(args, code, lines = [], errLines = [], stack = "", cmd = "pulumi") {
  const head = cmd === "pulumi"
    ? `pulumi ${args[0]}${stack ? ` (stack ${stack})` : ""} failed, exit ${code}`
    : `${cmd} ${args.slice(0, 2).join(" ")} failed, exit ${code}`
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
  // A stack that a PREVIEW made has no history yet: nothing was created.
  return { kind: last?.kind || "", resources: 0, ...(Array.isArray(data) && !data.length ? { never: true } : {}) }
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

// A failed or refused stack run, in plain words: which known cause it is and
// what to do about it. The first match wins, so the specific causes come
// before the general ones. Shared by the server (the {error, hint} reply)
// and the page (the ERROR plate).
const HINTS = [
  {
    kind: "demo-missing",
    test: /namespaces "demo" not found/i,
    hint: "The HPA scaling demo's HPAs scale the EKS demo app (namespace demo), which is not on this cluster. Run scaling-demo again: Cloud Spider now checks for the demo app first and, without it, runs only the burst and inflate parts (the run log says HPA skipped), so the same stack finishes. For the HPAs, raise the EKS demo app on this cluster first.",
  },
  {
    kind: "aws-missing",
    test: /spawn aws ENOENT|aws is not on PATH/i,
    hint: "The AWS CLI is not on the PATH of the shell that started Cloud Spider. Install it (brew install awscli), check `aws --version` there, then restart the server from that terminal.",
  },
  {
    kind: "kubectl-missing",
    test: /spawn kubectl ENOENT|kubectl is not on PATH/i,
    hint: "kubectl is not on the PATH of the shell that started Cloud Spider. Install it (brew install kubectl), then restart the server from that terminal.",
  },
  {
    kind: "pulumi-missing",
    test: /spawn pulumi ENOENT|pulumi: command not found|pulumi did not start|pulumi is not on PATH/i,
    hint: "Pulumi is not on the PATH of the shell that started Cloud Spider. Install it (brew install pulumi/tap/pulumi), check `pulumi version` in that terminal, then restart the server there with npm start.",
  },
  {
    kind: "passphrase",
    test: /passphrase|PULUMI_CONFIG_PASSPHRASE|failed to decrypt|incorrect passphrase|getting secrets manager/i,
    hint: "Pulumi could not open the stack's secrets. These stacks use an empty passphrase: stop the server and start it again with PULUMI_CONFIG_PASSPHRASE= npm start (no value after the =), from the same terminal as your AWS profile.",
  },
  {
    kind: "pulumi-login",
    test: /not logged in|pulumi login|PULUMI_ACCESS_TOKEN|could not (?:read|open|load) (?:the )?(?:state|backend)|failed to (?:get|load|read) (?:the )?(?:stack|backend)|NoSuchBucket|cloudspider-state-\d+.*(?:AccessDenied|Forbidden|403)/i,
    hint: "Pulumi cannot reach its state in S3 (bucket cloudspider-state-550536272523, profile default). Check `aws sts get-caller-identity --profile default` works and that upgrades/<dir>/Pulumi.yaml still names that backend; do not `pulumi login` to the Pulumi Cloud.",
  },
  {
    kind: "aws-account",
    test: /allowed account|account ID not allowed|not in the allowed list|forbidden account|allowedAccountIds/i,
    hint: "AWS answered for a different account than 550536272523. Start the server with AWS_PROFILE=default (your shell may export a work profile), e.g. AWS_PROFILE=default AWS_REGION=eu-north-1 PULUMI_CONFIG_PASSPHRASE= npm start.",
  },
  {
    kind: "aws-creds",
    test: /ExpiredToken|token (?:has )?expired|security token included in the request is invalid|UnrecognizedClientException|InvalidClientTokenId|SignatureDoesNotMatch|NoCredentialProviders|no valid credential|could not load credentials|Unable to locate credentials|SSO session|sso login|failed to refresh cached credentials|The config profile .* could not be found/i,
    hint: "AWS credentials are missing, expired or from the wrong profile. In the server's terminal check `aws sts get-caller-identity --profile default` (for SSO: `aws sso login --profile default`), then restart with AWS_PROFILE=default npm start.",
  },
  {
    kind: "quota",
    test: /LimitExceeded|limit exceeded|quota|VcpuLimitExceeded|AddressLimitExceeded|VpcLimitExceeded|InsufficientInstanceCapacity|Unsupported.*availability zone/i,
    hint: "An AWS limit or capacity stopped it (vCPU, VPC, Elastic IP or EKS quota, or no capacity for the instance type in a zone). Take down an unused stack or ask for a quota raise in Service Quotas (eu-north-1), then run again.",
  },
  {
    // EKS keeps one add-on of a name per cluster. Two Cloud Spider stacks
    // install metrics-server and the Pod Identity agent: the demo stack and
    // that add-on's own stack; the other one is the likely owner.
    kind: "addon-taken",
    test: /EKS Add-On \(([a-z0-9-]+):([a-z0-9-]+)\)[\s\S]*?(?:ResourceInUseException|already exists)/i,
    hint: addonTakenHint,
  },
  {
    kind: "name-taken",
    test: /AlreadyExists|already exists|ResourceInUseException|EntityAlreadyExists|BucketAlreadyOwnedByYou|BucketAlreadyExists|Duplicate/i,
    hint: "Something with this name already exists outside this stack (often a leftover from an earlier run). Pick another cluster name, or find and delete the leftover (the message names it) before running again.",
  },
  {
    kind: "locked",
    test: /locked by|currently locked|another update is in progress|conflict: Another update/i,
    hint: "The stack is locked by an earlier run that did not finish. Make sure no pulumi is still running (ps aux | grep pulumi); then in that stack's folder run `pulumi cancel --stack <stack> --yes` and try again.",
  },
  {
    kind: "dependents",
    test: /still has stacks on it/i,
    hint: "Taking the cluster down first strands what those stacks made outside it (an ALB from the LBC, EBS volumes from pgcluster) and leaves their state pointing at a cluster that is gone. Take each down from its own card first. If you really mean it, type the cluster name followed by \" anyway\".",
  },
  {
    kind: "busy",
    test: /an upgrade is already running/i,
    hint: "Another stack run is still going (its log is in its own card). Wait for it to finish, then press RUN again. PREVIEW counts as a run.",
  },
  {
    kind: "cluster-limit",
    test: /clusters are already up/i,
    hint: "Cloud Spider allows two clusters at once so the bill cannot run away. Take one down first, or start the server with CLOUDSPIDER_MAX_CLUSTERS=3.",
  },
  {
    kind: "preflight",
    test: /free pod slots|Room for pods|is already on|needs .* first|the name does not match|must be (?:a |one of|t4g|\d)|short lowercase name/i,
    hint: "Cloud Spider refused this before running pulumi, so nothing changed. The message says what to fix.",
  },
  {
    kind: "page",
    test: /the page failed|the server failed|Failed to fetch|NetworkError/i,
    hint: "The page could not reach the Cloud Spider server. Check the terminal where you ran npm start: it may have stopped or printed an error.",
  },
]

export function runHint(text = "") {
  const value = String(text || "")
  if (!value) return { kind: "", hint: "" }
  const found = HINTS.find((item) => item.test.test(value))
  if (!found) return { kind: "", hint: "" }
  return { kind: found.kind, hint: typeof found.hint === "function" ? found.hint(value) : found.hint }
}

const EKS_ADDON_IDS = { "eks-pod-identity-agent": "pod-identity", "metrics-server": "metrics-server" }

// Which Cloud Spider stack already holds the add-on a 409 names: the run's
// own stack is in the text ([stack X] or --stack X); the other installer is
// the owner.
function addonTakenHint(text) {
  const [, cluster, name] = text.match(/EKS Add-On \(([a-z0-9-]+):([a-z0-9-]+)\)/i)
  const id = EKS_ADDON_IDS[name]
  const self = (text.match(/\[stack ([^\]\s]+)\]|--stack ([^\s'"]+)/) || []).slice(1).find(Boolean) || ""
  const check = `aws eks describe-addon --cluster-name ${cluster} --addon-name ${name} --query addon.tags shows its project tag.`
  if (!id) return `The EKS add-on ${name} is already on ${cluster}, installed outside this stack. ${check}`
  const addonStack = `${id}-${cluster}`
  const owner = self === "demo" ? `the add-on stack ${addonStack} (its card under ADD-ONS)` : self === addonStack ? "the EKS demo app (stack demo)" : `the EKS demo app (stack demo) or the add-on stack ${addonStack}`
  return `${name} is already on ${cluster}, most likely from ${owner}; EKS holds one per cluster. The demo stack uses one another stack made (RUN again after updating Cloud Spider), and an add-on card refuses one the demo made. If it still fails, the add-on has no Cloud Spider project tag (made by hand): take the other stack down first. ${check}`
}

// The lines worth reading first from a failed run: Pulumi's own error and
// detail lines, newest last, without the noise around them.
export function errorHead(error = "", lines = [], max = 4) {
  const text = [String(error || ""), ...lines.map(String)].join("\n")
  const all = text.split("\n").map((line) => line.trim()).filter(Boolean)
  const meaningful = all.filter((line) => /^(error|Details|Error|\S+Exception|panic)\b|An error occurred|Exception:|failed, exit \d+|: error:|ENOENT|not on PATH|status code: \d{3}|api error/i.test(line))
  const pick = meaningful.length ? meaningful : all
  return [...new Set(pick)].slice(0, max)
}

// A copy-paste line that runs the same steps in a terminal. The passphrase
// is never written out: it keeps whatever the terminal has (empty here).
export function rerunCommand(directory, steps = []) {
  const quote = (value) => (/^[A-Za-z0-9_./:@%+=,[\]-]+$/.test(value) ? value : `'${String(value).replace(/'/g, `'\\''`)}'`)
  const head = `cd ${quote(directory)} && export AWS_PROFILE=default AWS_REGION=eu-north-1 PULUMI_CONFIG_PASSPHRASE="\${PULUMI_CONFIG_PASSPHRASE-}"`
  return [head, ...steps.map((args) => ["pulumi", ...args].map(quote).join(" "))].join(" && ")
}

// Run output: Pulumi's --diff prints a Kubernetes provider's kubeconfig input
// (the cluster's CA data, its API server URL), on one line or as a JSON
// block. Not secret, but long and noisy: hide the whole one-line document and
// the CA data in a block. Best effort per chunk; everything else stays.
export function maskKubeconfig(text) {
  return String(text)
    .replace(/(\bkubeconfig\s*:\s*)"(?:[^"\\]|\\.){40,}"/g, '$1"[kubeconfig hidden]"')
    .replace(/(certificate-authority-data\\?"?\s*[:=]\s*\\?")[A-Za-z0-9+/=]{20,}/g, "$1[hidden]");
}
