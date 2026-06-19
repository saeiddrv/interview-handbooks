---
title: "Kubernetes — Interview Handbook"
description: "Container orchestration top to bottom: architecture, the core objects (Pod, Deployment, Service), controllers, networking & Ingress, config & secrets,…"
sidebar:
  label: "Kubernetes"
---

> Container orchestration top to bottom: architecture, the core objects (Pod, Deployment, Service),
> controllers, networking & Ingress, config & secrets, storage, scaling, health & rollouts,
> security, Helm, and the surrounding ecosystem.

---

## 1. Why Kubernetes? (the orchestration problem)

Docker runs containers on **one** machine. In production you have hundreds of containers across many
machines and you need to: schedule them, restart crashed ones, scale up/down, roll out new versions
without downtime, give them networking and storage, and keep secrets. Doing this by hand is impossible.

**Kubernetes (K8s)** is a **container orchestrator** that automates all of it. You declare the
*desired state* ("I want 5 replicas of this app"), and K8s continuously makes reality match.

> **The core idea — declarative + reconciliation:** "You don't tell Kubernetes *how* to do things
> step by step; you declare the **desired state** in YAML, and controllers constantly **reconcile**
> actual state toward it. If a pod dies, K8s notices the gap and recreates it."

---

## 2. Kubernetes Architecture (control plane + nodes)

A cluster = a **control plane** (the brain) + **worker nodes** (where your containers run).

```
                         CONTROL PLANE (the brain)
        ┌───────────────────────────────────────────────────────┐
        │  API Server  ◀──── kubectl / everything talks here     │
        │  etcd        ◀──── the cluster's database (state)      │
        │  Scheduler   ◀──── decides which node a pod runs on    │
        │  Controller Manager ◀── runs reconciliation loops      │
        └───────────────────────────────────────────────────────┘
                                  │
        ┌───────────────┬─────────┴────────┬──────────────────┐
   WORKER NODE 1      WORKER NODE 2      WORKER NODE 3
   ┌──────────┐       ┌──────────┐       ┌──────────┐
   │ kubelet  │       │ kubelet  │       │ kubelet  │  ← agent: runs/monitors pods
   │ kube-proxy│      │ kube-proxy│      │ kube-proxy│ ← networking rules
   │ runtime  │       │ runtime  │       │ runtime  │  ← containerd runs containers
   │  [Pods]  │       │  [Pods]  │       │  [Pods]  │
   └──────────┘       └──────────┘       └──────────┘
```

**Control plane components:**
- **API Server** — the front door; everything (kubectl, controllers, nodes) talks to it. Validates and
  stores state.
- **etcd** — distributed key-value store holding the **entire cluster state** (the source of truth).
  Back it up!
- **Scheduler** — assigns new pods to nodes based on resources, affinity, taints.
- **Controller Manager** — runs the **reconciliation loops** (Deployment, Node, Job controllers, etc.).
- **Cloud Controller Manager** — integrates with cloud APIs (load balancers, volumes).

**Worker node components:**
- **kubelet** — the node agent; ensures the pods it's told to run are healthy.
- **kube-proxy** — programs networking/routing rules for Services.
- **Container runtime** — runs the containers (containerd / CRI-O). *(Docker as a runtime was removed
  in 1.24 — "Dockershim removal"; Docker images still work fine.)*

> **"What happens when you `kubectl apply` a Deployment?"** kubectl → API Server validates & writes
> to etcd → Deployment controller creates a ReplicaSet → ReplicaSet creates Pods → Scheduler assigns
> them to nodes → kubelet on each node tells the runtime to pull images and start containers.

---

## 3. The Core Objects (Pod → Deployment → Service)

### Pod — the smallest unit
A **Pod** wraps one (or a few tightly-coupled) containers that share network (same IP) and storage.
You rarely create pods directly — controllers manage them.

> Pods are **ephemeral and disposable** — they get a new IP each time, can be killed/rescheduled
> anytime. Never rely on a specific pod or its IP. That's *why* Services exist.

