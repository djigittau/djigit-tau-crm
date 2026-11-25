import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' — приложение работает из любой папки, в том числе на GitHub Pages /djigit-tau-crm/.
export default defineConfig({ plugins: [react()], base: './' })
