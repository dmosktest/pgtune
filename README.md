# pgtune

Browser-only PostgreSQL configuration tuner.

**Version:** `1.1.0`

## Features

- PostgreSQL 14–19
- Core form first; advanced options and optional stats/config paste behind spoilers
- Result immediately after generate: memory budget, multi-format export, explanations; warnings below
- Export: conf, `ALTER SYSTEM`, Docker `-c`, Compose, Helm/CNPG, Migration SQL, Patroni, Ansible
- Pooler modes, server roles, AWS/Yandex presets, conf diff, `pg_stat_*` ingest
- Host collector scripts (`collect.sh` / `collect.ps1`) that print a parameterized pgtune URL
- Downloadable briefs for a human DBA and for an AI agent
- 37 UI languages; shareable URL

Everything runs in the browser. There is no API that accepts your server parameters.

## License

MIT — see [LICENSE](LICENSE).

## Upstream

Product docs and deploy live in the private GitLab `mksrv` monorepo. This GitHub tree is the public application source mirror only.
