// The cluster scan's AWS side, read with the app's own AWS credentials (read
// calls only): which running images are scanned in ECR and what the scans
// found, and which EBS volumes AWS Backup protects. Without AWS access the
// records say so and the controls decide UNKNOWN for what needs them.
import { DescribeImageScanFindingsCommand, DescribeRepositoriesCommand, GetRegistryScanningConfigurationCommand } from "@aws-sdk/client-ecr";
import { ListProtectedResourcesCommand } from "@aws-sdk/client-backup";
import { awsFailure, evidence, pageAll } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

const ECR = /^(\d{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com(?:\.cn)?\/([^:@]+)(?::([^@]+))?(?:@(sha256:[a-f0-9]{64}))?$/;
// EKS add-on and VPC CNI images live in AWS's own ECR accounts.
const AWS_REPO = /^(eks\/|eks-|amazon-k8s-cni|amazon\/|aws-|ebs-csi|kube-proxy|coredns|pause)/;

// "registry/repo:tag" → where it comes from.
export function imageSource(image, account = "") {
  const text = String(image || "");
  const m = ECR.exec(text);
  if (m) {
    const [, owner, region, repo, tag, digest] = m;
    if (account && owner === account) return { kind: "ecr", account: owner, region, repo, tag: tag || "", digest: digest || "" };
    if (AWS_REPO.test(repo)) return { kind: "aws-managed", account: owner, region, repo };
    return { kind: "other-ecr", account: owner, region, repo };
  }
  const host = text.includes("/") && /[.:]/.test(text.split("/")[0]) ? text.split("/")[0] : "docker.io";
  return { kind: "public", registry: host };
}

// Enhanced scanning rules: "*" wildcards on repository names.
export function enhancedCovers(config, repo) {
  if (config?.scanType !== "ENHANCED") return false;
  return (config.rules || []).some((rule) => (rule.repositoryFilters || []).some((f) => new RegExp(`^${String(f.filter || "").split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`).test(repo)));
}

export const kubeAws = {
  key: "kube-aws",
  target: "kubernetes",
  reads: ["GET pods", "ecr:DescribeRepositories", "ecr:GetRegistryScanningConfiguration", "ecr:DescribeImageScanFindings", "backup:ListProtectedResources"],
  async collect({ kube, aws }) {
    const res = await kube.read("pods");
    const st = kubeStatus(res);
    if (st.status !== "ok") {
      const status = st.status === "absent" ? "error" : st.status;
      return [evidence({ key: "kube-images", collector: "kube-aws", read: "GET pods", target: "kubernetes", status, error: st.error }), evidence({ key: "aws-backup-protected", collector: "kube-aws", read: "backup:ListProtectedResources", target: "kubernetes", status: "ok", fields: { available: false, note: "pods were not readable" } })];
    }
    const seen = new Map();
    for (const pod of res.json.items || []) {
      for (const c of [...(pod?.spec?.containers || []), ...(pod?.spec?.initContainers || [])]) {
        if (!c?.image || seen.has(c.image)) continue;
        seen.set(c.image, `${pod?.metadata?.namespace || ""}/${pod?.metadata?.name || ""}`);
      }
    }
    const account = aws?.account ? await aws.account().catch(() => "") : "";
    const images = [...seen.entries()].map(([image, pod]) => ({ image, pod, ...imageSource(image, account) }));
    const out = [];
    if (aws?.clients && account) {
      const configs = new Map();
      for (const img of images.filter((i) => i.kind === "ecr")) {
        const ecr = aws.clients.ecr(img.region);
        try {
          if (!configs.has(img.region)) configs.set(img.region, (await ecr.send(new GetRegistryScanningConfigurationCommand({}))).scanningConfiguration || null);
          const repo = (await ecr.send(new DescribeRepositoriesCommand({ repositoryNames: [img.repo] }))).repositories?.[0];
          img.scanOnPush = repo?.imageScanningConfiguration?.scanOnPush === true;
          img.enhanced = enhancedCovers(configs.get(img.region), img.repo);
          try {
            const found = await ecr.send(new DescribeImageScanFindingsCommand({ repositoryName: img.repo, imageId: img.digest ? { imageDigest: img.digest } : { imageTag: img.tag || "latest" }, maxResults: 1 }));
            const counts = found.imageScanFindings?.findingSeverityCounts || {};
            img.scan = { status: found.imageScanStatus?.status || "", critical: counts.CRITICAL || 0, high: counts.HIGH || 0 };
          } catch (failure) {
            img.scan = { status: failure?.name === "ScanNotFoundException" ? "NONE" : "ERROR", error: String(failure?.name || "") };
          }
        } catch (failure) {
          img.error = awsFailure(failure).error;
        }
      }
      out.push(evidence({ key: "kube-images", collector: "kube-aws", read: "ecr:DescribeImageScanFindings", target: "kubernetes", status: "ok", fields: { aws: true, account, images } }));
      const volumes = [];
      let backupStatus = "ok";
      let backupError = null;
      for (const region of aws.regions || []) {
        const listed = await pageAll(async (NextToken) => {
          const page = await aws.clients.backup(region).send(new ListProtectedResourcesCommand({ NextToken }));
          return { items: page.Results || [], next: page.NextToken };
        });
        if (listed.status !== "ok") { backupStatus = listed.status; backupError = listed.error || null; }
        for (const r of listed.items) if (/:volume\/vol-/.test(r.ResourceArn || "")) volumes.push({ volume: r.ResourceArn.split("/").pop(), last: r.LastBackupTime ? new Date(r.LastBackupTime).toISOString() : null });
      }
      out.push(evidence({ key: "aws-backup-protected", collector: "kube-aws", read: "backup:ListProtectedResources", target: "kubernetes", status: "ok", fields: { available: backupStatus === "ok", note: backupStatus === "ok" ? "" : `AWS Backup not readable: ${backupError?.code || backupStatus}`, volumes } }));
    } else {
      out.push(evidence({ key: "kube-images", collector: "kube-aws", read: "GET pods", target: "kubernetes", status: "ok", fields: { aws: false, account: "", images } }));
      out.push(evidence({ key: "aws-backup-protected", collector: "kube-aws", read: "backup:ListProtectedResources", target: "kubernetes", status: "ok", fields: { available: false, note: "no AWS access for this scan", volumes: [] } }));
    }
    return out;
  },
};
