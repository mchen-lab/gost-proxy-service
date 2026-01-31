# GOST Rotating Proxy Service

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![GOST](https://img.shields.io/badge/GOST-v3-00ADD8.svg)](https://github.com/go-gost/gost)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933.svg)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)

An **all-in-one** solution that bundles the **GOST v3** (GO Simple Tunnel) proxy with a modern Web UI, providing a self-contained environment for rotating proxy server with one docker command.

Built with [@mchen-lab/app-kit](https://github.com/mchen-lab/app-kit).

## Quick Start

```bash
docker run -d \
  --name gost-proxy-service \
  -p 31130:31130 \
  -p 31131:31131 \
  -v gost_proxy_service_data:/app/data \
  ghcr.io/mchen-lab/gost-proxy-service:latest
```

Navigate to [http://localhost:31130](http://localhost:31130) to access the UI.

## Common Usage Scenario

**"I need a rotating proxy system for web crawling."**

Instead of configuring rotation logic in your crawler, add your upstream proxies here and point your crawler to the **single** entry point. The manager handles rotation and load balancing for you.

## Features

- 🌐 **Proxy Management**: Manage a list of upstream proxies (SOCKS5, HTTP, etc.)
- 🧪 **Proxy Testing**: Built-in tools to verify proxy connectivity and speed
- 📊 **Log Viewer**: Real-time logs from both the manager and the underlying GOST instance
- 🔄 **Rotation**: Automatically rotate through available proxies
- 🛠️ **REST API**: Full programmatic control over proxy configurations
- 🐳 **Dockerized**: Easy deployment with Docker and Docker Compose

## Architecture

The system consists of three ports:

| Port | Purpose |
|------|--------|
| **31130** | Web UI + Backend API |
| **31131** | GOST Proxy Server (entry point for clients) |
| **31132** | GOST Internal API (for config management) |

## Configuration

### Environment Variables

- `PORT`: Web UI/API port (Default: 31131)
- `GOST_API_URL`: GOST API endpoint (Default: http://127.0.0.1:31132)
- `GOST_PROXY_URL`: GOST proxy endpoint (Default: http://127.0.0.1:31131)
- `GOST_BINARY_PATH`: Path to GOST binary (Default: /usr/local/bin/gost)

### Persistence & Logs

By default, the service uses standardized directories for data and logs:

- **`DATA_DIR`**: Location for configuration files (defaults to `/app/data`). Stores `settings.json`.
- **`LOGS_DIR`**: Location for persistent log files (defaults to `/app/logs`). Stores `app.log`.

Mount volumes to persist these across container restarts:

```bash
-v gost_proxy_data:/app/data \
-v gost_proxy_logs:/app/logs
```

## Usage

1. **Open the Web UI**: Navigate to `http://localhost:31130`
2. **Add Proxies**: Click Settings and add your upstream proxies (one per line)
3. **Connect**: Configure your applications to use `localhost:31131` as their proxy
4. **Monitor**: Watch the logs in the UI to see traffic and rotation events

## Local Development

If you wish to run the application locally for development:

1. **Install GOST**: Download GOST v3 from [go-gost/gost](https://github.com/go-gost/gost)
2. **Verify Installation**: Ensure `gost` is in your PATH (`gost -V`)
3. **Run Development Server**:
   ```bash
   npm install
   npm run dev
   ```

## Project Structure

- `src/server`: Backend logic (Express + AppKit + GOST integration)
- `src/frontend`: Frontend React application
- `libs`: Local dependencies (e.g., `app-kit.tgz`)
- `data`: Persistent data storage
- `logs`: Application logs

## License

MIT
