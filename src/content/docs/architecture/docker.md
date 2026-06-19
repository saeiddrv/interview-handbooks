---
title: "Docker — Interview Handbook"
description: "Containers from the ground up: how Docker actually works, images & layers, the Dockerfile, building small secure images, networking, volumes, and Compose."
sidebar:
  label: "Docker"
---

> Containers from the ground up: how Docker actually works, images & layers, the Dockerfile,
> building small secure images, networking, volumes, and Compose.

---

## 1. The Big Picture — Why Containers Exist

**The problem:** "It works on my machine." Software depends on a specific OS, libraries, and config.
Move it to another machine and it breaks.

**The solution — containers:** package the app **with everything it needs** (code, runtime, libraries,
system tools) into one portable unit that runs **identically anywhere** — your laptop, a CI server, or
production.

> **Senior framing:** "A container is a lightweight, isolated process that *thinks* it has its own
> OS, but actually shares the host kernel. Docker made containers easy; Kubernetes runs them at scale."

**Containers give you:**
- **Consistency** — same artifact everywhere (no env drift).
- **Isolation** — apps don't interfere with each other.
- **Density & speed** — start in milliseconds, far lighter than VMs.
- **Portability** — the foundation of microservices and cloud-native.

---

## 2. Containers vs Virtual Machines

The #1 conceptual question. Both isolate workloads, but at different layers:

```
   VIRTUAL MACHINES                         CONTAINERS
┌───────┬───────┬───────┐            ┌───────┬───────┬───────┐
│ App A │ App B │ App C │            │ App A │ App B │ App C │
├───────┼───────┼───────┤            ├───────┴───────┴───────┤
│GuestOS│GuestOS│GuestOS│  ← heavy   │   Container Engine    │
├───────┴───────┴───────┤            ├───────────────────────┤
│      Hypervisor       │            │     Host OS (kernel)  │ ← shared!
├───────────────────────┤            ├───────────────────────┤
│      Host OS          │            │      Hardware         │
└───────────────────────┘            └───────────────────────┘
```

| | Virtual Machine | Container |
|---|---|---|
| Isolates at | Hardware (full guest OS each) | OS process (shares host kernel) |
| Size | GBs | MBs |
| Startup | Minutes | **Milliseconds** |
| Overhead | High | Low |
| Isolation | Stronger (separate kernel) | Lighter (shared kernel) |
| Use | Run different OSes, strong isolation | Microservices, dense packing, CI/CD |

> **"Are containers more or less secure than VMs?"** Less isolated — they share the host kernel, so a
> kernel exploit can escape. VMs have a stronger boundary. You harden containers with namespaces,
> cgroups, seccomp, dropped capabilities, and non-root users.

**Under the hood, containers are just Linux features:**
- **Namespaces** — isolate what a process *sees* (PIDs, network, mounts, users, hostname).
- **cgroups (control groups)** — limit what a process *uses* (CPU, memory, I/O).
- **Union filesystems** (overlayfs) — stack image layers efficiently.

---

## 3. Docker Architecture (how it actually works)

Docker uses a **client–server** model:

```
docker CLI ──REST API──▶ dockerd (daemon) ──▶ containerd ──▶ runc ──▶ container (process)
                              │
                              ├─ builds images
                              ├─ manages containers, networks, volumes
                              └─ pulls/pushes to registries
```

- **Docker client (`docker`)** — the CLI you type into; sends commands to the daemon.
- **Docker daemon (`dockerd`)** — does the real work: builds, runs, manages.
- **containerd** — the high-level container runtime (manages lifecycle); now a CNCF standard.
- **runc** — the low-level runtime that actually creates the container via Linux namespaces/cgroups.
- **Registry** — stores images (Docker Hub, ECR, GCR, etc.).

> **Key terms:** an **image** is the read-only blueprint (a class); a **container** is a running
> instance of an image (an object). One image → many containers.

---

## 4. Images, Layers & the Dockerfile

### Layers — the key mental model
A Docker image is built in **layers**, each layer a set of filesystem changes. Layers are **cached and
shared** between images, which is why builds and pulls are fast.

```
┌─────────────────────────────┐  ← your app code        (changes often)
├─────────────────────────────┤  ← npm install deps     (changes sometimes)
├─────────────────────────────┤  ← COPY package.json
├─────────────────────────────┤  ← base image: node:20  (rarely changes)
└─────────────────────────────┘
Each Dockerfile instruction = one layer. Unchanged layers are reused from cache.
```