**Multi-container pod patterns:**
- **Sidecar** — a helper container alongside the app (log shipper, proxy). The classic pattern.
- **Init container** — runs to completion *before* the app starts (migrations, waiting for deps).
- **Ambassador / Adapter** — proxy or reshape traffic/output.

### ReplicaSet — keeps N copies running
Ensures a specified number of identical pods are always up. You usually don't manage it directly.

### Deployment — manages stateless apps
The workhorse for stateless services. Manages ReplicaSets to give you **declarative updates, rolling
upgrades, and rollbacks.**
```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: web }
spec:
  replicas: 3
  selector: { matchLabels: { app: web } }
  template:
    metadata: { labels: { app: web } }
    spec:
      containers:
        - name: web
          image: myapp:1.2
          ports: [{ containerPort: 3000 }]
          resources:
            requests: { cpu: "100m", memory: "128Mi" }
            limits:   { cpu: "500m", memory: "256Mi" }
```
```bash
kubectl apply -f web.yaml
kubectl rollout status deploy/web
kubectl rollout undo deploy/web        # roll back
kubectl scale deploy/web --replicas=5
```

### Service — stable networking for pods
Pods come and go; a **Service** gives a **stable IP/DNS name** and load-balances across the matching
pods (via label selector). See §15.

---

## 4. Workload Controllers (every type)

| Controller | Runs | Use |
|---|---|---|
| **Deployment** | Stateless pods, rolling updates | Web/API services |
| **ReplicaSet** | Maintains N pod copies | (Managed by Deployment) |
| **StatefulSet** | Pods with **stable identity + storage** | Databases, Kafka, anything stateful |
| **DaemonSet** | One pod **per node** | Log/metrics agents, CNI, node tools |
| **Job** | Run-to-completion task | Batch processing, migrations |
| **CronJob** | Scheduled Job | Backups, periodic reports |

> **Deployment vs StatefulSet:** Deployments treat pods as interchangeable (random names, shared/no
> storage). **StatefulSets** give each pod a **stable name** (`db-0`, `db-1`), **stable storage**
> (its own PVC), and **ordered** startup/scaling — needed for databases and clustered systems.

> **DaemonSet** = "run exactly one of these on every node" — perfect for things like Fluent Bit
> (logs), node-exporter (metrics), or a CNI agent.

---

## 5. Networking in Kubernetes (Services, Ingress, DNS)

### The Kubernetes networking model
Every pod gets its own IP and **all pods can reach all pods** (flat network). The **CNI plugin**
(Calico, Cilium, Flannel) implements this.

### Service types
| Type | What it does | Use |
|---|---|---|
| **ClusterIP** (default) | Internal-only stable IP/DNS, load-balances to pods | Service-to-service inside the cluster |
| **NodePort** | Opens a port on every node's IP | Basic external access / dev |
| **LoadBalancer** | Provisions a cloud load balancer | Production external access (one service) |
| **ExternalName** | Maps to an external DNS name | Point at an external service |
| **Headless** (`clusterIP: None`) | No load balancing; returns pod IPs directly | StatefulSets, direct pod addressing |

```yaml
apiVersion: v1
kind: Service
metadata: { name: web }
spec:
  selector: { app: web }     # routes to pods with this label
  ports: [{ port: 80, targetPort: 3000 }]
  type: ClusterIP
```

### DNS & discovery
CoreDNS gives every Service a name: `web.default.svc.cluster.local` (or just `web` in the same
namespace). That's how services find each other — never hardcode pod IPs.

### Ingress — HTTP routing & one entry point
A `Service type=LoadBalancer` per app gets expensive. **Ingress** is a single entry point that does
**host/path-based HTTP routing**, TLS termination, etc. — backed by an **Ingress Controller**
(nginx, Traefik, HAProxy).
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata: { name: app-ingress }
spec:
  rules:
    - host: shop.example.com
      http:
        paths:
          - path: /api
            pathType: Prefix
            backend: { service: { name: api, port: { number: 80 } } }
          - path: /
            pathType: Prefix
            backend: { service: { name: web, port: { number: 80 } } }
