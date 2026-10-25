# Plane Pages Sync

Write notes in Obsidian, publish them as [Plane](https://plane.so) project pages. One folder is one Plane project, and every note in it becomes a page.

```
Plane/
  Clearline Books/        -> Plane project "Clearline Books"
    Architecture.md       -> page "Architecture"
    Onboarding flow.md    -> page "Onboarding flow"
  HOLDBACK/               -> project with identifier HOLD
    Retention rules.md
```

Requires Obsidian 1.13.2 or later. Works on desktop and mobile.

## Install

### Manually

1. Download `main.js` and `manifest.json` from the [latest release](https://github.com/abdullahwaqar/obsidian-plane-pages-sync/releases/latest).
2. Put them in `<your vault>/.obsidian/plugins/plane-pages-sync/`.
3. Reload Obsidian and enable **Plane Pages Sync** under Settings > Community plugins.

## Set up

Open Settings > Plane Pages Sync:

1. **Personal access token**: create one in Plane under Profile settings > Personal access tokens, then add it here. It's stored in Obsidian's secret storage, not in the plugin's data file.
2. **Workspace**: your workspace slug. Pasting any Plane link from that workspace also works.
3. **Self-hosted Plane**: turn on and fill in **Instance URL** if you're not on app.plane.so.
4. Click **Check connection**.

## Link folders to projects

Use whichever feels natural:

- **Name it.** Create `Plane/<Project name>` or `Plane/<IDENTIFIER>`. The first note you save there links the folder automatically.
- **Command palette:** "Create folder for a project" lists your projects and makes the folder for you.
- **Right-click any folder** in the file explorer and choose "Link to Plane project…". Subfolders inherit the link.
- **Settings:** "Linked folders" shows every link. Click a row to change its project.

## Day to day

- Write. With **Sync on save** on, a note is pushed a few seconds after you stop typing. The status bar shows `Plane: syncing 1`, then `Plane: synced`.
- The first push adds `plane_page` and `plane_project` to the note's properties. That's how the note remembers its page, so renames and moves keep working.
- Renaming a note renames the page.
- Moving a note to a folder linked to another project creates a page there and archives the old one, since Plane can't move pages between projects.
- Deleting a note archives its page. You can change this in settings.
- Click the status bar item to push everything. If it says `Plane: error`, click it to see why.

Commands: push current note, push all linked folders, open or copy the Plane link, and stop syncing the current note (sets `plane_sync: false`).

## What converts

| Obsidian                                                                        | Plane                                                                 |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Headings, bold, italic, strikethrough, code, code blocks, quotes, tables, `---` | Native equivalents                                                    |
| `- [ ]` and `- [x]`                                                             | Plane checklist                                                       |
| `> [!warning] Title` callouts                                                   | Plane callout block with a matching emoji and colour                  |
| `[[Other note]]`                                                                | Link to that note's Plane page once it's synced, otherwise plain text |
| `==highlight==`                                                                 | Bold                                                                  |
| `%% comments %%` and frontmatter                                                | Dropped                                                               |
| Raw HTML                                                                        | Shown as text, never injected                                         |
| `![[image.png]]` (local files)                                                  | Placeholder text, see limitations                                     |

## Limitations

- **One way, Obsidian to Plane.** Edits made in Plane are overwritten the next time that note is pushed. Treat Obsidian as the source of truth, or lock a page in Plane to freeze it (the plugin tells you when a page is locked).
- Local images and attachments aren't uploaded yet. Remote image links (`![](https://…)`) work.
- Subfolders map to the same project, but pages are flat in Plane.
- Plane allows 60 API requests a minute. The plugin queues and spaces requests, so a first sync of a big folder takes about a second per note.

## Privacy and network use

- The plugin only talks to the Plane API: `api.plane.so`, or your own instance URL if you're self-hosted.
- It sends the title and content of notes inside linked folders, and nothing else from your vault.
- No analytics, telemetry or third-party services.
- Your token stays in Obsidian's secret storage.

## Development

```bash
npm install
npm run dev           # rebuilds main.js on every save
npm run check         # format check, Biome, Obsidian's review lint, type check, tests
npm run build         # production build
npm run format        # dprint: 4 spaces, braces on the next line
```

To try changes in a vault, link the project folder into `<vault>/.obsidian/plugins/plane-pages-sync` and install the Hot Reload plugin.

### Publishing to the community directory

Only the first version needs submitting. Later releases are picked up from GitHub automatically.

1. Make the repository public with this README, `LICENSE` and `manifest.json` committed on the default branch.
2. Publish a release with the steps above.
3. Sign in at [community.obsidian.md](https://community.obsidian.md) with your Obsidian account and connect GitHub.
4. Add the plugin from the dashboard and set pricing to **Free**.
5. Fix anything the automated review flags, then release a new patch version.

Run `npm run check` before every release. It covers the same lint rules as the review.

## License

[MIT](LICENSE)