> **Layer-caching trick (asked constantly):** put the things that change *least* first. Copy
> `package.json` and install dependencies **before** copying your source code — so editing code doesn't
> bust the dependency-install cache.

### A real Dockerfile
```dockerfile
FROM node:20-alpine               # base image (small)
WORKDIR /app                      # set working dir
COPY package*.json ./             # copy manifests FIRST (cache deps)
RUN npm ci --omit=dev             # install deps (cached unless manifests change)
COPY . .                          # then copy source
EXPOSE 3000                       # document the port
USER node                         # run as non-root (security!)
CMD ["node", "server.js"]         # default command
```

### Key instructions
| Instruction | Purpose |
|---|---|
| `FROM` | Base image to start from |
| `WORKDIR` | Set/`cd` into a directory |
| `COPY` / `ADD` | Copy files in (`ADD` also untars/URLs — prefer `COPY`) |
| `RUN` | Execute a command at **build** time (creates a layer) |
| `CMD` | Default command at **run** time (one allowed; overridable) |
| `ENTRYPOINT` | The fixed executable; `CMD` becomes its args |
| `ENV` | Environment variables |
| `EXPOSE` | Document a port (doesn't publish it) |
| `ARG` | Build-time variable |
| `USER` | Which user to run as |
| `HEALTHCHECK` | How Docker tests container health |
| `VOLUME` | Declare a mount point for persistent data |

> **`CMD` vs `ENTRYPOINT`:** `ENTRYPOINT` is the program that always runs; `CMD` provides default
> arguments you can override. Common pattern: `ENTRYPOINT ["python","app.py"]` + `CMD ["--port","80"]`.
>
> **`RUN` vs `CMD`:** `RUN` executes during **build** (bakes into the image); `CMD` runs when the
> container **starts**.

---

## 5. Building Good Images (multi-stage, slimming, caching)

### Multi-stage builds — the #1 best practice
Build in a heavy image, then copy only the result into a tiny final image. Keeps compilers/build tools
**out** of production.
```dockerfile
# Stage 1: build
FROM node:20 AS build
WORKDIR /app
COPY . .
RUN npm ci && npm run build

# Stage 2: tiny runtime (only the built output)
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
```
> "Multi-stage builds shrink images from ~1 GB to tens of MB and cut attack surface by leaving build
> tools behind."

### Slimming tips
- Use small bases: `alpine`, `slim`, or **distroless** (no shell/package manager).
- Combine `RUN` steps and clean caches in the **same layer** (`apt-get ... && rm -rf /var/lib/apt/lists/*`).
- Use a **`.dockerignore`** to keep `node_modules`, `.git`, secrets out of the build context.
- Pin versions (`node:20.11`) for reproducibility; avoid `latest` in production.
- Run as **non-root** (`USER`), add a `HEALTHCHECK`.

> **Trap — secrets in images:** never `COPY` secrets or bake them with `ENV` — they persist in
> layers and are recoverable. Use build secrets / runtime env / a secrets manager.

---

## 6. Running Containers (lifecycle & key commands)

**Lifecycle:** `created → running → paused → stopped → removed`.

```bash
docker build -t myapp:1.0 .            # build an image
docker run -d -p 8080:3000 --name web myapp:1.0   # run detached, map host:container port
docker ps             / docker ps -a   # list running / all containers
docker logs -f web                     # stream logs
docker exec -it web sh                 # shell into a running container
docker stop web / docker start web     # stop / start
docker rm web        / docker rmi img  # remove container / image
docker stats                           # live resource usage
docker inspect web                     # full JSON details
docker system prune -a                 # reclaim space (careful!)
```

Key `run` flags: `-d` detached, `-p host:container` publish port, `-e KEY=val` env, `-v vol:/path`
mount, `--rm` auto-remove on exit, `--restart unless-stopped`, `--memory`/`--cpus` limits,
`--network`.

> **"Container exits immediately — why?"** A container lives only as long as its main (PID 1)
> process. If `CMD` finishes or there's no long-running foreground process, it exits. Run the app in the
> foreground, not backgrounded.

---

## 7. Docker Networking

Docker creates virtual networks so containers can talk to each other and the outside world.

| Driver | What it does | Use |
|---|---|---|
| **bridge** (default) | Private internal network on the host; containers talk via IP/name | Single-host multi-container |
| **host** | Container shares the host's network stack (no isolation) | Max performance, no port mapping |
| **none** | No networking | Fully isolated |
| **overlay** | Network spanning **multiple hosts** | Swarm / multi-host clusters |
| **macvlan** | Container gets its own MAC/IP on the physical LAN | Legacy apps needing real IPs |

- **Port publishing:** `-p 8080:3000` maps host port 8080 → container port 3000.
- **DNS by name:** on a user-defined bridge network, containers reach each other by **container name**
  (`http://api:3000`) — automatic service discovery.
- **EXPOSE vs -p:** `EXPOSE` only documents; `-p` actually publishes to the host.

> "Create a **user-defined bridge network** so containers resolve each other by name — the default
> bridge doesn't give you DNS-based discovery."

---

## 8. Docker Storage & Volumes

Containers are **ephemeral** — when removed, their writable layer is gone. For data that must survive,
use volumes.

| Type | Where it lives | Use |
|---|---|---|
| **Volume** | Managed by Docker (`/var/lib/docker/volumes`) | Databases, persistent app data (preferred) |
| **Bind mount** | A specific host path you choose | Local dev (mount your source code live) |
| **tmpfs** | Host RAM (not disk) | Sensitive/temporary data |

```bash
docker volume create pgdata
docker run -v pgdata:/var/lib/postgresql/data postgres     # named volume
docker run -v $(pwd):/app node:20                          # bind mount (dev)
```

> **"How do you persist a database in Docker?"** Mount a **named volume** at the DB's data directory
> so data outlives the container. Bind mounts are for dev; volumes are for real persistence and are
> portable/backup-friendly.

---

## 9. Docker Compose (multi-container apps)

Compose defines a **multi-container app in one YAML file** and runs it with one command. Perfect for
local dev and small stacks.

```yaml
services:
  web:
    build: .
    ports: ["8080:3000"]
    environment:
      - DATABASE_URL=postgres://db:5432/app
    depends_on: [db]
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: secret
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```
```bash
docker compose up -d        # start everything
docker compose logs -f      # tail logs
docker compose down         # stop & remove (add -v to drop volumes)
```
- Services reach each other by name (`db`, `web`).
- `depends_on` controls start order (not readiness — use healthchecks for that).

> "Compose is great for **local/dev** and single-host. For production across many machines you need
> an orchestrator — Kubernetes."

---

## 10. Container Registries

A registry stores and distributes images. An image name is `registry/repository:tag`
(`docker.io/library/nginx:1.27`).

- **Public/Private:** Docker Hub, GitHub Container Registry; cloud: **ECR** (AWS), **GCR/Artifact
  Registry** (GCP), **ACR** (Azure); self-hosted: **Harbor**.
- **Tags vs digests:** tags are mutable (`:latest` can change!); a **digest** (`@sha256:...`) is
  immutable — pin digests for reproducible/secure deploys.
- **Scan images** for vulnerabilities (Trivy, Snyk) and sign them (cosign) in CI.

---

---

## 11. Interview Q&A

**Q: Container vs VM?**
> A VM virtualizes hardware and runs a full guest OS (heavy, GB, minutes to boot). A container
> virtualizes the OS and shares the host kernel (light, MB, milliseconds). Containers pack denser;
> VMs isolate stronger.

**Q: What's an image vs a container?**
> An image is the read-only blueprint (layers); a container is a running instance of it. One image →
> many containers.

**Q: Why are Docker layers important?**
> They're cached and shared, making builds/pulls fast. Order Dockerfile steps least-to-most-changing
> (install deps before copying source) to maximize cache hits.

**Q: CMD vs ENTRYPOINT?**
> ENTRYPOINT is the fixed executable; CMD provides default args you can override. Use ENTRYPOINT for
> the program, CMD for its default arguments.

**Q: How do you make a small, secure image?**
> Multi-stage builds, a minimal base (alpine/distroless), `.dockerignore`, combined RUN layers, pinned
> versions, non-root USER, no secrets baked in, and image scanning.

**Q: How do you persist data in Docker?**
> Named volumes mounted at the data path; they outlive containers. Bind mounts for dev, volumes for
> real persistence.

---

## 12. Cheat Sheet

**Docker:**
```bash
docker build -t app:1.0 .        docker run -d -p 8080:3000 app:1.0
docker ps -a                     docker logs -f <c>      docker exec -it <c> sh
docker stop/start/rm <c>         docker rmi <img>        docker system prune -a
docker compose up -d             docker compose down -v
docker volume ls                 docker network ls
```

---

*End of handbook. The signal: containers share the host kernel (cheap, fast) but isolate processes;
**layers and a tight `.dockerfile`/build-cache** keep images small; **multi-stage builds, non-root
users, and pinned base images** keep them secure — and Compose wires it together for local dev.*
