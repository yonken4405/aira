/**
 * `AccountHubScreen` — the citizen account Secondary_Surface (mobile-citizen-account
 * spec, task 14.2; design §5 "Screens → AccountHubScreen").
 *
 * This is the Tier-2 entry point reached from the SOS grid's account affordance. It
 * reads auth from `useCitizenAuth()` and renders:
 *   - anonymous: Register / Login / Continue-without-an-email (device key) rows (R1.3/R2.1);
 *   - registered: the citizen email (if any), Medical profile, Sign out, Delete account
 *     rows (R5/R10.6).
 *
 * Every Tier-2 row is a thin wrapper that, while `connectivity === 'offline'`, renders an
 * honest "unavailable offline" sibling and makes the row inert — no navigation, no auth
 * call (R11.1/R11.2). The back-to-grid affordance is NEVER a Tier-2 row: it is always
 * available, even offline, so returning to the survival core is never gated (R1.5/R11.3).
 *
 * Sign out and Delete account are confirm-first: tapping the row opens an in-screen
 * confirm (the RN equivalent of `ConfirmDialog`); the auth method is only called once the
 * user confirms (R5.5/R10.6). Sign out always returns to the grid — `logout()` clears the
 * local session even if the backend is unreachable, and the screen invokes `onBack` so the
 * citizen lands back on the grid regardless.
 *
 * Operate Mode (DESIGN.md): tokens via NativeWind, Lucide icons via `lucide-react-native`,
 * no gradients/glow/bounce, and NO voice/chat/AI affordance (R12.6/R12.7). All copy goes
 * through `t()` from `@aira/ui` — no string literals (R12.5).
 */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import {
  ChevronLeft,
  ChevronRight,
  HeartPulse,
  KeyRound,
  LogIn,
  LogOut,
  Trash2,
  UserPlus,
} from 'lucide-react-native';
import { t, type MessageKey } from '@aira/ui';

import { useCitizenAuth } from '../auth/CitizenAuthContext';

export interface AccountHubScreenProps {
  /** Anonymous: open the register Secondary_Surface. */
  readonly onOpenRegister: () => void;
  /** Anonymous: open the login Secondary_Surface. */
  readonly onOpenLogin: () => void;
  /** Registered: open the medical Secondary_Surface. */
  readonly onOpenMedical: () => void;
  /** Always: return to the SOS grid (never gated, R1.5). */
  readonly onBack: () => void;
}

/** Icon tint used for Lucide glyphs — the muted token value (DESIGN.md §2). */
const ICON_TINT = '#9FB0C0';
/** Destructive tint (error token) for the delete-account row. */
const DANGER_TINT = '#F2555A';

type RowTone = 'default' | 'danger';

interface AccountRowProps {
  readonly testID: string;
  readonly label: MessageKey;
  readonly icon: React.ReactNode;
  readonly onPress: () => void;
  /** When true, the row is a Tier-2 surface and degrades to "unavailable" offline. */
  readonly offline: boolean;
  readonly tone?: RowTone;
}

/**
 * A single tappable account row. When `offline` is true it renders an honest
 * "unavailable offline" sibling (`testID="<testID>-offline"`) and the press is inert —
 * no navigation, no auth call (R11.1/R11.2). The offline node is present on first
 * synchronous render.
 */
function AccountRow(props: AccountRowProps): JSX.Element {
  const { testID, label, icon, onPress, offline, tone = 'default' } = props;
  const labelTone = tone === 'danger' ? 'text-status-error' : 'text-fg';

  return (
    <View>
      <Pressable
        testID={testID}
        onPress={offline ? undefined : onPress}
        disabled={offline}
        accessibilityRole="button"
        accessibilityState={{ disabled: offline }}
        accessibilityLabel={t(label)}
        className={`flex-row items-center gap-3 border border-line bg-raised px-4 py-4 active:opacity-75 ${
          offline ? 'opacity-50' : ''
        }`}
      >
        {icon}
        <Text className={`flex-1 text-base font-bold ${labelTone}`}>{t(label)}</Text>
        {offline ? null : <ChevronRight size={18} color={ICON_TINT} />}
      </Pressable>

      {offline ? (
        <View testID={`${testID}-offline`} className="mt-1 px-1">
          <Text className="text-[11px] font-bold uppercase text-muted">
            {t('citizenOfflineTitle')}
          </Text>
          <Text className="mt-0.5 text-xs text-muted">{t('citizenOfflineUnavailable')}</Text>
        </View>
      ) : null}
    </View>
  );
}

interface ConfirmDialogProps {
  readonly title: MessageKey;
  readonly body: MessageKey;
  readonly confirmLabel: MessageKey;
  readonly confirmTestID: string;
  readonly cancelTestID: string;
  readonly tone: RowTone;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * In-screen confirm dialog — the RN equivalent of the web `ConfirmDialog`. An absolutely
 * positioned scrim + card so the confirmation is modal within the hub. The confirm action
 * is only wired to the auth method here, so the method is never called before confirm
 * (R5.5/R10.6).
 */
function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  const { title, body, confirmLabel, confirmTestID, cancelTestID, tone, onConfirm, onCancel } =
    props;
  const confirmClass =
    tone === 'danger' ? 'border border-status-error bg-raised' : 'border border-line bg-raised';
  const confirmText = tone === 'danger' ? 'text-status-error' : 'text-fg';

