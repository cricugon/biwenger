import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("la tienda muestra paquetes, saldo y confirmación de compra", async () => {
  const html = await readFile(new URL("../public/store/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/store/store.js", import.meta.url), "utf8");
  assert.match(html, /id="products"/);
  assert.match(html, /Pago seguro con Stripe/);
  assert.match(html, /id="result-balance"/);
  assert.match(script, /\/api\/v1\/billing\/checkout/);
  assert.match(script, /\/api\/v1\/billing\/purchase-status/);
  assert.doesNotMatch(script, /sk_live_|whsec_/);
});
