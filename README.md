# Galena

A local Markdown notes editor in the spirit of Obsidian, with coding agents
(Claude, Codex, Gemini CLI and others) built in through the
[Agent Client Protocol](https://agentclientprotocol.com).

```sh
npx galena [vault-folder] [--port <port>] [--no-open]
```

Galena starts a server on `127.0.0.1`, opens the app in your browser and stops
with Ctrl+C. Without a folder it shows a home screen with your recent vaults
and a folder browser to pick another.
It needs Node 22.22 or newer; nothing else is installed. Version control uses
the Git already on your machine, if there is one.

## What it does

- **Vault on disk.** Notes are plain `.md` files, compatible with an existing
  Obsidian vault. Galena keeps its own data in `.galena/` inside the vault.
- **Editor.** CodeMirror 6 with Markdown, frontmatter, `[[wikilinks]]` with
  autocompletion (Ctrl/Cmd+click to follow), tabs, autosave and backlinks.
  Links, tables and LaTeX math (`$…$`, `$$…$$`) are rendered in place and
  turn back into source under the cursor; fenced code is syntax-highlighted.
  Headings are written with `#`: a line of `=` or `-` under a paragraph does
  not make it a heading, so a list started right below one stays a list.
- **Explorer, search and graph.** File tree with create, rename, drag-and-drop
  move and delete; a quick switcher (Ctrl/Cmd+K) with full-text search; a graph
  of notes and links. All of them follow changes made outside the app.
- **Agents.** Pick an agent from the ACP registry and chat with it about your
  vault: streaming answers, tool calls, plans and permission requests. Mention
  notes with `@` or attach the open note or the current selection. Pick the
  model, the effort and whatever else the agent offers; new chats keep the last
  model and effort chosen for each agent.
- **Reviewable edits.** Files an agent writes through ACP are recorded as
  changes you can accept or reject, per file or all at once.
- **Git.** A vault that is a Git repository gets a Git tab next to the files:
  what changed since the last commit, with diffs; one Sync button that commits,
  merges what the remote has and pushes; and a view to resolve the conflicts a
  merge leaves, one by one. Changes are committed whole, and an agent's changes
  have to be reviewed before they can be. `.galena/` stays out of the
  repository unless you say otherwise in Settings; its trash always does.

Galena stores no credentials: each agent uses the login or API key of its own
CLI, and Git uses the credential helper or SSH keys it is already set up with.
Agents published as npm or PyPI packages run through `npx`/`uvx`; the rest
need a launch command, set in Settings.

## Development

```sh
pnpm install
GALENA_VAULT=/path/to/a/vault pnpm dev   # Vite + the API, with hot reload
pnpm build                               # dist/cli.mjs and dist/client
pnpm typecheck
pnpm test                                # node --test, no extra tooling
```

## Layout

| Path                      | What lives there                                            |
| ------------------------- | ----------------------------------------------------------- |
| `src/cli.ts`              | The `galena` command (citty)                                |
| `src/server/app.ts`       | HTTP API, WebSocket and request security (Hono)             |
| `src/server/workspace.ts` | An open vault: file watcher, settings, agent access rules   |
| `src/server/vault.ts`     | File access confined to the vault                           |
| `src/server/folders.ts`   | Folder listings for choosing a vault                        |
| `src/server/notes.ts`     | In-memory index: wikilinks, tags, backlinks, graph, search  |
| `src/server/agents.ts`    | Agent processes: one per agent, shared by its chats         |
| `src/server/sessions.ts`  | Chats and their ACP sessions                                |
| `src/server/changes.ts`   | Agent writes awaiting review                                |
| `src/server/git*.ts`      | The vault's Git repository, through the installed `git`     |
| `src/server/registry.ts`  | The ACP agent registry                                      |
| `src/shared`              | Types, transcript reducer and config option helpers         |
| `src/client`              | The React app                                               |

## Security

The server listens only on `127.0.0.1`, by default on port 3535 (or any free
port if that one is taken). Its API has no login or token, so any program or
user on the same machine can do everything it allows: read and write the vault,
open any folder, launch agents and push the vault's Git repository. That is why
Galena is meant for a personal machine.

Browsers are kept out by the `Origin` and `Host` checks. Requests must carry a
loopback `Host`, so DNS rebinding cannot reach the server, and every request
that can change something, as well as the WebSocket, a same-origin `Origin`, so
other sites cannot use the API. GET requests from other sites can arrive
without `Origin`, but they change nothing and the site cannot read the answer.

Agents are ordinary local processes started in the vault folder, one per agent,
kept until the vault is closed. The chats with an agent share its process, so
if the process ends, all of its chats stop. A chat left alone for five minutes
has its ACP session closed to free the agent's memory, if the agent supports
it, and resumed when used again. The file access Galena gives them over ACP is
limited to the vault, minus hidden folders and the folders you exclude in
Settings.

Git is run without a shell, with fixed arguments and paths taken literally. A
remote added from the app cannot be an option or a `transport::` helper, and
only files Git itself reports as changed in the vault can be diffed, discarded
or resolved.