```
> **Service vs Ingress:** a **Service** does L4 (TCP) load balancing inside the cluster; **Ingress**
> does L7 (HTTP) routing from outside — host/path rules, TLS, one LB for many services. The newer
> **Gateway API** is the evolving successor to Ingress.

### NetworkPolicy
By default all pods can talk to all pods. A **NetworkPolicy** is a firewall that restricts who can talk
to whom (e.g., only the API can reach the DB). Requires a supporting CNI (Calico/Cilium).

---

## 6. Configuration & Secrets

Separate config from images (12-factor) so the same image runs in dev/staging/prod.

- **ConfigMap** — non-sensitive key/value config, injected as env vars or mounted files.
- **Secret** — for sensitive data (passwords, tokens, certs). **Base64-encoded, NOT encrypted** by
  default — enable **encryption at rest** in etcd and use RBAC, or an external manager (Vault, Sealed
  Secrets, cloud secret stores + External Secrets Operator).

```yaml
apiVersion: v1
kind: ConfigMap
metadata: { name: app-config }
data:
  LOG_LEVEL: "info"
---
# inject into a pod
envFrom:
  - configMapRef: { name: app-config }
  - secretRef:    { name: app-secrets }
```

> **"Are Kubernetes Secrets secure?"** Not by themselves — they're just base64. Secure them with
> etcd **encryption at rest**, **RBAC** to limit access, and ideally an external secrets manager.

---

## 7. Storage in Kubernetes (Volumes, PV/PVC, StorageClass)

Pods are ephemeral, so persistent data needs real storage abstractions.

- **Volume** — storage tied to a pod's lifecycle (e.g., `emptyDir` shared between containers).
- **PersistentVolume (PV)** — a piece of cluster storage (an EBS disk, NFS share) provisioned by an
  admin or dynamically.
- **PersistentVolumeClaim (PVC)** — a pod's *request* for storage ("I need 10Gi, ReadWriteOnce"). It
  binds to a PV.
- **StorageClass** — defines **dynamic provisioning** (e.g., "gp3 SSD on AWS"); a PVC referencing it
  auto-creates a PV.

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata: { name: data }
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: gp3
  resources: { requests: { storage: 10Gi } }
```

**Access modes:** `ReadWriteOnce` (one node), `ReadOnlyMany`, `ReadWriteMany` (needs NFS/CephFS-type
backend).

> "PVC is the *request*, PV is the *resource*, StorageClass is the *factory* that makes PVs on
> demand. StatefulSets use `volumeClaimTemplates` so each pod gets its own PVC."

---

## 8. Scaling & Scheduling (HPA, requests/limits, affinity)

### Requests & limits (the most important tuning knob)
- **Requests** — guaranteed resources; the scheduler uses them to place pods.
- **Limits** — hard ceiling; exceed CPU → throttled, exceed memory → **OOMKilled**.

> **Trap:** no requests/limits → noisy-neighbor problems and unpredictable scheduling. Memory limit
> too low → pods get OOMKilled and restart-loop.

### Autoscaling
- **HPA (Horizontal Pod Autoscaler)** — adds/removes **pod replicas** based on CPU/memory/custom
  metrics. The everyday autoscaler.
- **VPA (Vertical Pod Autoscaler)** — adjusts a pod's requests/limits (right-sizing).
- **Cluster Autoscaler** — adds/removes **nodes** when pods can't be scheduled / nodes are idle.
- **KEDA** — event-driven autoscaling (scale on queue length, Kafka lag, etc.; scale to zero).

```bash
kubectl autoscale deploy web --cpu-percent=70 --min=3 --max=20
```

### Scheduling controls
- **nodeSelector / Node Affinity** — run pods on specific nodes (e.g., GPU nodes).
- **Taints & Tolerations** — a node *repels* pods unless they *tolerate* the taint (reserve nodes).
- **Pod Affinity/Anti-Affinity** — co-locate or spread pods (e.g., spread replicas across zones).
- **Topology Spread Constraints** — even distribution across zones/nodes for HA.

