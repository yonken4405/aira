import './global.css';

import { StatusBar } from 'expo-status-bar';
import type { ReactElement } from 'react';

import { EmergencyGridScreen } from './src/screens/EmergencyGridScreen';

/**
 * AIRA citizen app - offline-first SOS reporter.
 * NOTE (PRODUCT.md §2): no voice/STT, no chat, no AI. One screen, four buttons.
 */
export default function App(): ReactElement {
  return (
    <>
      <StatusBar style="light" />
      <EmergencyGridScreen />
    </>
  );
}
