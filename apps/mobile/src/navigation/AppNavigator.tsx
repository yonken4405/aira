import type { CitizenAuthState, Connectivity, MockMeshTransport } from '@aira/ui';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { View } from 'react-native';

import type { CitizenApiClient } from '../api/citizenClient';
import { CitizenAuthProvider, useCitizenAuth } from '../auth/CitizenAuthContext';
import { AccountHubScreen } from '../screens/AccountHubScreen';
import { EmergencyGridScreen } from '../screens/EmergencyGridScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MedicalProfileScreen } from '../screens/MedicalProfileScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import type { SessionStore } from '../storage/sessionStore';

type Screen =
  | { readonly name: 'grid' }
  | { readonly name: 'accountHub' }
  | { readonly name: 'register' }
  | { readonly name: 'login' }
  | { readonly name: 'medical' };

export interface AppNavigatorProps {
  /** Injectable for tests; defaults to the secure-store-backed client. */
  readonly client?: CitizenApiClient;
  readonly store?: SessionStore;
  readonly generateKey?: () => string;
  /** Test-only initial auth state (Property 1 drives every combination). */
  readonly initialState?: CitizenAuthState;
  readonly initialConnectivity?: Connectivity;
  /** Injectable mesh transport for tests; defaults to the mock transport. */
  readonly transport?: MockMeshTransport;
}

function NavigatorInner({ transport }: { readonly transport?: MockMeshTransport }): ReactElement {
  const { restore } = useCitizenAuth();
  const [screen, setScreen] = useState<Screen>({ name: 'grid' });

  // Launch session-restore runs in the background; the grid is already interactive
  // and never waits for it (R1.1/R6.4).
  useEffect(() => {
    void restore();
  }, [restore]);

  const toGrid = useCallback(() => setScreen({ name: 'grid' }), []);
  const toHub = useCallback(() => setScreen({ name: 'accountHub' }), []);
  const toRegister = useCallback(() => setScreen({ name: 'register' }), []);
  const toLogin = useCallback(() => setScreen({ name: 'login' }), []);
  const toMedical = useCallback(() => setScreen({ name: 'medical' }), []);

  return (
    <View className="flex-1 bg-ink">
      {/* Root Tier-0 surface: always mounted, never gated by auth or connectivity. */}
      <EmergencyGridScreen onOpenAccount={toHub} transport={transport} />

      {screen.name !== 'grid' ? (
        <View className="absolute inset-0 bg-ink">
          {screen.name === 'accountHub' ? (
            <AccountHubScreen
              onClose={toGrid}
              onRegister={toRegister}
              onLogin={toLogin}
              onMedical={toMedical}
              onDeleted={toGrid}
            />
          ) : null}
          {screen.name === 'register' ? <RegisterScreen onBack={toHub} onSuccess={toHub} /> : null}
          {screen.name === 'login' ? <LoginScreen onBack={toHub} onSuccess={toHub} /> : null}
          {screen.name === 'medical' ? (
            <MedicalProfileScreen onBack={toHub} onSessionExpired={toLogin} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Root navigator: state-driven screen switch over the always-mounted SOS grid. */
export function AppNavigator({
  client,
  store,
  generateKey,
  initialState,
  initialConnectivity,
  transport,
}: AppNavigatorProps): ReactElement {
  return (
    <CitizenAuthProvider
      client={client}
      store={store}
      generateKey={generateKey}
      initialState={initialState}
      initialConnectivity={initialConnectivity}
    >
      <NavigatorInner transport={transport} />
    </CitizenAuthProvider>
  );
}
