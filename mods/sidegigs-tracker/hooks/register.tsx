import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ArtifactRow, FileRow } from '../types'

const PANE = 'sidegigs-tracker'
const TITLE = 'Sidegigs tracker'
const ROOT = '/mnt/project-files'
const SKIP = new Set(['source', 'node_modules', 'uploads', 'fonts', 'fontshim'])
const MAX_DEPTH = 6
const REFRESH_MS = 60_000
const LOGO_PNG = '/mnt/project-files/guides/beyond-vibe-coding/logo/BC-Guides-logo-h-dark.png'
// The BC Guides horizontal logo (dark), redrawn as vector for the app surfaces.
export const LOGO_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 200">' +
  '<rect width="600" height="200" rx="12" fill="#15202c"/>' +
  '<circle cx="115" cy="100" r="57" fill="none" stroke="#d9952b" stroke-width="4"/>' +
  '<text x="115" y="117" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="50" fill="#d9952b">BC</text>' +
  '<text x="248" y="98" font-family="Georgia,serif" font-weight="700" font-size="64" fill="#ffffff">BC Guides</text>' +
  '<g stroke-width="5" stroke-linecap="round">' +
  '<line x1="250" y1="120" x2="268" y2="120" stroke="#2e7d6b"/><line x1="282" y1="120" x2="300" y2="120" stroke="#2e7d6b"/>' +
  '<line x1="314" y1="120" x2="332" y2="120" stroke="#d9952b"/><line x1="346" y1="120" x2="364" y2="120" stroke="#2e7d6b"/>' +
  '<line x1="378" y1="120" x2="396" y2="120" stroke="#2e7d6b"/></g>' +
  '<text x="248" y="148" font-family="Helvetica,Arial,sans-serif" font-size="17" fill="#9aa8b5">Practical guides for high-performing teams</text>' +
  '</svg>'


const files = atom({ plugin: 'sidegigs-tracker', key: 'files' } as const, [] as FileRow[], { shape: 'files-1' })
const artifacts = atom({ plugin: 'sidegigs-tracker', key: 'artifacts' } as const, [] as ArtifactRow[], { shape: 'artifacts-1' })
const checkedAt = atom({ plugin: 'sidegigs-tracker', key: 'checkedAt' } as const, 0, { shape: 'checked-1' })
const openFolders = atom({ plugin: 'sidegigs-tracker', key: 'openFolders' } as const, [] as string[], { shape: 'open-1' })

export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const pad = (n: number) => String(n).padStart(2, '0')