> **"Pod stuck in `Pending` — why?"** Usually **insufficient resources** (no node has the requested
> CPU/memory), an **unschedulable** taint, no matching node affinity, or an **unbound PVC**. `kubectl
> describe pod` shows the scheduler's reason.

---

## 9. Health, Rollouts & Self-Healing

### Probes — how K8s knows a pod is healthy
| Probe | Question it answers | On failure |
|---|---|---|
| **Liveness** | "Is the app alive (not deadlocked)?" | Restart the container |
| **Readiness** | "Can it serve traffic *now*?" | Remove from Service endpoints (no restart) |
| **Startup** | "Has a slow app finished booting?" | Hold off the other probes |

```yaml
readinessProbe:
  httpGet: { path: /healthz, port: 3000 }
  initialDelaySeconds: 5
  periodSeconds: 10
```
> **Liveness vs Readiness:** readiness controls **traffic** (failing = pulled from the load balancer
> but kept running); liveness controls **restarts** (failing = killed & restarted). Misusing liveness
> for slow startups causes restart loops — use a **startup probe**.

### Rolling updates & rollbacks
Deployments update **gradually** — spin up new pods, wait for readiness, then retire old ones (zero
downtime), governed by `maxSurge` / `maxUnavailable`.
```bash
kubectl set image deploy/web web=myapp:1.3   # triggers a rolling update
kubectl rollout status deploy/web
kubectl rollout undo deploy/web              # instant rollback
```
**Other strategies:** **Recreate** (kill all, then start — downtime), **Blue/Green** (two full
environments, switch traffic), **Canary** (send a small % to the new version first — often via service
mesh/Argo Rollouts).

### Self-healing
K8s restarts crashed containers, reschedules pods off dead nodes, and recreates pods to maintain replica
count — automatically. **`CrashLoopBackOff`** = a container keeps crashing; K8s backs off restart timing.

> **`CrashLoopBackOff` debugging:** `kubectl logs <pod> --previous`, `kubectl describe pod` — usually
> a bad config, missing dependency/secret, failed migration, or a too-aggressive liveness probe.

---

## 10. Security (RBAC, contexts, policies)

- **RBAC (Role-Based Access Control)** — who can do what. **Role/ClusterRole** (permissions) bound via
  **RoleBinding/ClusterRoleBinding** to users or **ServiceAccounts** (pod identities). Least privilege!
- **ServiceAccount** — the identity a pod uses to talk to the API server.
- **SecurityContext** — run as non-root, read-only root filesystem, drop Linux capabilities,
  `runAsNonRoot: true`, `allowPrivilegeEscalation: false`.
- **Pod Security Admission** (replaced PodSecurityPolicy) — enforce baseline/restricted standards per
  namespace.
- **NetworkPolicy** — restrict pod-to-pod traffic (default-deny is best practice).
- **Image security** — scan (Trivy), sign (cosign), use minimal/distroless bases, pin digests.
- **Secrets** — encrypt at rest, external managers, never in images.

> "Defense in depth: least-privilege **RBAC**, non-root **securityContext**, **NetworkPolicies** for
> segmentation, scanned/signed images, and encrypted secrets. Namespaces + resource quotas for
> multi-tenant isolation."

---

## 11. Helm & Packaging

Writing raw YAML for every environment is repetitive. **Helm** is the **package manager for
Kubernetes** — it templates and versions your manifests into a **Chart**.

- **Chart** — a package of templated K8s manifests.
- **Values** — `values.yaml` parameterizes a chart (image tag, replicas) per environment.
- **Release** — an installed instance of a chart; supports upgrade/rollback.

```bash
helm install myapp ./chart -f values.prod.yaml
helm upgrade myapp ./chart --set image.tag=1.4
helm rollback myapp 1
```
**Alternatives:** **Kustomize** (template-free overlays, built into `kubectl -k`), **Jsonnet**.

> "Helm for packaging/distribution and complex parameterization; Kustomize for simple, template-free
> environment overlays. Many teams use both."

---

## 12. The Ecosystem (CI/CD, service mesh, observability, GitOps)

- **CI/CD:** build & scan image → push to registry → deploy. Tools: GitHub Actions, GitLab CI, Jenkins,
  Argo Workflows.
