import * as path from "node:path"

/** Minimal file-system abstraction so the core stays free of Node `fs`. */
export interface TemplateFileSystem {
  exists(filePath: string): Promise<boolean>
  /** Entries of a directory; empty when it does not exist. */
  readDir(dirPath: string): Promise<{ name: string; isDirectory: boolean }[]>
  workspaceFolders: string[]
}

export interface TemplateSettings {
  /** Directories, relative to each workspace folder, that templates are resolved against. */
  templateRoots: string[]
  /** Suffixes tried when a template name has no extension. */
  templateSuffixes: string[]
}

export const defaultTemplateSettings: TemplateSettings = {
  templateRoots: [
    "src/main/resources/templates",
    "src/main/resources",
    "templates",
    "resources/templates",
  ],
  templateSuffixes: [".peb", ".pebble", ".html"],
}

const hasExtension = (name: string) => /\.[A-Za-z0-9]+$/.test(name)

/** Directories a template name is resolved against, in priority order. */
export function templateDirectories(
  fromFile: string | undefined,
  settings: TemplateSettings,
  workspaceFolders: string[],
): string[] {
  const dirs: string[] = []
  if (fromFile) dirs.push(path.dirname(fromFile))
  for (const folder of workspaceFolders) {
    for (const root of settings.templateRoots) dirs.push(path.resolve(folder, root))
    dirs.push(folder)
  }
  return [...new Set(dirs)]
}

/** File paths to try for a template name, in priority order. */
export function templateCandidates(
  name: string,
  fromFile: string | undefined,
  settings: TemplateSettings,
  workspaceFolders: string[],
): string[] {
  const clean = name.replace(/^\/+/, "")
  const names = hasExtension(clean)
    ? [clean]
    : [clean, ...settings.templateSuffixes.map((s) => clean + s)]
  const candidates: string[] = []
  for (const dir of templateDirectories(fromFile, settings, workspaceFolders)) {
    for (const n of names) candidates.push(path.resolve(dir, n))
  }
  return [...new Set(candidates)]
}

/** Resolves a template name to an existing file, or null. */
export async function resolveTemplate(
  name: string,
  fromFile: string | undefined,
  settings: TemplateSettings,
  fs: TemplateFileSystem,
): Promise<string | null> {
  for (const candidate of templateCandidates(name, fromFile, settings, fs.workspaceFolders)) {
    if (await fs.exists(candidate)) return candidate
  }
  return null
}

export interface TemplateListing {
  /** Name as it would be written in `include`/`extends`, relative to the root it was found in. */
  name: string
  filePath: string
}

/** Lists template files under every template root (depth-limited), for completion. */
export async function listTemplates(
  fromFile: string | undefined,
  settings: TemplateSettings,
  fs: TemplateFileSystem,
  maxDepth = 4,
): Promise<TemplateListing[]> {
  const results = new Map<string, TemplateListing>()
  const suffixes = settings.templateSuffixes
  const dirs = templateDirectories(fromFile, settings, fs.workspaceFolders).filter(
    (d) => !fs.workspaceFolders.includes(d),
  )
  async function visit(root: string, dir: string, depth: number) {
    if (depth > maxDepth) return
    for (const entry of await fs.readDir(dir)) {
      if (
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "target" ||
        entry.name === "build"
      )
        continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory) await visit(root, full, depth + 1)
      else if (suffixes.some((s) => entry.name.endsWith(s))) {
        const name = path.relative(root, full).split(path.sep).join("/")
        if (!results.has(name)) results.set(name, { name, filePath: full })
      }
    }
  }
  for (const dir of dirs) await visit(dir, dir, 0)
  return [...results.values()]
}