// dd/mm/yyyy, with a relative age for anything under a day old.
export const formatWhen = (ms: number, now: number): string => {
  const mins = Math.floor((now - ms) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 24 * 60) return `${Math.floor(mins / 60)}h ago`
  const d = new Date(ms)
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`
}

export const folderOf = (path: string): string => {
  const cut = path.lastIndexOf('/')
  return cut < 0 ? '(top level)' : path.slice(0, cut)
}

export const groupByFolder = (rows: FileRow[]): [string, FileRow[]][] => {
  const groups = new Map<string, FileRow[]>()
  for (const row of rows) {
    const key = folderOf(row.path)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

// The artifact list arrives wrapped in a note; take the JSON object inside.
export const parseArtifacts = (text: string): ArtifactRow[] => {
  const start = text.indexOf('{"artifacts"')
  const end = text.lastIndexOf(']}')
  if (start < 0 || end < start) return []
  const parsed = JSON.parse(text.slice(start, end + 2)) as {
    artifacts: { title?: string; url?: string; updated_at?: string }[]
  }
  return parsed.artifacts
    .filter(a => typeof a.url === 'string' && a.url.startsWith('https://claude.ai/'))
    .map(a => ({ title: a.title ?? a.url!, url: a.url!, updatedAt: a.updated_at ?? '' }))
}

type Lister = (path: string) => Promise<{ name: string; kind: string; size: number; mtimeMs: number }[]>

const walk = async (list: Lister, dir: string, rel: string, depth: number, out: FileRow[]) => {
  if (depth > MAX_DEPTH) return
  const entries = await list(dir).catch(() => [])
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const childRel = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.kind === 'dir') {
      if (!SKIP.has(entry.name)) await walk(list, `${dir}/${entry.name}`, childRel, depth + 1, out)
    } else if (entry.kind === 'file') {
      out.push({ path: childRel, size: entry.size, mtimeMs: entry.mtimeMs })
    }
  }
}

const refresh = async ($: EngineInterface) => {
  const found: FileRow[] = []
  await walk(path => $.fs.list(path), ROOT, '', 0, found)
  await update($, files, () => found)
  const result = await $.mcp.call('hearthbot', 'list_project_artifacts', { limit: 100 }).catch(() => undefined)
  const text = result?.content.map(c => ('text' in c && typeof c.text === 'string' ? c.text : '')).join('') ?? ''
  const list = (() => {
    try {
      return parseArtifacts(text)
    } catch {
      return []
    }
  })()
  if (list.length > 0) await update($, artifacts, () => list)
  await update($, checkedAt, () => Date.now())
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'tracker', description: 'Show project files and artifacts beside the chat' })
    void $.ui.open({ id: PANE, title: TITLE })
    void refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))
    return next(e)
  })

  on('command.run', { command: 'tracker' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    await refresh($)
    return { text: 'Tracker pane opened.' }
  })

  // A new file or artifact usually follows one of these; refresh straight after.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (/^(Write|Artifact|Edit|Bash|mcp__remote-devices__device_commit_files)$/.test(e.tool)) void refresh($)
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button, Link } = ui
    const rows = await read($, files)
    const arts = await read($, artifacts)
    const at = await read($, checkedAt)
    const open = new Set(await read($, openFolders))
    const now = Date.now()
    const png =
      'Image' in ui ? await $.fs.read(LOGO_PNG, { as: 'bytes' }).catch(() => undefined) : undefined
    const logo =
      'Svg' in ui ? (
        <ui.Svg source={LOGO_SVG} alt="BC Guides" width={240} height={80} />
      ) : 'Image' in ui && png && typeof png === 'object' && 'base64' in png ? (
        <ui.Image source={{ png: png.base64 }} columns={30} rows={5} alt="BC Guides" />
      ) : (
        <Text bold>BC Guides</Text>
      )
    const toggle = (folder: string) => () =>
      void update($, openFolders, list => (list.includes(folder) ? list.filter(f => f !== folder) : [...list, folder]))

    return (
      <Box flexDirection="column" gap={1}>
        {logo}
        <Box flexDirection="row" gap={1}>
          <Text dimColor>{at ? `Checked ${formatWhen(at, now)}` : 'Checking...'}</Text>
          <Button key="refresh" label="Refresh" onPress={() => void refresh($)} />
        </Box>

        <Box flexDirection="column">
          <Text bold>Files ({rows.length})</Text>
          {rows.length === 0 && <Text dimColor>No files found yet.</Text>}
          {groupByFolder(rows).map(([folder, list]) => {
            const total = list.reduce((sum, r) => sum + r.size, 0)
            const newest = Math.max(...list.map(r => r.mtimeMs))
            const isOpen = open.has(folder)
            return (
              <Box key={`f:${folder}`} flexDirection="column">
                <Button key={`folder:${folder}`} onPress={toggle(folder)}>
                  {isOpen ? '▾' : '▸'} {folder}{' '}
                  <Text dimColor>
                    {list.length} · {formatSize(total)} · {formatWhen(newest, now)}
                  </Text>
                </Button>
                {isOpen &&
                  list
                    .sort((a, b) => a.path.localeCompare(b.path))
                    .map(r => (
                      <Text>
                        {'   '}
                        {r.path.slice(r.path.lastIndexOf('/') + 1)} <Text dimColor>{formatSize(r.size)}</Text>
                      </Text>
                    ))}
              </Box>
            )
          })}
        </Box>

        <Box flexDirection="column">
          <Text bold>Artifacts ({arts.length})</Text>
          {arts.length === 0 && <Text dimColor>No artifacts listed yet.</Text>}
          {arts.map(a => (
            <Box key={`a:${a.url}`} flexDirection="row" gap={1}>
              <Link href={a.url} label={a.title} />
              <Text dimColor>{a.updatedAt ? formatWhen(Date.parse(a.updatedAt), now) : ''}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}
