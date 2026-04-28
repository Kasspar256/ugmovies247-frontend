import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ugmovies247.app',
  appName: 'UG Movies 247',
  webDir: 'mobile-shell',
  server: {
    url: 'https://ugmovies247.com',
    cleartext: false,
  },
  android: {
    backgroundColor: '#0B0C10',
    minWebViewVersion: 90,
  },
  plugins: {
    FirebaseAuthentication: {
      skipNativeAuth: false,
      providers: ['google.com'],
    },
  },
};

export default config;
