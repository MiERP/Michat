const fs = require('fs')
const path = require('path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')
const ResEdit = require('resedit')

/**
 * Apply the product icon and version metadata to the packaged Windows binary.
 *
 * electron-builder normally does this through rcedit, but the model-less local
 * build disables `signAndEditExecutable` so it does not depend on the
 * winCodeSign archive (which contains macOS symlinks Windows cannot create
 * without elevation). resedit performs the same resource edits in-process.
 */
function applyWindowsBranding(exePath, appInfo) {
  const iconPath = path.resolve(__dirname, '..', 'build', 'icon.ico')
  if (!fs.existsSync(exePath) || !fs.existsSync(iconPath)) return

  const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true })
  const resources = ResEdit.NtExecutableResource.from(exe)

  const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath))
  const iconData = iconFile.icons.map((item) => item.data)
  const existingGroups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries)
  const groups = existingGroups.length > 0 ? existingGroups : [{ id: 101, lang: 1033 }]
  for (const group of groups) {
    ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
      resources.entries,
      group.id,
      group.lang,
      iconData
    )
  }

  const version = String(appInfo.version || '0.0.0')
  const versionParts = version.split('.').map((part) => Number(part) || 0)
  const versionInfos = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)
  const versionInfo = versionInfos[0] ?? ResEdit.Resource.VersionInfo.createEmpty()
  versionInfo.setFileVersion(
    versionParts[0] ?? 0,
    versionParts[1] ?? 0,
    versionParts[2] ?? 0,
    0,
    1033
  )
  versionInfo.setProductVersion(
    versionParts[0] ?? 0,
    versionParts[1] ?? 0,
    versionParts[2] ?? 0,
    0,
    1033
  )
  versionInfo.setStringValues(
    { lang: 1033, codepage: 1200 },
    {
      CompanyName: 'HAVS',
      FileDescription: 'MiChat',
      FileVersion: version,
      InternalName: 'michat',
      LegalCopyright: 'AGPL-3.0-only',
      OriginalFilename: 'michat.exe',
      ProductName: 'MiChat',
      ProductVersion: version
    }
  )
  versionInfo.outputToResourceEntries(resources.entries)
  resources.outputResource(exe)
  fs.writeFileSync(exePath, Buffer.from(exe.generate()))
  console.log(`[afterPack] Applied MiChat icon and version metadata to ${exePath}`)
}

/**
 * electron-builder afterPack hook: brand the Windows binary, then disable Node
 * and debug entry points and require the packaged app to load from asar.
 */
module.exports = async function afterPack(context) {
  const productName = context.packager.appInfo.productFilename
  const electronBinary =
    process.platform === 'darwin'
      ? path.join(
          context.appOutDir,
          `${productName}.app`,
          'Contents',
          'MacOS',
          productName
        )
      : process.platform === 'win32'
        ? path.join(context.appOutDir, `${productName}.exe`)
        : path.join(context.appOutDir, productName)

  if (process.platform === 'win32') {
    applyWindowsBranding(electronBinary, context.packager.appInfo)
  }

  await flipFuses(electronBinary, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.LoadBrowserProcessSpecificV8Snapshot]: false
  })

  console.log(`[afterPack] Applied Electron fuses to ${electronBinary}`)
}
