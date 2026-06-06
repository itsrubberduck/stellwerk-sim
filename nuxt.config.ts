// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: false },
  ssr: false,
  nitro: {
    experimental: {
      websocket: true
    }
  },
  app: {
    head: {
      title: 'ICE-Stellwerk-Chaos',
      viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
      meta: [
        { name: 'theme-color', content: '#0c0f12' }
      ]
    }
  }
})
