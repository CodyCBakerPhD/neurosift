import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  // Served from a domain root in production, so "/" is the default and the
  // production build is unaffected. A host that serves the app from a
  // sub-directory (a GitHub Pages project site at /<repo>/, for instance)
  // sets NEUROSIFT_BASE_PATH to that prefix; the router picks the same value
  // up as its basename via import.meta.env.BASE_URL.
  base: process.env.NEUROSIFT_BASE_PATH || '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@css': path.resolve(__dirname, './src/css'),
      '@components': path.resolve(__dirname, './src/components'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@remote-h5-file': path.resolve(__dirname, './src/remote-h5-file'),
      '@hdf5Interface': path.resolve(__dirname, './src/pages/NwbPage/hdf5Interface'),
      "@jobManager": path.resolve(__dirname, "./src/jobManager")
    }
  },
  test: {
    // Only the front end's tests run here. The Python package's file server
    // and the job runners carry their own node:test suites, which vitest
    // would otherwise pick up and report as empty.
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
