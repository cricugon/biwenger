import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("el acceso administrativo muestra progreso, errores y tiene respaldo", async () => {
  const html = await readFile(new URL("../public/admin/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../public/admin/admin.js", import.meta.url), "utf8");
  assert.match(html, /id="login-status"/);
  assert.match(html, /Modo de acceso compatible activo/);
  assert.match(html, /\[hidden\]\{display:none!important\}/);
  assert.match(html, /admin\.js\?v=1\.3\.3/);
  assert.match(script, /Comprobando credenciales/);
  assert.match(script, /window\.adminMainHandlesLogin = true/);
});
