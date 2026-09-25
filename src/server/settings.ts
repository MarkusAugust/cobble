import type { CustomEntry } from "../core"
import type { Level } from "../core/features/diagnostics"

export interface PebbleSettings {
  templateRoots: string[]
  templateSuffixes: string[]
  customFilters: CustomEntry[]
  customFunctions: CustomEntry[]
  customTests: CustomEntry[]
  customTags: string[]
  spring: { enabled: boolean }
  diagnostics: {
    enabled: boolean
    unknownFilter: Level
    unknownFunction: Level
    unknownTest: Level
    missingTemplate: Level
  }
  html: { enabled: boolean; delegate: boolean }
}

export const defaultSettings: PebbleSettings = {
  templateRoots: [
    "src/main/resources/templates",
    "src/main/resources",
    "templates",
    "resources/templates",
  ],
  templateSuffixes: [".peb", ".pebble", ".html"],
  customFilters: [],
  customFunctions: [],
  customTests: [],
  customTags: [],
  spring: { enabled: true },
  diagnostics: {
    enabled: true,
    unknownFilter: "warning",
    unknownFunction: "off",
    unknownTest: "warning",
    missingTemplate: "warning",
  },
  html: { enabled: true, delegate: true },
}

/** Deep-merges a partial configuration object over the defaults. */
export function mergeSettings(partial: unknown): PebbleSettings {
  const p = (partial ?? {}) as Partial<PebbleSettings>
  return {
    ...defaultSettings,
    ...p,
    spring: { ...defaultSettings.spring, ...(p.spring ?? {}) },
    diagnostics: { ...defaultSettings.diagnostics, ...(p.diagnostics ?? {}) },
    html: { ...defaultSettings.html, ...(p.html ?? {}) },
    templateRoots: Array.isArray(p.templateRoots) ? p.templateRoots : defaultSettings.templateRoots,
    templateSuffixes: Array.isArray(p.templateSuffixes)
      ? p.templateSuffixes
      : defaultSettings.templateSuffixes,
    customFilters: Array.isArray(p.customFilters) ? p.customFilters : [],
    customFunctions: Array.isArray(p.customFunctions) ? p.customFunctions : [],
    customTests: Array.isArray(p.customTests) ? p.customTests : [],
    customTags: Array.isArray(p.customTags) ? p.customTags : [],
  }
}
