import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.themasters.pos',
  appName: 'TheMasters POS',
  webDir: 'dist',

  android: {
    allowMixedContent: true,
    backgroundColor: '#ffffff',
    adjustResize: true
  }
};

export default config;
