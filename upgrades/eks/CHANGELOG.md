# Changelog: eks

Semantic versions per module: major = an input removed/renamed or a change that replaces a resource; minor = a new input or resource; patch = no infrastructure change. Bump package.json `version` with an entry here.

## 1.2.0 (2026-10-13)

- A new cluster (kubernetesVersion auto, no live cluster) is created on Kubernetes 1.35 (standard support until 2027-03-27); 1.35 is offered for an in-place upgrade from 1.34. A live cluster keeps its version on auto, as before.
- An EKS managed add-on the stack creates (vpc-cni, eks-pod-identity-agent, metrics-server, aws-ebs-csi-driver) gets an explicit addonVersion: EKS's default for the cluster's Kubernetes version (aws.eks.getAddonVersion). Add-ons already on a cluster keep their version: no update, no replace on existing stacks.

## 1.1.0 (2026-10-13)

- New input vpcCidr (/16 or /17, private; default 10.43.0.0/16 = no change). Zones follow aws:region (<region>a/b). Defaults leave the live stack unchanged.

## 1.0.0 (2026-10-13)

- First versioned release: typed config schema (validated before any resource), providers pinned, mocks matrix, policy pack.
- Earlier history: `git log -- upgrades/eks`.
