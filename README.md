<p align="center">
  <img src="./assets/logo.png" alt="ELARIS Logo" width="140" />
</p>

<h1 align="center">ELARIS Core</h1>

<p align="center">
  The open core of the ELARIS automation ecosystem.
  <br />
  A modular automation engine for home, building, and light industrial control.
</p>

---

## Overview

**ELARIS Core** is the central automation engine behind the ELARIS ecosystem.

It provides the runtime logic, module system, device integration, role model, and configuration foundation needed to build reliable automation systems for real-world environments.

ELARIS is designed around practical installer and control workflows — from simple room automation and lighting control to multi-zone climate, scenes, overrides, diagnostics, and modular device integration.

This repository represents the **open core** of the platform: the engine, architecture, and base logic that power the wider ELARIS system.

---

## What ELARIS Core Includes

- Modular automation architecture
- Runtime automation engine
- MQTT-based device integration
- SQLite-backed storage layer
- Role-aware control model (`User / Engineer / Admin`)
- Scenes, overrides, rules, and module-based logic
- Web-based control and commissioning foundation
- Extensible platform for custom modules and hardware nodes

---

## Design Principles

ELARIS Core is built around a few clear ideas:

- **Automation first** — real control logic comes before hype
- **Modular by design** — modules should be easy to expand, replace, and maintain
- **Installer-friendly** — commissioning and diagnostics matter
- **Role-aware** — user controls and engineering controls must stay separate
- **Real-world ready** — built for practical use, not just demos

---

## Technology Stack

- **Runtime:** Node.js
- **Database:** SQLite
- **Communication:** MQTT, HTTP APIs
- **Hardware:** ESP32 and modular I/O nodes
- **Frontend:** Web-based control and commissioning UI

---

## Repository Status

**Early public repository**

The project is currently being prepared for its first stable beta release.

Code will be published progressively as the core modules, runtime behavior, and commissioning flow reach the level of stability required for public use and review.

---

## Roadmap Focus

Current development is focused on:

- hardening the runtime engine
- refining existing automation modules
- improving commissioning workflows
- strengthening role safety and recovery paths
- polishing the UI/UX of module setup and daily control
- preparing the open core for a stable public beta

---

## Philosophy

ELARIS is not built as a generic “smart home toy”.

It is being developed as a serious, modular automation platform with a clean separation between:
- daily user control
- installer/engineer commissioning
- system-level administration

The goal is to create a platform that is flexible enough for makers and integrators, while remaining structured enough to support real installations.

---

## Getting Started

Public setup instructions will be added once the first stable beta snapshot is published.

For now:

1. Watch this repository for upcoming commits
2. Follow the ELARIS organization for related projects
3. Expect the first public code release once the core runtime and modules are ready

---

## License

**TBD**

The licensing model for the open core is still being finalized.

It may remain fully open, or move to a more structured open-core model depending on the final release plan.

---

## ELARIS Ecosystem

This repository is part of the broader **ELARIS** ecosystem, which is evolving around:

- core automation runtime
- modular device integration
- commissioning tools
- user control interfaces
- future hardware nodes and deployment flows

---

<p align="center">
  Built with real-world automation experience in mind.
</p>
