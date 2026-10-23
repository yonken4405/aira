import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Class-name helper shared by both apps (conflict-aware merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
