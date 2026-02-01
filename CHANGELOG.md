# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed
- **Infrastructure**: Added missing `gost` binary installation to `Dockerfile`, resolving `ECONNREFUSED` errors in Dockerized environments.
- **Docker Compose**: Updated `docker-compose.yml` to use the remote GHCR image by default, avoiding unnecessary local builds.

### Changed
- **Documentation**: Renamed project to "GOST Proxy Wrapper" and removed all mentions of "crawler" to reduce legal risk.
- **Documentation**: Added comprehensive security disclaimers and "How to update" instructions to `README.md`.
- **Documentation**: Added Docker Compose update instructions following the `local-notes-mcp2` pattern.

### Added
- Initial project setup with `@mchen-lab/app-kit`.
