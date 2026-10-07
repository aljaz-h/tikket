# Backup verification

Tikket backs up with two commands (see the README): an online SQLite snapshot and an archive of
the snapshot plus the uploads. v0.7 adds metadata to every snapshot and two read-only checks, so you
can trust a backup before you need it. Nothing is uploaded anywhere.

## 1. Back up

```bash
docker compose exec tikket node scripts/backup.js /data/backups 14
docker run --rm -v tikket_tikket-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/tikket-$(date +%F).tar.gz -C /data backups uploads
```

`backup.js` writes `tikket-<time>.db` and a metadata file `tikket-<time>.json` next to it (format
`tikket-backup` v1: app version, creation time, size, **SHA-256**, schema version, whether encrypted
secrets are present) and records the run in `DATA_DIR/backups/last-backup.json`, which
_Administration → Backups_ and _Health_ show. Old snapshots and their metadata are pruned.

> **Keep `ENCRYPTION_KEY` somewhere else** (e.g. a password manager). Encrypted integration secrets
> in a backup – SMTP password, Discord and webhook URLs, signing secrets, GitHub secrets – cannot be
> restored without the same key; they would have to be entered again.

## 2. Verify a backup (read-only)

```bash
npm run backup:verify -- <backup>           # node scripts/backup-verify.js <backup>
# in Docker, for a snapshot on the volume:
docker compose exec tikket node scripts/backup-verify.js /data/backups/tikket-….db --uploads /data/uploads
```

`<backup>` is a `.db` snapshot or a `.tar` / `.tar.gz` archive made as above. Checks:

| Check       | Fails the backup when                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Archive     | the gzip/tar data is corrupt or truncated, a header checksum is wrong, or an entry is a link, device or has an unsafe path (`..`, absolute) |
| Metadata    | the snapshot's SHA-256 differs from its metadata (missing metadata is only a warning)                                                       |
| SQLite      | the file can't be opened or `PRAGMA integrity_check` is not `ok`                                                                            |
| Schema      | Tikket tables are missing, or the backup is from a **newer** Tikket than this one (older backups are fine: migrations run on start)         |
| Attachments | – (warning) referenced image files missing from the archive / `--uploads` directory                                                         |
| Secrets     | – (warning) encrypted secrets are present: the same `ENCRYPTION_KEY` is needed                                                              |

It prints ✓ / ⚠ / ✗ lines and `Restorable: yes|no`, exits 0 when restorable, and supports
`--json`. The backup is only read; work happens on copies in a temporary directory that is removed
afterwards.

## 3. Dry-run a restore

```bash
npm run restore:verify -- tikket-2026-10-07.tar.gz
# in Docker, without touching the running instance:
docker compose run --rm --no-deps -v "$PWD":/backup tikket node scripts/restore-verify.js /backup/tikket-2026-10-07.tar.gz
```

Does everything `backup:verify` does and then applies **this version's migrations to a temporary
copy** of the database, proving that the backup opens and upgrades with the Tikket you are running.
It also reports the attachment count and size, missing uploads and whether `ENCRYPTION_KEY` is set
in this environment. It never overwrites the live database or `DATA_DIR`.

## 4. Restore

When the checks pass, follow _Restore_ in the README (stop Tikket, copy the snapshot to
`/data/tikket.db` and the `uploads` directory into the volume, start Tikket with the same
`ENCRYPTION_KEY`). Pending migrations are applied automatically on start.
