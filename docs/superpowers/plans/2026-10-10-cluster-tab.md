# Cluster tab

Path and Cluster are two readers in front of one picture. A new cloud picture does not get its own palette, sprite blitter, or column math.

## What you see

The header has Place's map, Path, and Cluster. Cluster is its own tab. The button reads Map while that tab is open, the same way Path does. Sample on that tab draws a local OpenShift-shaped picture and does not call AWS. Off sample, the tab lists EKS clusters in the region on screen: control plane, then each node group.

```
control plane    project    worker     workload    route
openshift        web        worker-a   web         web.apps
                            worker-b
```

That sample is the OpenShift shape. The live read today is EKS, because that client already exists. An OpenShift or Kubernetes API fills the same nodes and edges.

## The picture

`src/scene.js` owns the palette and the sprite blit. Map, Path, and Cluster all draw through it.

`layoutDiagram(diagram, columns)` in `src/path-layout.js` places a diagram. Path passes its column map. Cluster passes `CLUSTER_COLUMNS` from `src/cluster.js`. A new feature adds a column map and a reader. It does not copy `path-draw.js`.

`sceneIcon(kind)` in `src/pixel-art.js` picks the sprite. Path kinds and cluster kinds share the load balancer, instance, and EKS sprites. Workload and project are the only new grids.

A reader returns `{ nodes, edges }`. Node fields are `id`, `kind`, `label`, `caption`, `status`. Edge fields are `from`, `to`, `status`. Status is `ok`, `broken`, `hang`, or `unknown`.

## Live OpenShift, next

Not in this slice. When a kubeconfig is available, a reader should return that same diagram:

| Kind | OpenShift / Kubernetes |
|---|---|
| control-plane | the cluster |
| namespace | project or namespace |
| node | node |
| workload | deployment, or a pod when it is the thing that matters |
| route | route or ingress |

`app.clusterView` is the seam. Today it calls `path.clusters` and `diagramFromClusters`. A later reader can replace that call and leave the tab, the layout, and the icons alone.

The map poll must not call it. Cluster refreshes on its own 15 second timer, only while the tab is open.
