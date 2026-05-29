import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ugmovies247.app',
  appName: 'Ugmovies247',
  webDir: 'mobile-shell',
  server: {
    url: 'https://ugmovies247.com/browse',
    errorPath: 'offline.html',
    cleartext: false,
  },
  appendUserAgent: ' Ugmovies247App',
  android: {
    backgroundColor: '#0B0C10',
    minWebViewVersion: 90,
  },
  plugins: {
    Badge: {
      persist: true,
      autoClear: false,
    },
    FirebaseAuthentication: {
      authDomain: 'ugmovies247k.firebaseapp.com',
      skipNativeAuth: false,
      providers: ['google.com'],
    },
    LocalNotifications: {
      smallIcon: 'ic_launcher',
      iconColor: '#D90429',
    },
  },
};

export default config;