- **GitOps** — Git is the single source of truth; an agent (**Argo CD**, **Flux**) continuously syncs
  the cluster to match the repo. Declarative, auditable, easy rollback (`git revert`).
- **Service Mesh** (Istio, Linkerd) — handles service-to-service traffic: **mTLS**, retries, timeouts,
  **canary/traffic splitting**, and observability — without changing app code (sidecar proxies).
- **Observability (the 3 pillars):** **Metrics** (Prometheus + Grafana), **Logs** (Loki/ELK/Fluent
  Bit), **Traces** (OpenTelemetry + Jaeger/Tempo).
- **Operators / CRDs** — extend Kubernetes with **Custom Resources** and controllers that automate
  complex apps (e.g., a Postgres Operator that manages backups/failover). The "operator pattern" =
  encoding ops knowledge as a controller.
- **Managed K8s:** EKS (AWS), GKE (Google), AKS (Azure) — they run the control plane for you.

---

## 13. Real-World Challenges & How to Solve Them

**1. Pod stuck `Pending`.** → Insufficient resources, taints, affinity, or unbound PVC. `describe`
the pod; add nodes (cluster autoscaler) or fix requests.

**2. `CrashLoopBackOff`.** → App crashing on boot. Check `logs --previous`; usually bad config/secret,
missing dependency, or an over-eager liveness probe.

**3. `ImagePullBackOff`.** → Wrong image name/tag, private registry without `imagePullSecrets`, or rate
limits. Verify the reference and registry auth.

**4. OOMKilled pods.** → Memory limit too low or a leak. Raise limits, fix the leak, set proper
requests; watch with metrics.

**5. Service has no endpoints / 503s.** → Selector labels don't match pod labels, or readiness probe
failing so pods aren't "Ready." Check `kubectl get endpoints`.

**6. Node pressure / evictions.** → Disk/memory pressure evicts pods. Set requests/limits, add nodes,
clean up, use resource quotas.

**7. Stateful workloads.** → Use **StatefulSets + PVCs**, anti-affinity to spread across zones, and an
**Operator** for DB lifecycle (backups, failover). Don't treat databases like stateless pods.

**8. Zero-downtime deploys.** → Readiness probes + rolling update + `PodDisruptionBudget` (limit how
many pods go down during maintenance) + graceful shutdown (`preStop` hook, handle SIGTERM).

**9. Secret sprawl / leaks.** → External secrets manager, encryption at rest, RBAC, never in images.

**10. Cost & resource waste.** → Right-size requests/limits (VPA), cluster autoscaler, scale-to-zero
(KEDA), bin-packing, spot nodes for batch.

**11. Multi-tenancy / blast radius.** → Namespaces + ResourceQuotas + LimitRanges + NetworkPolicies +
RBAC per team.

**12. Debugging networking.** → `kubectl exec` + curl between pods, check Services/Endpoints/DNS
(CoreDNS), NetworkPolicies, and the CNI.

---

---

## 14. Interview Q&A

**Q: What is Kubernetes and what problem does it solve?**
> A container orchestrator that automates deployment, scaling, networking, storage, and self-healing
> across many machines. You declare desired state; controllers reconcile actual state to match.

**Q: Explain the control plane components.**
> API Server (front door), etcd (state store), Scheduler (places pods), Controller Manager
> (reconciliation loops). Nodes run kubelet, kube-proxy, and a container runtime.

**Q: Pod vs Deployment vs Service?**
> Pod = smallest unit (one+ containers sharing network/storage, ephemeral). Deployment = manages
> replica sets of stateless pods with rolling updates/rollbacks. Service = stable IP/DNS that
> load-balances to pods.

**Q: Deployment vs StatefulSet?**
> Deployment = interchangeable stateless pods. StatefulSet = stable identity, stable per-pod storage,
> and ordered operations — for databases and clustered systems.

**Q: ClusterIP vs NodePort vs LoadBalancer vs Ingress?**
> ClusterIP = internal only. NodePort = a port on every node. LoadBalancer = a cloud LB per service.
> Ingress = one entry point doing L7 host/path HTTP routing + TLS for many services.

