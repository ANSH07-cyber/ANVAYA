import { computeSha256, verifyAudioBlobIntegrity } from "../sarvamAudioPreview.ts";

function equal<T>(actual: T, expected: T, message: string) {
  if (!Object.is(actual, expected)) throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

// 1. Verify computeSha256 against known test vector
// SHA-256 of empty string is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
const emptyBuffer = new Uint8Array(0);
const emptyHash = await computeSha256(emptyBuffer);
equal(
  emptyHash,
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "Empty buffer SHA-256 matches NIST test vector",
);

// 2. Verify against "ANVAYA-STAGE-3L"
const sampleData = new TextEncoder().encode("ANVAYA-STAGE-3L-AUDIO-CHECK");
const sampleHash = await computeSha256(sampleData);
equal(typeof sampleHash === "string" && sampleHash.length === 64, true, "SHA-256 digest is 64 hex characters");

// 3. Test integrity verification success
const matching = await verifyAudioBlobIntegrity(sampleData.buffer, sampleHash);
equal(matching.valid, true, "Matching SHA-256 passes verification");
equal(matching.actualSha256, sampleHash, "Reported actual hash matches calculated digest");

// 4. Test integrity verification failure on tampered data
const corrupted = new Uint8Array(sampleData);
corrupted[0] ^= 0xff; // flip bits
const mismatch = await verifyAudioBlobIntegrity(corrupted.buffer, sampleHash);
equal(mismatch.valid, false, "Corrupted audio buffer is flagged as invalid");
equal(mismatch.actualSha256 !== sampleHash, true, "Mismatch hash differs from expected");

// 5. Test case-insensitivity of hex comparison
const upperExpected = sampleHash.toUpperCase();
const caseCheck = await verifyAudioBlobIntegrity(sampleData.buffer, upperExpected);
equal(caseCheck.valid, true, "Hash comparison is robustly case-insensitive");

console.log("Sarvam audio preview unit tests passed successfully!");
