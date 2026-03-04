# 🐧 LinuxSandbox

> Real Linux distros. Real terminal. Right in your browser.

Spin up isolated Docker containers for 50+ Linux distributions directly from a web UI. Every command runs for real inside a sandboxed container — no simulation, no fakery.

---

## ✨ Features

- **50+ Linux distributions** with version selection
- **Real Docker containers** — actual shell execution
- **xterm.js terminal** — full-featured terminal emulator in browser
- **WebSocket streaming** — real-time bidirectional I/O
- **Sandbox security** — network disabled, memory/CPU capped, capabilities dropped
- **Auto cleanup** — 10-minute session timeout, containers auto-removed
- **Live search & filter** by family, release type, name

---

## 🏗️ Architecture

```
Browser (xterm.js)
    │  WebSocket (bidirectional)
    ▼
Node.js Server (Express + ws)
    │  Dockerode (Docker API)
    ▼
Docker Daemon
    │
    ▼
Sandboxed Container (ubuntu, alpine, arch, etc.)
```

---

## 🚀 Quick Start

### Prerequisites
- **Docker** installed and running
- **Node.js 18+**

### Option A — Run with Docker Compose (recommended)

```bash
git clone <repo>
cd linuxsandbox
docker-compose up --build
```

Open http://localhost:3000

### Option B — Run locally

```bash
# Install dependencies
cd server
npm install

# Start server
npm start
```

Open http://localhost:3000

---

## ⚙️ Configuration

Edit `server/.env` or set environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP/WebSocket server port |
| `MAX_SESSIONS` | `20` | Max concurrent sandbox sessions |
| `SESSION_TIMEOUT_MS` | `600000` | Session lifetime (10 min) |
| `MEMORY_LIMIT` | `128m` | Memory per container |
| `CPU_QUOTA` | `50000` | CPU quota (50% of 1 core) |

---

## 🔒 Security

Each container is locked down:

| Restriction | Value |
|---|---|
| Network | **Disabled** (`NetworkMode: none`) |
| Memory | 128MB + 256MB swap |
| CPU | 50% of 1 core |
| Capabilities | ALL dropped, only `CHOWN SETUID SETGID DAC_OVERRIDE` added back |
| PID limit | 50 processes max |
| File limits | 1024 open files max |
| New privileges | Blocked (`no-new-privileges:true`) |
| Auto-remove | Container deleted on exit |
| Session timeout | 10 minutes |

### ⚠️ Production Hardening

For public deployment, also consider:

1. **Run behind nginx** with rate limiting:
```nginx
limit_req_zone $binary_remote_addr zone=sandbox:10m rate=2r/m;
location /api/launch { limit_req zone=sandbox burst=3; }
```

2. **Use rootless Docker** to prevent privilege escalation

3. **Add authentication** — protect `/api/sessions` admin endpoint

4. **Use a dedicated Docker network** with no internet egress

5. **Set up container image allow-list** — only pull pre-approved images

6. **Monitor disk usage** — containers write to overlay fs

---

## 📁 Project Structure

```
linuxsandbox/
├── server/
│   ├── index.js          # Main server (Express + WebSocket + Dockerode)
│   ├── package.json
│   └── .env              # Configuration
├── client/
│   └── public/
│       └── index.html    # Frontend (xterm.js + UI)
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## 🔌 WebSocket Protocol

The client and server communicate via JSON messages over WebSocket:

### Client → Server

| Type | Payload | Description |
|---|---|---|
| `launch` | `{ distro, version }` | Start a new container session |
| `input` | `{ data, sessionId }` | Send keystrokes to container |
| `resize` | `{ rows, cols, sessionId }` | Terminal resize event |
| `kill` | `{ sessionId }` | Kill session |

### Server → Client

| Type | Payload | Description |
|---|---|---|
| `status` | `{ message }` | Boot status update |
| `pull_progress` | `{ message }` | Docker pull progress |
| `ready` | `{ sessionId, image, shell }` | Container is ready |
| `output` | `{ data }` | Terminal output bytes |
| `timeout` | `{ message }` | Session expired |
| `exit` | `{ message }` | Container exited |
| `error` | `{ message }` | Error occurred |

---

## 🌐 Supported Distros

| Family | Distributions |
|---|---|
| Debian-based | Ubuntu, Debian, Linux Mint, Pop!_OS, Kali, Parrot, elementary, Zorin, Lubuntu, Kubuntu, Xubuntu, Raspberry Pi OS, MX Linux, Deepin |
| Arch-based | Arch Linux, Manjaro, EndeavourOS, Garuda, BlackArch, Artix |
| RPM-based | Fedora, RHEL (UBI), CentOS Stream, Rocky Linux, AlmaLinux, openSUSE Leap, openSUSE Tumbleweed, Mageia, Oracle Linux |
| Independent | Gentoo, Slackware, Void Linux, NixOS, Alpine, Tiny Core, Puppy, Haiku, Clear Linux, Solus, GNU Guix, Tails, Whonix |
| BSD | FreeBSD, OpenBSD, NetBSD, GhostBSD, DragonFly BSD, TrueNAS CORE |

> **Note:** Some distros (like Haiku, TrueNAS, BSDs) run as Ubuntu/Debian containers since they don't have official Docker images. The terminal experience still teaches package managers and system concepts.

---

## 🛠️ Adding More Distros

1. Add entry to `DISTROS` array in `client/public/index.html`
2. Add image resolver to `DISTRO_IMAGES` in `server/index.js`
3. Done!

---

## 📄 License

MIT
