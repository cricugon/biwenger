import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, normalizeEmail, publicUser, validateRegistration, verifyPassword } from "../src/auth.js";

test("normaliza y valida los datos de registro", () => {
  const result = validateRegistration({
    email: "  PERSONA@Ejemplo.COM ",
    displayName: "  Ana   Manager ",
    password: "una-clave-segura"
  });
  assert.equal(result.email, "persona@ejemplo.com");
  assert.equal(result.displayName, "Ana Manager");
  assert.equal(normalizeEmail("A@B.COM"), "a@b.com");
});

test("scrypt verifica la clave sin almacenarla en claro", async () => {
  const encoded = await hashPassword("una-clave-segura");
  assert.match(encoded, /^scrypt\$/);
  assert.equal(encoded.includes("una-clave-segura"), false);
  assert.equal(await verifyPassword("una-clave-segura", encoded), true);
  assert.equal(await verifyPassword("otra-clave", encoded), false);
});

test("las cuentas se exponen con saldo limitado", () => {
  const user = publicUser({ _id: "abc", email: "a@b.com", displayName: "Ana", credits: { unlimited: true, balance: 4 } });
  assert.deepEqual(user.credits, { unlimited: false, balance: 4 });
});
