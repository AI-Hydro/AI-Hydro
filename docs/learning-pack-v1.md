# Learning Pack v1 Contract

AI-Hydro owns the canonical public schema for local Learning Pack archives at
`schemas/learning-pack/v1/pack.schema.json`.

The contract defines package identity, course/module ownership, runtime
compatibility, terminal-equivalent Python disclosure, canonical JSON, SHA-256
inventory, and Ed25519 signature verification. Archive inspection happens before
installation and without extracting unverified content.

The v1 archive inspector enforces a 256 MiB compressed limit, 512 MiB total
uncompressed limit, 10,000-entry limit, and 64 MiB per-file limit. It rejects
encrypted entries, symbolic links, undeclared layout roots, traversal and
platform-ambiguous paths, and Unicode normalization or full case-folding
collisions. After preflight, it streams file bytes into the same canonical
contract validator and returns a defensive, immutable inspection result.

It does not add remote or marketplace transport, install dependencies, authorize
instructor roles, sandbox Python, or make client-side quizzes secure.

## Transactional lifecycle

The lifecycle service consumes only a valid immutable archive inspection. A
cancelled approval returns before creating storage. Install Once approves only the
exact inspected archive; Trust Publisher and Install adds the derived fingerprint
to the atomic local trust store as part of the same recoverable transaction.

Install, rollback, and removal use a per-pack cross-process lock plus a short
registry lock for ownership collision safety. Staging and activation remain on the
same filesystem. The persisted journal advances through `preflight`, `staged`,
`verified`, `registry-prepared`, `activated`, `committed`, and
`cleanup-complete`. Recovery rolls pre-commit work back and completes post-commit
cleanup, and is safe to repeat.

Normal upgrades require greater SemVer precedence. Identical same-version content
is a no-op; altered same-precedence content and direct downgrades are rejected.
Prerelease targets require explicit opt-in. The registry retains only the active
version and one verified predecessor. Removal deletes their pack-owned directories
and registry record while leaving publisher trust and learning/runtime state
untouched.

## Local installation and runtime integration

AI-Hydro exposes these command-palette actions:

- **AI-Hydro: Install Learning Pack**
- **AI-Hydro: Roll Back Learning Pack**
- **AI-Hydro: Remove Learning Pack**
- **AI-Hydro: Manage Trusted Learning Pack Publishers**

Installation accepts a local `.aihydropack` file only. You can invoke the install
command from the Command Palette or use **Install Learning Pack** from a pack
file's Explorer context menu. AI-Hydro inspects the archive before writing
installation state. The approval prompt shows the edition, derived signer
fingerprint, runtime compatibility, environment metadata path, and the
terminal-equivalent unsandboxed Python capability.

A valid signature from an unknown key remains signed but untrusted. Choose
**Install Once** to approve only the inspected archive, or **Trust Publisher and
Install** to store the verified key fingerprint for future decisions. Publisher
names are informational. Instructor packs receive a separate warning because
their inspectable solutions are not role-protected. Prerelease versions require
an additional confirmation.

After a successful install, AI-Hydro opens the active course module through the
existing Studio, course, progress, and Python infrastructure. Installed-pack
progress is scoped by pack, course, and edition; control state is also scoped by
module. Pack approval does not override VS Code workspace trust or Python
execution permission. The installed-pack CSP blocks external resource origins
and packaged script files. It permits the host-injected inline bridge,
pack-authored inline scripts, local packaged styles/images/fonts/media, and the
required `data:`/`blob:` image and media sources.

Rollback selects the one retained verified predecessor. Removal deletes only
pack-owned installation files and its registry record; learning progress,
controls, legacy content, and publisher trust remain. Removing a trusted
fingerprint affects future installs and upgrades but does not uninstall existing
content.

The signature binds the exact bytes in `checksums.json` to an Ed25519 key. AI-Hydro
derives the key fingerprint from the verified public key. A valid signature from an
unknown key is not publisher verification and requires an explicit trust
decision. Learning Pack v1 still makes no publisher-identity, key-revocation,
Python-sandbox, role-authorization, or secure-assessment claim.
