import './global.css';

import { StatusBar } from 'expo-status-bar';
import type { ReactElement } from 'react';

import { AppNavigator } from './src/navigation/AppNavigator';

/**
 * AIRA citizen app - offline-first SOS reporter.
 * NOTE (PRODUCT.md §2): no voice/STT, no chat, no AI. The SOS grid is the first screen
 * and is never gated by an account; account/medical surfaces are secondary.
 */
export default function App(): ReactElement {
  return (
    <>
      <StatusBar style="light" />
      <AppNavigator />
    </>
  );
}
