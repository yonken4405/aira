/** `@aira/ui/web` - shared Tailwind components for the responder dashboard (DOM only). */

export { cn } from '../cn';

export { Panel, type PanelProps } from './Panel';
export { CategoryBadge, type CategoryBadgeProps } from './CategoryBadge';
export { MetricRow, type MetricRowProps } from './MetricRow';
export { EmergencyIcon, type EmergencyIconProps } from './EmergencyIcon';

export { Button, buttonVariants, type ButtonProps } from './ui/button';
export {
  Field,
  Input,
  Select,
  type FieldProps,
  type InputProps,
  type SelectProps,
} from './ui/field';
export {
  Textarea,
  Checkbox,
  Radio,
  Switch,
  type TextareaProps,
  type CheckboxProps,
  type RadioProps,
  type SwitchProps,
} from './ui/controls';
export { Skeleton } from './ui/skeleton';
export {
  ToastProvider,
  useToast,
  useOptionalToast,
  type ToastInput,
  type ToastTone,
} from './ui/toast';
export { ConfirmDialog, type ConfirmDialogProps } from './ui/confirm-dialog';
export { NavLink, type NavLinkProps, type NavMatch } from './ui/nav-link';
export {
  ThemeProvider,
  useTheme,
  ThemeToggle,
  type ThemePreference,
  type ResolvedTheme,
  type ThemeContextValue,
  type ThemeToggleProps,
} from './theme';
