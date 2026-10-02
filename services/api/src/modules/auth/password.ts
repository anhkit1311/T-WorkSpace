import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const keyLength = 64;
const cost = 16_384;
const blockSize = 8;
const parallelization = 1;

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      { N: cost, r: blockSize, p: parallelization, maxmem: 64 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await deriveKey(password, salt);
  return [
    "scrypt",
    cost,
    blockSize,
    parallelization,
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, storedCost, storedBlockSize, storedParallelization, saltValue, hashValue] =
    encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    Number(storedCost) !== cost ||
    Number(storedBlockSize) !== blockSize ||
    Number(storedParallelization) !== parallelization ||
    !saltValue ||
    !hashValue
  ) {
    return false;
  }

  const storedHash = Buffer.from(hashValue, "base64url");
  if (storedHash.length !== keyLength) return false;
  const candidateHash = await deriveKey(password, Buffer.from(saltValue, "base64url"));
  return timingSafeEqual(storedHash, candidateHash);
}
