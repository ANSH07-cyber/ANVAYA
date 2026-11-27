import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { normalize, resolve } from 'node:path'
import { educationAudioAssets, validAudioManifest } from './src/components/skinHealth/audioManifest.ts'
import { educationVideos, validVideoManifest } from './src/components/skinHealth/videoManifest.ts'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'verify-bundled-skin-media',
      apply: 'build',
      async writeBundle(options) {
        if (!validVideoManifest(educationVideos)) this.error('Invalid skin education video manifest')
        if (!validAudioManifest(educationAudioAssets)) this.error('Invalid skin education audio manifest')
        if (!options.dir) this.error('Missing build output directory')
        for (const asset of educationVideos) {
          for (const [path, digest] of [[asset.video, asset.videoSha256], [asset.captions.src, asset.captions.sha256]]) {
            const bytes = await readFile(resolve(options.dir, '.' + path))
            if (createHash('sha256').update(bytes).digest('hex') !== digest) this.error('Skin education asset checksum mismatch: ' + path)
          }
        }
        for (const asset of educationAudioAssets) {
          const bytes = await readFile(resolve(options.dir, '.' + asset.audio))
          if (createHash('sha256').update(bytes).digest('hex') !== asset.audioSha256) {
            this.error('Skin education audio checksum mismatch: ' + asset.audio)
          }
        }
      },
    },
    {
      name: 'internal-sarvam-audio-preview',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use('/internal-review-audio', async (req, res, next) => {
          try {
            const rawUrl = req.url || ''
            const parsed = new URL(rawUrl, 'http://localhost')
            const pathname = parsed.pathname
            if (pathname === '/inventory.json' || pathname === '/inventory') {
              const invPath = resolve('../internal_review/sarvam_stage3l_v1/audio_inventory.json')
              const bytes = await readFile(invPath)
              res.setHeader('Content-Type', 'application/json')
              res.setHeader('Cache-Control', 'no-store')
              res.end(bytes)
              return
            }
            if (pathname.startsWith('/file/')) {
              const rel = pathname.slice('/file/'.length)
              const safeRel = normalize(rel).replace(/^(\.\.[/\\])+/, '')
              const baseDir = resolve('../internal_review/sarvam_stage3l_v1')
              const filePath = resolve(baseDir, safeRel)
              if (!filePath.startsWith(baseDir)) {
                res.statusCode = 403
                res.end('Forbidden')
                return
              }
              const bytes = await readFile(filePath)
              res.setHeader('Content-Type', 'audio/mpeg')
              res.setHeader('Cache-Control', 'no-store')
              res.end(bytes)
              return
            }
            next()
          } catch {
            res.statusCode = 404
            res.end('Not found')
          }
        })
      },
    },
  ],

  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL || 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
