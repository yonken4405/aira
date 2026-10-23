/**
 * Medical profile persistence port (SECURITY.md §8). The store only ever handles the
 * opaque ciphertext envelope - never plaintext profile fields.
 */

export interface MedicalProfileRow {
  readonly citizenId: string;
  readonly ciphertext: string;
  readonly version: number;
  readonly updatedAt: number;
}

export interface MedicalStore {
  find(citizenId: string): Promise<MedicalProfileRow | null>;
  /** Insert or overwrite the citizen's single encrypted profile row. */
  upsert(input: {
    readonly citizenId: string;
    readonly ciphertext: string;
  }): Promise<MedicalProfileRow>;
  remove(citizenId: string): Promise<void>;
}
