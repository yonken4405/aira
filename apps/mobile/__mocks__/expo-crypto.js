// Jest manual mock for expo-crypto (jest-expo does not provide one).
// getRandomBytes is the only surface the app uses (CSPRNG bytes for
// generateDeviceKey). The mock returns a deterministic, overridable byte
// sequence so device-key generation is reproducible under test. The real
// module is a CSPRNG; tests inject determinism, never rely on this for entropy.
let fill = (i) => i & 0xff;

const getRandomBytes = jest.fn((byteCount) => {
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i += 1) {
    bytes[i] = fill(i) & 0xff;
  }
  return bytes;
});

const getRandomBytesAsync = jest.fn(async (byteCount) => getRandomBytes(byteCount));

// Test helper: control the bytes getRandomBytes returns, e.g. __setRandomBytes(() => 0).
function __setRandomBytes(fillFn) {
  fill = fillFn;
}

function __resetCrypto() {
  fill = (i) => i & 0xff;
  getRandomBytes.mockClear();
  getRandomBytesAsync.mockClear();
}

module.exports = {
  getRandomBytes,
  getRandomBytesAsync,
  __setRandomBytes,
  __resetCrypto,
};
