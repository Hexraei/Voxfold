import react from '@vitejs/plugin-react'
import { voxfold } from '@voxfold/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), voxfold()],
})
