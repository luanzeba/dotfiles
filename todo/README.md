# todo

Install + configure the `todo` CLI with an interactive setup wizard.

## Usage

```bash
dot install todo
```

The installer asks:
1. **Role**: `server` or `client`
2. **Mode**: `local` or `remote`

It then writes config files under `~/.config/todo/` and, for server mode on Linux, can set up a user `systemd` service (`todo-api.service`).

## Behavior

- Not included in the default full install (`dot install` / `install-local`)
- Installed on demand with `dot install todo`
- Builds from source repo (`~/projects/todo` by default)
- Links binary to `~/.local/bin/todo`

## Non-interactive mode

Set env vars before running `dot install todo` (or source this install script directly):

- `TODO_ROLE=server|client`
- `TODO_MODE=local|remote`

Optional:

- `TODO_REPO_PATH` (default `~/projects/todo`)
- `TODO_REPO_URL` (default `https://github.com/luanzeba/todo.git`)
- `TODO_AUTO_CLONE=1` (auto-clone repo if missing)

Server-mode options:

- `TODO_SERVER_DB_PATH`
- `TODO_SERVER_HOST`
- `TODO_SERVER_PORT`
- `TODO_SERVER_TOKEN`
- `TODO_SERVER_EXPOSE_TAILSCALE=1`

Remote-client options:

- `TODO_REMOTE_URL`
- `TODO_REMOTE_TOKEN_MODE=env|inline|skip`
- `TODO_REMOTE_TOKEN_ENV` (default `TODO_REMOTE_TOKEN`)
- `TODO_REMOTE_TOKEN`
