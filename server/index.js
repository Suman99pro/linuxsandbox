require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const Docker = require('dockerode');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CONFIG = {
  SESSION_TIMEOUT_MS: parseInt(process.env.SESSION_TIMEOUT_MS) || 10 * 60 * 1000,
  MAX_SESSIONS:       parseInt(process.env.MAX_SESSIONS)       || 20,
  MEMORY_LIMIT:       process.env.MEMORY_LIMIT                 || '128m',
  CPU_QUOTA:          parseInt(process.env.CPU_QUOTA)          || 50000,
  PORT:               parseInt(process.env.PORT)               || 3000,
};

const sessions = new Map();

// ── DISTRO → IMAGE MAP ──
// fallback = true means this distro has no native Docker image and runs on a substitute
const DISTRO_MAP = {
  ubuntu:              (v) => ({ image: `ubuntu:${v}`,                      fallback: false }),
  debian:              (v) => ({ image: `debian:${v}`,                      fallback: false }),
  fedora:              (v) => ({ image: `fedora:${v}`,                      fallback: false }),
  alpine:              (v) => ({ image: `alpine:${v}`,                      fallback: false }),
  centos:              (v) => ({ image: `quay.io/centos/centos:stream${v.includes('10')?'10':v.includes('9')?'9':'8'}`, fallback: false }),
  rocky:               (v) => ({ image: `rockylinux:${v}`,                  fallback: false }),
  alma:                (v) => ({ image: `almalinux:${v}`,                   fallback: false }),
  arch:                ()  => ({ image: `archlinux:latest`,                 fallback: false }),
  manjaro:             ()  => ({ image: `manjarolinux/base:latest`,         fallback: false }),
  endeavour:           ()  => ({ image: `archlinux:latest`,                 fallback: false, note: 'Running on Arch Linux base (EndeavourOS has no official image)' }),
  garuda:              ()  => ({ image: `archlinux:latest`,                 fallback: false, note: 'Running on Arch Linux base (Garuda has no official image)' }),
  artix:               ()  => ({ image: `artixlinux/base:latest`,           fallback: false }),
  blackarch:           ()  => ({ image: `blackarchlinux/blackarch:latest`,  fallback: false }),
  kali:                ()  => ({ image: `kalilinux/kali-rolling:latest`,    fallback: false }),
  parrot:              ()  => ({ image: `parrotsec/core:latest`,            fallback: false }),
  opensuse_leap:       (v) => ({ image: `opensuse/leap:${v}`,              fallback: false }),
  opensuse_tumbleweed: ()  => ({ image: `opensuse/tumbleweed:latest`,      fallback: false }),
  gentoo:              ()  => ({ image: `gentoo/stage3:latest`,             fallback: false }),
  void:                ()  => ({ image: `voidlinux/voidlinux:latest`,       fallback: false }),
  nixos:               ()  => ({ image: `nixos/nix:latest`,                 fallback: false }),
  clear:               ()  => ({ image: `clearlinux/base:latest`,           fallback: false }),
  oracle:              (v) => ({ image: `oraclelinux:${v}`,                 fallback: false }),
  mageia:              (v) => ({ image: `mageia:${v}`,                      fallback: false }),
  slackware:           ()  => ({ image: `vbatts/slackware:current`,         fallback: false }),
  rhel:                ()  => ({ image: `redhat/ubi9:latest`,               fallback: false, note: 'Running Red Hat UBI9 (official RHEL container base)' }),
  // Distros with NO native Docker image — runs a close substitute
  mint:       ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'Linux Mint',      note: 'Linux Mint has no Docker image. Running Ubuntu 22.04 (same base).' }),
  pop:        ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'Pop!_OS',         note: "Pop!_OS has no Docker image. Running Ubuntu 22.04 (same base)." }),
  elementary: ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'elementary OS',   note: 'elementary OS has no Docker image. Running Ubuntu 22.04 (same base).' }),
  zorin:      ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'Zorin OS',        note: 'Zorin OS has no Docker image. Running Ubuntu 22.04 (same base).' }),
  lubuntu:    (v) => ({ image: `ubuntu:${v}`,        fallback: true,  fallbackFor: 'Lubuntu',         note: 'Lubuntu has no Docker image. Running Ubuntu (same base, no desktop).' }),
  kubuntu:    (v) => ({ image: `ubuntu:${v}`,        fallback: true,  fallbackFor: 'Kubuntu',         note: 'Kubuntu has no Docker image. Running Ubuntu (same base, no desktop).' }),
  xubuntu:    (v) => ({ image: `ubuntu:${v}`,        fallback: true,  fallbackFor: 'Xubuntu',         note: 'Xubuntu has no Docker image. Running Ubuntu (same base, no desktop).' }),
  raspbian:   ()  => ({ image: `debian:bookworm-slim`,fallback: true, fallbackFor: 'Raspberry Pi OS', note: 'Raspberry Pi OS requires ARM hardware. Running Debian Bookworm instead.' }),
  mx:         ()  => ({ image: `debian:bookworm`,    fallback: true,  fallbackFor: 'MX Linux',        note: 'MX Linux has no Docker image. Running Debian Bookworm (same base).' }),
  deepin:     ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'Deepin',          note: 'Deepin has no official Docker image. Running Ubuntu 22.04.' }),
  tails:      ()  => ({ image: `debian:bookworm`,    fallback: true,  fallbackFor: 'Tails',           note: 'Tails is a live OS and cannot run in Docker. Running Debian Bookworm.' }),
  whonix:     ()  => ({ image: `debian:bookworm`,    fallback: true,  fallbackFor: 'Whonix',          note: 'Whonix requires two VMs and cannot run in Docker. Running Debian Bookworm.' }),
  solus:      ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'Solus',           note: 'Solus has no Docker image. Running Ubuntu 22.04.' }),
  haiku:      ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'Haiku',           note: 'Haiku is non-Linux and cannot run in Docker. Running Ubuntu 22.04.' }),
  puppy:      ()  => ({ image: `debian:bullseye-slim`,fallback: true, fallbackFor: 'Puppy Linux',     note: 'Puppy Linux has no Docker image. Running Debian Bullseye.' }),
  tinycore:   ()  => ({ image: `alpine:latest`,      fallback: true,  fallbackFor: 'Tiny Core',       note: 'Tiny Core has no Docker image. Running Alpine Linux (similarly minimal).' }),
  guix:       ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'GNU Guix',        note: 'GNU Guix has no standard Docker image. Running Ubuntu 22.04.' }),
  // BSD — cannot run Linux containers at all
  freebsd:    ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'FreeBSD',         note: 'FreeBSD requires its own kernel and CANNOT run inside a Linux Docker container. Running Ubuntu 22.04 so you can explore the shell environment.' }),
  openbsd:    ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'OpenBSD',         note: 'OpenBSD requires its own kernel and CANNOT run inside a Linux Docker container. Running Ubuntu 22.04.' }),
  netbsd:     ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'NetBSD',          note: 'NetBSD requires its own kernel and CANNOT run inside a Linux Docker container. Running Ubuntu 22.04.' }),
  ghostbsd:   ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'GhostBSD',        note: 'GhostBSD (FreeBSD-based) requires its own kernel. Running Ubuntu 22.04.' }),
  dragonfly:  ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'DragonFly BSD',   note: 'DragonFly BSD requires its own kernel. Running Ubuntu 22.04.' }),
  truenas:    ()  => ({ image: `ubuntu:22.04`,       fallback: true,  fallbackFor: 'TrueNAS CORE',    note: 'TrueNAS CORE is FreeBSD-based and cannot run in Docker. Running Ubuntu 22.04.' }),
};

