# LinuxSandbox

Real Linux distros. Real terminal. Right in your browser.

Spin up isolated Docker containers for 50+ Linux distributions directly from a web UI. Every command runs inside a real sandboxed container — no simulation, no emulation (where a native image exists).

---

## Quick Start

The only requirement is **Docker** with the Compose plugin. No Node.js, no npm, no manual installs.

```bash
git clone <repo>
cd linuxsandbox
docker-compose up --build
```

Open **http://localhost** (port 80, served via nginx).

That's it. Everything — the Node.js runtime, npm dependencies, the frontend — is built inside the Docker image.

---

## Architecture

```
Browser (xterm.js)
    │  WebSocket  (ws://)
    ▼
nginx  →  Node.js / Express  (port 3000, internal only)
               │  Dockerode (Unix socket)
               ▼
         Docker Daemon
               │
               ▼
    Sandbox Container  (sibling container, NetworkMode: none)
    + Named Volume  (/workspace, auto-removed on kill)
```

**Why nginx in front?**
nginx handles WebSocket upgrades, long-lived proxy timeouts, static asset serving, and acts as the single public entrypoint. The Node.js server is never directly exposed to the host — only reachable on the internal `sandbox-net` Docker bridge network.

**Why NOT give sandbox containers their own IP?**
All sandbox containers run with `NetworkMode: none`. This means no network interface at all — no IP, no routes, no way to reach the host, other containers, or the internet. Assigning an IP would break isolation: the container could reach the `sandbox-net` bridge, potentially the Docker host, and other running sessions. The current approach is the safest possible configuration for a public-facing sandbox.

---

## Configuration

Edit `server/.env` or override in `docker-compose.yml`:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Internal Node.js server port |
| `MAX_SESSIONS` | `20` | Max concurrent sandbox sessions |
| `MEMORY_LIMIT` | `128m` | RAM per container |
| `CPU_QUOTA` | `50000` | CPU quota (50000 = 50% of one core) |

Sessions run until the user clicks **Kill Session** or closes the browser. There is no automatic timeout.

---

## Security Model

Each sandbox container is locked down at creation time:

| Control | Value |
|---|---|
| Network | **None** — no interface, no IP, fully air-gapped |
| Memory | 128 MB RAM + 256 MB swap |
| CPU | 50% of 1 core (`CpuQuota: 50000`) |
| Capabilities | ALL dropped; only `CHOWN SETUID SETGID DAC_OVERRIDE` added back |
| PID limit | 100 processes |
| File descriptors | 1024 max open files |
| New privileges | Blocked (`no-new-privileges:true`) |
| Container cleanup | Force-removed on kill (not just stopped) |
| Volume cleanup | Named volume deleted alongside container |

The Node.js server runs inside its own container and communicates with Docker via the Unix socket (`/var/run/docker.sock`). Sandbox containers are **sibling containers** of the app — they are not nested inside it.

---

## Image Manager

The **Image Manager** tab in the UI lets you:

- View all pulled Docker images with size and age
- Remove individual images
- Remove all unused images in one click (skips images used by active sessions)

When you remove an image, the server first removes any stopped containers that reference it, then removes the image. This avoids the common Docker error `image is being used by a stopped container`.

---

## Distro Compatibility

| Family | Native Docker Image | Distributions |
|---|---|---|
| Debian-based | ✅ Yes | Ubuntu, Debian, Kali, Parrot |
| Arch-based | ✅ Yes | Arch, Manjaro, Artix, BlackArch |
| RPM-based | ✅ Yes | Fedora, Rocky, AlmaLinux, RHEL UBI, CentOS Stream, openSUSE |
| Independent | ✅ Yes | Alpine, Gentoo, Void, NixOS, Clear Linux, Slackware |
| Desktop flavors | ⚠️ Fallback | Lubuntu, Kubuntu, Xubuntu, Mint, Pop!_OS → Ubuntu base |
| Hardware-specific | ⚠️ Fallback | Raspberry Pi OS → Debian base (requires ARM hardware) |
| BSD | ❌ Cannot run | FreeBSD, OpenBSD, NetBSD, GhostBSD, DragonFly → Ubuntu base |
| Non-Linux | ❌ Cannot run | Haiku, Tails, Whonix → Ubuntu/Debian base |

Fallback distros are marked with an **"emulated"** badge in the UI and show an explanation banner when launched.

**Why can't BSD run?** Docker containers share the host's Linux kernel. BSD operating systems (FreeBSD, OpenBSD, NetBSD) require their own kernel. There is no workaround — a BSD container would need a full VM, not a Docker container.

---

## Project Structure

```
linuxsandbox/
├── client/
│   └── public/
│       └── index.html       # Full frontend — xterm.js, UI, WebSocket client
├── server/
│   ├── index.js             # Express + WebSocket server + Dockerode
│   ├── package.json
│   └── .env                 # Runtime configuration
├── Dockerfile               # Builds the Node.js app image (no npm needed on host)
├── docker-compose.yml       # nginx + app + internal network
├── nginx.conf               # Reverse proxy with WebSocket upgrade
└── README.md
```

---

## WebSocket Protocol

| Direction | Type | Payload |
|---|---|---|
| Client → Server | `launch` | `{ distro, version }` |
| Client → Server | `input` | `{ data, sessionId }` |
| Client → Server | `resize` | `{ rows, cols, sessionId }` |
| Client → Server | `kill` | `{ sessionId }` |
| Server → Client | `launch_info` | `{ image, fallback, fallbackFor, note }` |
| Server → Client | `pull_status` | `{ message }` |
| Server → Client | `pull_progress` | `{ pct, layers, phase, currentBytes, totalBytes }` |
| Server → Client | `status` | `{ message, phase }` |
| Server → Client | `ready` | `{ sessionId, image, shell }` |
| Server → Client | `output` | `{ data }` — binary string |
| Server → Client | `exit` | `{ message }` |
| Server → Client | `error` | `{ message }` |
| Server → Client | `killed` | — |

---

## Production Deployment

### HTTPS / SSL

Replace nginx with **Caddy** for automatic Let's Encrypt:

```
linuxsandbox.example.com {
    reverse_proxy linuxsandbox:3000
}
```

Or keep nginx and provision certs with Certbot:

```bash
certbot certonly --standalone -d yourdomain.com
```

Then mount `/etc/letsencrypt` into the nginx container and add `ssl_certificate` directives.

### Firewall

Only ports 80 and 443 need to be public. Port 3000 is internal only.

```bash
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 22/tcp
ufw enable
```

### Recommended VPS

Any VPS with Docker socket access works: DigitalOcean, Hetzner, Linode, Vultr. Avoid serverless platforms (no persistent Docker daemon).

Minimum specs: 2 vCPU, 2 GB RAM, 20 GB disk (images can be large).

---

## License

MIT
