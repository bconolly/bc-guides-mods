export type FileRow = { path: string; size: number; mtimeMs: number }
export type ArtifactRow = { title: string; url: string; updatedAt: string }

declare module 'claude-code' {
  interface PluginState {
    'tracker': {
      files: Shaped<FileRow[]>
      artifacts: Shaped<ArtifactRow[]>
      checkedAt: Shaped<number>
      openFolders: Shaped<string[]>
    }
  }
}
