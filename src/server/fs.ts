import { readdir, readFile, stat } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import type { TemplateFileSystem } from "../core"

/** Node implementation of the core's file-system abstraction, with a short-lived cache. */
export class NodeTemplateFileSystem implements TemplateFileSystem {
  workspaceFolders: string[] = []
  private readonly existsCache = new Map<string, { value: boolean; at: number }>()
  private readonly ttl = 2000

  setWorkspaceFolders(uris: string[]) {
    this.workspaceFolders = uris.filter((u) => u.startsWith("file:")).map((u) => fileURLToPath(u))
  }

  invalidate() {
    this.existsCache.clear()
  }

  async exists(filePath: string): Promise<boolean> {
    const cached = this.existsCache.get(filePath)
    const now = Date.now()
    if (cached && now - cached.at < this.ttl) return cached.value
    let value = false
    try {
      value = (await stat(filePath)).isFile()
    } catch {
      value = false
    }
    this.existsCache.set(filePath, { value, at: now })
    return value
  }

  async readDir(dirPath: string): Promise<{ name: string; isDirectory: boolean }[]> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true })
      return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }))
    } catch {
      return []
    }
  }

  async readText(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, "utf8")
    } catch {
      return null
    }
  }
}