function resolveImage(id, version) {
  const v = version.toLowerCase();
  const key = id.replace(/-/g, '_');
  const resolver = DISTRO_MAP[key] || DISTRO_MAP[id];
  if (resolver) return resolver(v);
  return { image: `${id}:latest`, fallback: false };
}

function getShell(image) {
  if (image.includes('alpine') || image.includes('tinycore')) return '/bin/sh';
  return '/bin/bash';
}

function parseMemory(str) {
  if (typeof str === 'number') return str;
  const units = { k: 1024, m: 1024**2, g: 1024**3 };
  const m = str.toLowerCase().match(/^(\d+)([kmg]?)$/);
  return m ? parseInt(m[1]) * (units[m[2]] || 1) : 128 * 1024 * 1024;
}

async function cleanupSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  try {
    if (session.stream) session.stream.destroy();
    if (session.container) {
      await session.container.stop({ t: 2 }).catch(() => {});
      // force:true also removes the container even if stop fails
      await session.container.remove({ force: true }).catch(e => console.log('[rm container]', e.message));
    }
    if (session.volumeName) {
      await docker.getVolume(session.volumeName).remove().catch(e => console.log('[vol]', e.message));
    }
  } catch (err) {
    console.error('[cleanup]', err.message);
  }
  sessions.delete(sessionId);
  console.log(`[session] Removed ${sessionId}. Active: ${sessions.size}`);
}