**Q: Liveness vs Readiness probe?**
> Liveness failing restarts the container; readiness failing removes it from Service endpoints (no
> traffic) without restarting. Use a startup probe for slow boots.

**Q: How does a rolling update achieve zero downtime?**
> New pods are created and must pass readiness before old pods are terminated, governed by maxSurge/
> maxUnavailable. Add PodDisruptionBudgets and graceful shutdown. Rollback with `rollout undo`.

**Q: Requests vs limits?**
> Requests are guaranteed (used for scheduling); limits are hard caps (CPU throttled, memory →
> OOMKilled). Set both to avoid noisy neighbors and unpredictable scheduling.

**Q: How does autoscaling work?**
> HPA scales pod replicas on metrics; Cluster Autoscaler adds/removes nodes; VPA right-sizes requests;
> KEDA scales on events/queues (and to zero).

**Q: ConfigMap vs Secret — and are Secrets secure?**
> ConfigMap for non-sensitive config; Secret for sensitive data. Secrets are only base64-encoded by
> default — secure them with etcd encryption at rest, RBAC, and external managers.

**Q: PV vs PVC vs StorageClass?**
> PV = the actual storage resource; PVC = a pod's request that binds to a PV; StorageClass = dynamic
> provisioner that creates PVs on demand.

**Q: How do you debug a Pending / CrashLooping pod?**
> `kubectl describe pod` (events/scheduler reason) and `kubectl logs --previous`. Pending = resources/
> taints/affinity/PVC. CrashLoop = bad config/secret/dependency or aggressive liveness probe.

**Q: What is GitOps?**
> Git as the single source of truth; Argo CD/Flux continuously sync the cluster to the repo —
> declarative, auditable, easy rollback via git revert.

**Q: What's a service mesh for?**
> Service-to-service concerns without app changes: mTLS, retries/timeouts, traffic splitting (canary),
> and observability, via sidecar proxies (Istio/Linkerd).

---

---

## 15. Cheat Sheet

**kubectl:**
```bash
kubectl get pods/deploy/svc/ingress -A      kubectl describe pod <p>
kubectl logs <p> [-f] [--previous] [-c ctr] kubectl exec -it <p> -- sh
kubectl apply -f file.yaml                  kubectl delete -f file.yaml
kubectl rollout status/undo deploy/<d>      kubectl scale deploy/<d> --replicas=5
kubectl get endpoints <svc>                 kubectl top pods/nodes
kubectl port-forward svc/<s> 8080:80        kubectl config get-contexts
```

**Concept recap:**
- **Container** = isolated process sharing the host kernel (namespaces + cgroups).
- **Image = blueprint (layers); container = running instance.** Multi-stage builds for small/secure.
- **K8s = declarative orchestration**: declare desired state → controllers reconcile.
- **Control plane:** API Server, etcd, Scheduler, Controller Manager. **Nodes:** kubelet, kube-proxy,
  runtime.
- **Pod → Deployment (stateless) / StatefulSet (stateful) → Service → Ingress.**
- **Probes:** liveness (restart), readiness (traffic), startup (slow boot).
- **Requests/limits** matter; **HPA/Cluster Autoscaler** scale; **PVC/PV/StorageClass** for storage.
- **Security:** RBAC, securityContext (non-root), NetworkPolicy, encrypted secrets, scanned images.
- **Helm** packages; **Argo CD/Flux** do GitOps; **service mesh** does mTLS/traffic/observability.
- **Common errors:** Pending (resources), CrashLoopBackOff (app/config), ImagePullBackOff (image/auth),
  OOMKilled (memory).

---

*End of handbook. The signal: Kubernetes is a **declarative control loop** — you describe desired
state and controllers reconcile it. Know the **Pod → Deployment/StatefulSet → Service → Ingress**
chain, **probes (liveness restarts, readiness gates traffic)**, requests/limits and autoscaling, and
how to read the common failures (Pending, CrashLoopBackOff, ImagePullBackOff, OOMKilled).*
