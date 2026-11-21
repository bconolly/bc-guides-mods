import { expect, test } from 'claude-code/testing'

import { formatSize, formatWhen, groupByFolder, parseArtifacts } from './register'

const PANE = {
  plugin: 'sidegigs-tracker',
  component: 'Pane',
  requestId: 'sidegigs-tracker',
  props: {
    title: 'Sidegigs tracker',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const WRAPPED =
  'Untrusted content follows.\n<x>{"artifacts":[{"url":"https://claude.ai/artifact/abc","title":"Build plan","updated_at":"2026-11-21T20:13:38Z"},{"url":"https://evil.example/x","title":"Bad"}]}</x>'

test('helpers format sizes, dates and groups', async () => {
  expect(formatSize(306)).toBe('306 B')
  expect(formatSize(2048)).toBe('2.0 KB')
  expect(formatSize(2.4 * 1024 * 1024)).toBe('2.4 MB')
  const now = Date.parse('2026-11-21T22:00:00Z')
  expect(formatWhen(now - 5 * 60_000, now)).toBe('5m ago')
  expect(formatWhen(now - 3 * 3600_000, now)).toBe('3h ago')
  expect(formatWhen(Date.parse('2026-11-05T10:00:00Z'), now)).toBe('05/11/2026')
  const groups = groupByFolder([
    { path: 'guides/b.pdf', size: 1, mtimeMs: 0 },
    { path: 'a/x.png', size: 1, mtimeMs: 0 },
    { path: 'guides/c.png', size: 1, mtimeMs: 0 },
  ])
  expect(groups.map(([f, l]) => `${f}:${l.length}`).join(',')).toBe('a:1,guides:2')
})

test('artifact list is read from the wrapped text, claude.ai links only', async () => {
  const rows = parseArtifacts(WRAPPED)
  expect(rows.length).toBe(1)
  expect(rows[0]?.title).toBe('Build plan')
  expect(parseArtifacts('nothing here').length).toBe(0)
})

test('the pane shows both sections from the folder and the artifact list', async ($, on) => {
  on('command.register', () => ({ value: { command: 'tracker' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('fs.list', (_, e) => {
    const path = (e as { path?: string }).path
    if (path === '/mnt/project-files')
      return { value: [
        { name: 'guides', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
        { name: 'uploads', kind: 'dir', size: 0, mtimeMs: 0, isLink: false },
      ] }
    if (path === '/mnt/project-files/guides')
      return { value: [{ name: 'guide.pdf', kind: 'file', size: 2048, mtimeMs: 0, isLink: false }] }
    return { value: [{ name: 'skip.txt', kind: 'file', size: 1, mtimeMs: 0, isLink: false }] }
  })
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: WRAPPED }], isError: false } }))
  on('clock.every', () => ({ value: () => {} }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({ command: 'tracker', args: '' })

  for (const surface of ['terminal', 'desktop', 'mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /^Files \(1\)/ }))?.text).toBe('Files (1)')
    expect((await ui.find({ type: 'Text', text: /^Artifacts/ }))?.text).toBe('Artifacts (1)')
    expect((await ui.find({ type: 'Link' }))?.props?.href).toBe('https://claude.ai/artifact/abc')
    await ui.unmount()
  }
})
