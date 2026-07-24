# LCC Operating System — entry point

**Start here:** [`docs/os/README.md`](docs/os/README.md)

This repo runs on one brain (LCC engines + data), one memory (Cortex), one instruction/policy **canon**
(`docs/os/canon/`), and one knowledge set (BRIGGS-*). Every surface — Copilot, Claude Personal, Claude Cowork,
Northmarq Claude, ChatGPT — is a front door that binds to the same canon so outputs match everywhere.

**Any future chat / build:** read `docs/os/README.md` → `docs/os/REGISTRY.md` → the relevant
`docs/os/canon/<topic>.md`. Edit the canon, bump its version, then run `docs/os/SURFACE-SYNC-PROTOCOL.md` to
update every surface. **Never start from scratch; never fork a source; never overwrite canon without bumping
its version.**
