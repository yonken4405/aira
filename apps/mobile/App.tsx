import './global.css';

import { StatusBar } from 'expo-status-bar';
import type { ReactElement } from 'react';

import { AppNavigator } from './src/navigation/AppNavigator';

/**
 * AIRA citizen app - offline-first SOS reporter.
 * NOTE (PRODUCT.md §2): no voice/STT, no chat, no AI. The SOS grid is the always-mounted
 * root screen; `AppNavigator` adds the account affordance / Secondary_Surfaces and wraps
 * the tree in `CitizenAuthProvider` internally (R1.1/R1.7).
 */
export default function App(): ReactElement {
  return (
    <>
      <StatusBar style="light" />
      <AppNavigator />
    </>
  );
}
