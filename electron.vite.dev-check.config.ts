import config from './electron.vite.config'

export default {
  ...config,
  renderer: {
    ...config.renderer,
    cacheDir: '.dev-check-vite-cache'
  }
}
