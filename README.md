# GOST Rotating Proxy Service

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![GOST](https://img.shields.io/badge/GOST-v3-00ADD8.svg)](https://github.com/go-gost/gost)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg)](https://www.docker.com/)

**One-click Docker launch** for a rotating proxy server. Add your upstream proxies, get a single proxy URL that automatically rotates through them. View real-time logs in the built-in Web UI.

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

## Screenshots

### Dashboard
<img src="assets/gost-proxy-service_frontend.png" width="50%" />

### Configuration
<img src="assets/gost-proxy-service_config.png" width="30%" />

## Usage

1. **Open the Web UI**: Navigate to `http://localhost:31130`
2. **Add Proxies**: Click Settings → Upstream tab → Add your proxies (one per line)
3. **Connect**: Point your applications to `localhost:31131` as their proxy
4. **Monitor**: Watch the logs to see rotation and test results

### Example: Web Crawler

Instead of configuring rotation logic in your crawler, add your upstream proxies here and point your crawler to the **single** entry point (`localhost:31131`). The service handles rotation and load balancing for you.

## Ports

| Port | Purpose |
|------|---------|
| **31130** | Web UI + API |
| **31131** | Proxy entry point (use this in your apps) |
| **31132** | Internal GOST API |

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 31130 | Web UI/API port |
| `GOST_PROXY_URL` | http://127.0.0.1:31131 | Proxy endpoint |
| `GOST_API_URL` | http://127.0.0.1:31132 | GOST API endpoint |
| `GOST_BINARY_PATH` | /usr/local/bin/gost | Path to GOST binary |

### Persistence

Mount a volume to persist your proxy configuration:

```bash
-v gost_proxy_data:/app/data
```

## License

MIT
