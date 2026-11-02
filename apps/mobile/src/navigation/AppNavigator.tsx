/**
 * `AppNavigator` — the mobile citizen app's root (mobile-citizen-account spec, task 13.2;
 * design §1 "AppNavigator", §"Navigation decision: state-driven screen switch").
 *
 * Navigation is a tiny union-typed `Screen` state machine, NOT a navigation library: the
 * SOS grid (`EmergencyGridScreen`) is the always-mounted root and the default screen
 * (`{ name: 'grid' }`). A single secondary affordance in the grid header switches to the
 * `accountHub`; the grid stays mounted underneath so returning is free and never gated by
 * auth (R1.1/R1.3/R1.5).
 *
 * The medical calls live on `CitizenApiClient` (not the auth provider), so the resolved
 * client is lifted into `NavigatorShell` and injected into `MedicalProfileScreen`
 * (task 17.2).
 *
 * The grid renders with its frozen props/behaviour verbatim — the navigator passes NO
 * `transport`, so the grid uses its default mock-mesh transport. The grid subscribes to
 * none of the auth/connectivity state, so every Tier-0 action stays interactive before,
 * during, and after the launch session-restore (Correctness Property 1; R1.4/R6.1/R6.4).
 *
 * `client`/`store` are injectable for tests; the real app falls back to the
 * secure-store-backed `SessionStore` and the real HTTPS `CitizenApiClient`.
 */

import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { UserCircle } from 'lucide-react-native';
import { t } from '@aira/ui';

import { createCitizenClient, type CitizenApiClient } from '../api/citizenClient';
import { SessionStore as RealSessionStore, type SessionStore } from '../storage/sessionStore';
import { CitizenAuthProvider, useCitizenAuth } from '../auth/CitizenAuthContext';
import { EmergencyGridScreen } from '../screens/EmergencyGridScreen';
import { AccountHubScreen } from '../screens/AccountHubScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { LoginScreen } from '../screens/LoginScreen';
import { MedicalProfileScreen } from '../screens/MedicalProfileScreen';
import { apiBaseUrl } from '../config';

/**
 * The union-typed screen state machine (design §1 "Screen" model). The default screen is
 * always the grid. `register` / `login` / `medical` are the Secondary_Surfaces reached
 * from the account hub; `register` (task 15.2) and `login` (task 16.2) are now live,
 * `medical` lands in task 17 — until then the hub's callback for it routes to the hub
 * itself so the state stays well-typed and the grid/back invariants hold.
 */
type Screen =
  | { readonly name: 'grid' }
  | { readonly name: 'accountHub' }
  | { readonly name: 'register' }
  | { readonly name: 'login' }
  | { readonly name: 'medical' };

interface NavigatorShellProps {
  /** The resolved citizen client, injected into the medical Secondary_Surface (task 17.2). */
  readonly client: CitizenApiClient;
}

export interface AppNavigatorProps {
  /** Injectable for tests; defaults to the real secure-store-backed HTTPS client. */
  readonly client?: CitizenApiClient;
  /** Injectable for tests; defaults to the real `expo-secure-store`-backed store. */
  readonly store?: SessionStore;
}

/** Build the real client lazily so tests that inject one never touch secure storage. */
function defaultClient(store: SessionStore): CitizenApiClient {
  return createCitizenClient({ baseUrl: apiBaseUrl(), store });
}

/**
 * Inner tree rendered inside the `CitizenAuthProvider`. Owns the screen state machine and
 * runs the launch session-restore effect once on mount. The grid renders before and during
 * restore — the effect never blocks it.
 */
function NavigatorShell(props: NavigatorShellProps): JSX.Element {
  const { client } = props;
  const { restore } = useCitizenAuth();
  const [screen, setScreen] = useState<Screen>({ name: 'grid' });

  // Launch session-restore (R6.1/R6.4). Fire-and-forget: the grid is already interactive;
  // restore only updates the (grid-independent) auth state the Secondary_Surface reads.
  useEffect(() => {
    void restore();
  }, [restore]);

  return (
    <View className="flex-1 bg-ink">
      {/* The grid is the always-mounted root; it stays mounted while the hub overlays it. */}
      <EmergencyGridScreen />

      {/* The single secondary affordance: a Lucide account icon that opens the hub (R1.3). */}
      <Pressable
        testID="open-account-hub"
        onPress={() => setScreen({ name: 'accountHub' })}
        accessibilityRole="button"
        accessibilityLabel={t('citizenOpenAccount')}
        className="absolute right-5 top-14 h-10 w-10 items-center justify-center border border-line bg-raised active:opacity-75"
      >
        <UserCircle size={22} color="#9FB0C0" />
      </Pressable>

      {/*
        The account hub overlays the grid. `onOpenMedical` opens the medical
        Secondary_Surface (task 17.2). `account-hub-back` always returns to the grid with no
        auth gate (R1.5).
      */}
      {screen.name === 'accountHub' ? (
        <AccountHubScreen
          onBack={() => setScreen({ name: 'grid' })}
          onOpenRegister={() => setScreen({ name: 'register' })}
          onOpenLogin={() => setScreen({ name: 'login' })}
          onOpenMedical={() => setScreen({ name: 'medical' })}
        />
      ) : null}

      {/*
        MedicalProfileScreen (task 17.2) overlays the grid. Back returns to the account hub;
        a 401 on load/PUT drops the session — route to login (R7.9).
      */}
      {screen.name === 'medical' ? (
        <MedicalProfileScreen
          client={client}
          onBack={() => setScreen({ name: 'accountHub' })}
          onSessionExpired={() => setScreen({ name: 'login' })}
        />
      ) : null}

      {/*
        RegisterScreen (task 15.2) overlays the grid. Back returns to the account hub;
        after a successful 201 the citizen is registered — return to the grid (the survival
        core), where the account affordance now reflects the registered state.
      */}
      {screen.name === 'register' ? (
        <RegisterScreen
          onBack={() => setScreen({ name: 'accountHub' })}
          onSuccess={() => setScreen({ name: 'grid' })}
        />
      ) : null}

      {/*
        LoginScreen (task 16.2) overlays the grid. Back returns to the account hub; after a
        successful 200 the citizen is registered — return to the grid (the survival core),
        where the account affordance now reflects the registered state.
      */}
      {screen.name === 'login' ? (
        <LoginScreen
          onBack={() => setScreen({ name: 'accountHub' })}
          onSuccess={() => setScreen({ name: 'grid' })}
        />
      ) : null}
    </View>
  );
}

/**
 * The app root. Resolves the `client`/`store` (defaults to the real secure-store-backed
 * pair), wires them into the `CitizenAuthProvider`, and renders the navigator shell.
 */
export function AppNavigator(props: AppNavigatorProps): JSX.Element {
  const [store] = useState<SessionStore>(() => props.store ?? RealSessionStore);
  const [client] = useState<CitizenApiClient>(() => props.client ?? defaultClient(store));

  return (
    <CitizenAuthProvider client={client} store={store}>
      <NavigatorShell client={client} />
    </CitizenAuthProvider>
  );
}