// ── REST ──
app.get('/api/health', async (req, res) => {
  try { await docker.ping(); res.json({ status: 'ok', docker: true, sessions: sessions.size }); }
  catch { res.status(500).json({ status: 'error', docker: false }); }
});

app.get('/api/sessions', (req, res) => {
  res.json({
    sessions: [...sessions.entries()].map(([id, s]) => ({ id, distro: s.distro, version: s.version, created: s.created })),
    count: sessions.size,
    max: CONFIG.MAX_SESSIONS,
  });
});

// ── IMAGE MANAGEMENT ──
app.get('/api/images', async (req, res) => {
  try {
    const images = await docker.listImages({ all: false });
    res.json({ images: images.map(img => ({
      id:      img.Id.replace('sha256:', '').slice(0, 12),
      fullId:  img.Id,
      tags:    img.RepoTags || ['<none>:<none>'],
      size:    img.Size,
      created: img.Created,
      inUse:   [...sessions.values()].some(s => img.RepoTags?.includes(s.image)),
    }))});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/images/:id', async (req, res) => {
  try {
    const imageId = decodeURIComponent(req.params.id);
    // Find and remove any stopped containers using this image before removing the image
    const containers = await docker.listContainers({ all: true });
    for (const c of containers) {
      if (c.ImageID === imageId || c.Image === imageId || (c.ImageID && c.ImageID.startsWith(imageId))) {
        if (c.State !== 'running') {
          await docker.getContainer(c.Id).remove({ force: true }).catch(() => {});
        }
      }
    }
    await docker.getImage(imageId).remove({ force: false });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/images', async (req, res) => {
  try {
    const activeImages = new Set([...sessions.values()].map(s => s.image));
    const images = await docker.listImages({ all: false });
    const allContainers = await docker.listContainers({ all: true });
    const removed = [], errors = [];
    let freedBytes = 0;
    for (const img of images) {
      const tag = (img.RepoTags || [])[0] || '';
      if (activeImages.has(tag)) continue;
      try {
        // Remove any stopped containers referencing this image first
        for (const c of allContainers) {
          if ((c.ImageID === img.Id || c.Image === tag) && c.State !== 'running') {
            await docker.getContainer(c.Id).remove({ force: true }).catch(() => {});
          }
        }
        await docker.getImage(img.Id).remove({ force: false });
        removed.push(tag || img.Id.slice(0, 12));
        freedBytes += img.Size;
      } catch (e) { errors.push({ tag, error: e.message }); }
    }
    res.json({ ok: true, removed, errors, freedBytes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── WEBSOCKET ──
wss.on('connection', (ws) => {
  let sessionId = null;

  ws.on('message', async (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }

    // ── LAUNCH ──
    if (msg.type === 'launch') {
      if (sessions.size >= CONFIG.MAX_SESSIONS)
        return ws.send(JSON.stringify({ type: 'error', message: 'Server at capacity.' }));

      sessionId = uuidv4();
      const { distro, version } = msg;
      const resolved = resolveImage(distro, version);
      const { image, fallback, fallbackFor, note } = resolved;
      const shell = getShell(image);
      const volumeName = `sandbox-${sessionId}`;

      console.log(`[launch] ${sessionId} — ${image}${fallback ? ' (fallback)' : ''}`);

      // Tell frontend what image we're actually using and if it's a fallback
      ws.send(JSON.stringify({
        type: 'launch_info',
        image,
        fallback,
        fallbackFor,
        note: note || null,
      }));

      ws.send(JSON.stringify({ type: 'status', message: `Pulling ${image}...`, phase: 'pull' }));

      try {
        // ── PULL with detailed per-layer progress ──
        await new Promise((resolve, reject) => {
          docker.pull(image, (err, stream) => {
            if (err) return reject(err);

            // Track progress per layer
            const layers = {};

            docker.modem.followProgress(stream,
              (err) => err ? reject(err) : resolve(),
              (event) => {
                const { status, id, progressDetail } = event;

                if (id && progressDetail) {
                  // Layer-level progress event
                  if (!layers[id]) layers[id] = { current: 0, total: 0, status: '' };
                  layers[id].status = status;
                  if (progressDetail.current) layers[id].current = progressDetail.current;
                  if (progressDetail.total)   layers[id].total   = progressDetail.total;

                  // Aggregate across all known layers
                  const layerList = Object.values(layers);
                  const totalBytes   = layerList.reduce((a, l) => a + (l.total || 0), 0);
                  const currentBytes = layerList.reduce((a, l) => a + (l.current || 0), 0);
                  const pct = totalBytes > 0 ? Math.min(99, Math.round((currentBytes / totalBytes) * 100)) : null;

                  // Count layers by status
                  const pulling    = layerList.filter(l => l.status === 'Downloading').length;
                  const extracting = layerList.filter(l => l.status === 'Extracting').length;
                  const done       = layerList.filter(l => l.status === 'Pull complete' || l.status === 'Already exists').length;
                  const total      = layerList.length;

                  ws.send(JSON.stringify({
                    type: 'pull_progress',
                    layerId: id,
                    status,
                    pct,
                    currentBytes,
                    totalBytes,
                    layers: { pulling, extracting, done, total },
                    phase: extracting > 0 ? 'extract' : 'pull',
                  }));

                } else if (status) {
                  // Non-layer status message (e.g. "Pulling from library/ubuntu")
                  ws.send(JSON.stringify({ type: 'pull_status', message: status }));
                }
              }
            );
          });
        });

        ws.send(JSON.stringify({ type: 'status', message: 'Creating session volume...', phase: 'volume' }));
        await docker.createVolume({ Name: volumeName, Labels: { sandbox: 'true', session: sessionId } });

        ws.send(JSON.stringify({ type: 'status', message: 'Starting container...', phase: 'start' }));

        const container = await docker.createContainer({
          Image: image,
          Cmd: [shell],
          Tty: true,
          OpenStdin: true,
          StdinOnce: false,
          WorkingDir: '/root',
          Env: [
            'TERM=xterm-256color',
            'COLORTERM=truecolor',
            `DISTRO=${distro}`,
            `VERSION=${version}`,
            'HISTFILE=/workspace/.bash_history',
          ],
          HostConfig: {
            Memory:      parseMemory(CONFIG.MEMORY_LIMIT),
            MemorySwap:  parseMemory(CONFIG.MEMORY_LIMIT) * 2,
            CpuQuota:    CONFIG.CPU_QUOTA,
            CpuPeriod:   100000,
            NetworkMode: 'none',
            AutoRemove:  false,
            CapDrop:     ['ALL'],
            CapAdd:      ['CHOWN', 'SETUID', 'SETGID', 'DAC_OVERRIDE'],
            SecurityOpt: ['no-new-privileges:true'],
            PidsLimit:   100,
            Ulimits: [
              { Name: 'nofile', Soft: 1024, Hard: 1024 },
              { Name: 'nproc',  Soft: 100,  Hard: 100 },
            ],
            Binds: [`${volumeName}:/workspace`],
          },
        });

        const stream = await container.attach({
          stream: true, stdin: true, stdout: true, stderr: true, hijack: true,
        });

        await container.start();

        stream.on('data', (chunk) => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'output', data: chunk.toString('binary') }));
        });

        stream.on('end', () => {
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ type: 'exit', message: 'Session ended.' }));
          cleanupSession(sessionId);
        });

        stream.on('error', (err) => console.error('[stream]', err.message));

        sessions.set(sessionId, {
          container, stream, ws,
          distro, version, image, volumeName,
          created: Date.now(),
        });

        ws.send(JSON.stringify({ type: 'ready', sessionId, image, shell, volumeName, fallback, note }));

      } catch (err) {
        console.error('[launch error]', err.message);
        ws.send(JSON.stringify({ type: 'error', message: err.message }));
        docker.getVolume(volumeName).remove().catch(() => {});
        sessions.delete(sessionId);
      }
    }

    if (msg.type === 'input') {
      const s = sessions.get(sessionId || msg.sessionId);
      if (s?.stream) s.stream.write(Buffer.from(msg.data, 'binary'));
    }

    if (msg.type === 'resize') {
      const s = sessions.get(sessionId || msg.sessionId);
      if (s?.container) s.container.resize({ h: msg.rows, w: msg.cols }).catch(() => {});
    }

    if (msg.type === 'kill') {
      await cleanupSession(sessionId);
      ws.send(JSON.stringify({ type: 'killed' }));
    }
  });

  ws.on('close', () => { if (sessionId) cleanupSession(sessionId); });
  ws.on('error', console.error);
});

setInterval(async () => {
  for (const [id, s] of sessions.entries())
    if (s.ws.readyState !== WebSocket.OPEN) await cleanupSession(id);
}, 30_000);

server.listen(CONFIG.PORT, () => {
  console.log(`LinuxSandbox on http://localhost:${CONFIG.PORT}`);
});

process.on('SIGTERM', async () => {
  for (const id of sessions.keys()) await cleanupSession(id);
  process.exit(0);
});
