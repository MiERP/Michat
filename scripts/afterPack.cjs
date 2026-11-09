const path = require('path')
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses')

/**
 * electron-builder afterPack hook: disable Node/debug entry points and require
 * the packaged app to be loaded from the asar archive.
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
