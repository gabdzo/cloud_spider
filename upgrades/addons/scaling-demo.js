import { setup, small, viewerAccess } from "./common.js";

// Scaling on the demo app (upgrades/demo, namespace demo):
//   - HPAs on web and api: 1 to 4 replicas at 60% of their CPU request,
//     scale down after 60 s of calm
//   - burst=on: a second load generator, 8 parallel loops on web
//   - inflate=N: N pause pods asking for 500m CPU each in scaling-demo; more
//     than the node has left makes Karpenter (if up) add a node
//   - the HPAs only with demoApp=present (Cloud Spider sets it from what it
//     sees on the cluster; by hand: pulumi config set demoApp present). The
//     HPAs live in namespace demo: without the demo app an up there fails
//     with namespaces "demo" not found, after the rest was made.
//   - hpa=off: no HPAs even when the demo app is there
export default function scalingDemo({ pulumi, aws, k8s, addon }) {
  const { config, k, netpol } = setup({ pulumi, aws, k8s, addon });
  const burst = config.get("burst") || "off";
  const inflate = Number(config.get("inflate") ?? 0);
  const hpa = config.get("hpa") || "on";
  const demoApp = config.get("demoApp") || "absent";
  if (!["on", "off"].includes(hpa)) throw new Error("hpa must be on or off");
  if (!["absent", "present"].includes(demoApp)) throw new Error("demoApp must be absent or present");
  if (!["on", "off"].includes(burst)) throw new Error("burst must be on or off");
  if (!Number.isInteger(inflate) || inflate < 0 || inflate > 6) throw new Error("inflate must be a whole number from 0 to 6");

  for (const name of hpa === "on" && demoApp === "present" ? ["web", "api"] : []) {
    new k8s.autoscaling.v2.HorizontalPodAutoscaler(`hpa-${name}`, {
      metadata: { name, namespace: "demo", labels: { "app.kubernetes.io/part-of": "cloudspider-addons" } },
      spec: {
        scaleTargetRef: { apiVersion: "apps/v1", kind: "Deployment", name },
        minReplicas: 1,
        maxReplicas: 4,
        metrics: [{ type: "Resource", resource: { name: "cpu", target: { type: "Utilization", averageUtilization: 60 } } }],
        behavior: { scaleDown: { stabilizationWindowSeconds: 60, policies: [{ type: "Pods", value: 1, periodSeconds: 30 }] } },
      },
    }, k);
  }

  const ns = new k8s.core.v1.Namespace("scaling-demo", { metadata: { name: addon.namespace } }, k);
  const inNs = { ...k, dependsOn: [ns, ...netpol(addon.namespace, ns)] };
  // Not ready in 5 minutes: the run fails and says why (run pane).
  const workload = { ...inNs, customTimeouts: { create: "5m", update: "5m" } };
  const secure = { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } };
  const pod = { runAsNonRoot: true, runAsUser: 65532, seccompProfile: { type: "RuntimeDefault" } };
  new k8s.apps.v1.Deployment("burst", {
    metadata: { name: "burst", namespace: addon.namespace },
    spec: {
      replicas: burst === "on" ? 1 : 0,
      selector: { matchLabels: { app: "burst" } },
      template: {
        metadata: { labels: { app: "burst", "app.kubernetes.io/name": "burst", "app.kubernetes.io/part-of": "cloudspider-addons" } },
        spec: {
          securityContext: pod,
          containers: [{
            name: "burst",
            image: "busybox:1.36",
            command: ["/bin/sh", "-c", "for i in 1 2 3 4 5 6 7 8; do (while true; do wget -q -O /dev/null http://web.demo:9898/ || sleep 1; done) & done; wait"],
            // Ready while it runs (Kyverno require-readiness-probe): busybox's true.
            readinessProbe: { exec: { command: ["/bin/true"] }, periodSeconds: 30 },
            resources: small("50m", "16Mi", "64Mi"),
            securityContext: secure,
          }],
        },
      },
    },
  }, workload);
  new k8s.apps.v1.Deployment("inflate", {
    metadata: { name: "inflate", namespace: addon.namespace },
    spec: {
      replicas: inflate,
      selector: { matchLabels: { app: "inflate" } },
      template: {
        metadata: { labels: { app: "inflate", "app.kubernetes.io/name": "inflate", "app.kubernetes.io/part-of": "cloudspider-addons" } },
        spec: {
          securityContext: pod,
          terminationGracePeriodSeconds: 0,
          // pause has no shell and no port; "/pause -v" prints its version and
          // exits 0, which is all a readiness probe of a placeholder needs.
          containers: [{ name: "pause", image: "registry.k8s.io/pause:3.10", readinessProbe: { exec: { command: ["/pause", "-v"] }, periodSeconds: 30 }, resources: small("500m", "128Mi", "128Mi"), securityContext: secure }],
        },
      },
    },
  }, workload);
  viewerAccess(k8s, k, addon.id, [{ apiGroups: ["autoscaling"], resources: ["horizontalpodautoscalers"] }, { apiGroups: [""], resources: ["events"] }, { apiGroups: ["events.k8s.io"], resources: ["events"] }]);
  return { version: "", details: { burst, inflate, hpa: hpa === "on" && demoApp === "present" ? "on demo/web, demo/api" : "off" } };
}
