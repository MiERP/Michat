import fs from 'fs'
import path from 'path'

export interface InstalledOfficeManifest {
  host: 'word' | 'excel'
  sourcePath: string
  installedPath: string
}

export const OFFICE_MANIFESTS: Array<{
  host: 'word' | 'excel'
  addinId: string
  fileName: string
}> = [
  { host: 'word', addinId: '9f2b7a49-6d8f-4d9d-9d5d-3a4b8f9d2c11', fileName: 'word-manifest.xml' },
  { host: 'excel', addinId: 'd63eec6e-6b5f-4b5f-9b4d-3c1c1e7f5e2a', fileName: 'excel-manifest.xml' }
]

export function resolveOfficeManifestPath(sourceDir: string, host: 'word' | 'excel'): string {
  const manifestPath = path.join(sourceDir, host, 'manifest.xml')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing ${host} Office manifest in ${sourceDir}`)
  }

  return manifestPath
}

export function copyOfficeManifests(
  sourceDir: string,
  installRoot: string
): InstalledOfficeManifest[] {
  fs.mkdirSync(installRoot, { recursive: true })

  return OFFICE_MANIFESTS.map((manifest) => {
    const sourcePath = resolveOfficeManifestPath(sourceDir, manifest.host)
    const installedPath = path.join(installRoot, manifest.fileName)
    fs.copyFileSync(sourcePath, installedPath)
    return {
      host: manifest.host,
      sourcePath,
      installedPath
    }
  })
}