  return (
    <View className="absolute inset-0 items-center justify-center bg-ink/80 px-6">
      <View className="w-full border border-line bg-surface p-5">
        <Text className="text-lg font-extrabold text-fg">{t(title)}</Text>
        <Text className="mt-2 text-sm text-muted">{t(body)}</Text>
        <View className="mt-5 flex-row justify-end gap-3">
          <Pressable
            testID={cancelTestID}
            onPress={onCancel}
            accessibilityRole="button"
            accessibilityLabel={t('cancelAction')}
            className="border border-line bg-raised px-4 py-3 active:opacity-75"
          >
            <Text className="text-sm font-bold text-fg">{t('cancelAction')}</Text>
          </Pressable>
          <Pressable
            testID={confirmTestID}
            onPress={onConfirm}
            accessibilityRole="button"
            accessibilityLabel={t(confirmLabel)}
            className={`px-4 py-3 active:opacity-75 ${confirmClass}`}
          >
            <Text className={`text-sm font-bold ${confirmText}`}>{t(confirmLabel)}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Which confirm dialog, if any, is currently open. */
type Dialog = 'none' | 'signout' | 'delete';

export function AccountHubScreen(props: AccountHubScreenProps): JSX.Element {
  const { onOpenRegister, onOpenLogin, onOpenMedical, onBack } = props;
  const { state, connectivity, deviceAuth, logout, deleteAccount } = useCitizenAuth();

  const [dialog, setDialog] = useState<Dialog>('none');

  const offline = connectivity === 'offline';

  const confirmSignOut = (): void => {
    setDialog('none');
    // Logout clears local state and returns to the grid even if the backend is
    // unreachable (R5.3): fire-and-forget the auth call, then return to the grid.
    void logout();
    onBack();
  };

  const confirmDelete = (): void => {
    setDialog('none');
    // On success the provider clears both secrets and flips to anonymous; return the
    // citizen to the grid either way (R10.6).
    void deleteAccount();
    onBack();
  };

  return (
    <View className="absolute inset-0 bg-ink">
      {/* Header — the back affordance is ALWAYS available, never a Tier-2 row (R1.5). */}
      <View className="border-b border-line bg-surface px-5 pb-4 pt-14">
        <View className="flex-row items-center gap-3">
          <Pressable
            testID="account-hub-back"
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={t('citizenBack')}
            className="h-10 w-10 items-center justify-center border border-line bg-raised active:opacity-75"
          >
            <ChevronLeft size={22} color={ICON_TINT} />
          </Pressable>
          <Text className="text-lg font-extrabold text-fg">{t('citizenAccountTitle')}</Text>
        </View>
      </View>

      <View className="flex-1 gap-3 p-4">
        {state.kind === 'registered' ? (
          <>
            {state.citizen.email !== null ? (
              <View className="border border-line bg-raised px-4 py-3">
                <Text className="text-[11px] font-bold uppercase text-muted">
                  {t('citizenEmailLabel')}
                </Text>
                <Text testID="account-email" className="mt-0.5 text-base font-bold text-fg">
                  {state.citizen.email}
                </Text>
              </View>
            ) : null}

            <AccountRow
              testID="account-row-medical"
              label="citizenMedicalTitle"
              icon={<HeartPulse size={20} color={ICON_TINT} />}
              onPress={onOpenMedical}
              offline={offline}
            />
            <AccountRow
              testID="account-row-signout"
              label="citizenSignOut"
              icon={<LogOut size={20} color={ICON_TINT} />}
              onPress={() => setDialog('signout')}
              offline={false}
            />
            <AccountRow
              testID="account-row-delete"
              label="citizenDeleteAccount"
              icon={<Trash2 size={20} color={DANGER_TINT} />}
              onPress={() => setDialog('delete')}
              offline={offline}
              tone="danger"
            />
          </>
        ) : (
          <>
            <AccountRow
              testID="account-row-register"
              label="citizenRegister"
              icon={<UserPlus size={20} color={ICON_TINT} />}
              onPress={onOpenRegister}
              offline={offline}
            />
            <AccountRow
              testID="account-row-login"
              label="citizenLogin"
              icon={<LogIn size={20} color={ICON_TINT} />}
              onPress={onOpenLogin}
              offline={offline}
            />
            <AccountRow
              testID="account-row-device-key"
              label="citizenUseDeviceKey"
              icon={<KeyRound size={20} color={ICON_TINT} />}
              onPress={() => {
                void deviceAuth();
              }}
              offline={offline}
            />
          </>
        )}
      </View>

      {dialog === 'signout' ? (
        <ConfirmDialog
          title="citizenSignOutConfirmTitle"
          body="citizenSignOutConfirmBody"
          confirmLabel="citizenSignOut"
          confirmTestID="account-signout-confirm"
          cancelTestID="account-signout-cancel"
          tone="default"
          onConfirm={confirmSignOut}
          onCancel={() => setDialog('none')}
        />
      ) : null}

      {dialog === 'delete' ? (
        <ConfirmDialog
          title="citizenDeleteAccountConfirmTitle"
          body="citizenDeleteAccountConfirmBody"
          confirmLabel="citizenDeleteAccount"
          confirmTestID="account-delete-confirm"
          cancelTestID="account-delete-cancel"
          tone="danger"
          onConfirm={confirmDelete}
          onCancel={() => setDialog('none')}
        />
      ) : null}
    </View>
  );
}
