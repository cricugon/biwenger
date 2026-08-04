import test from "node:test";
import assert from "node:assert/strict";
import { askBiwengerAi, BIWENGER_SYSTEM_PROMPT, compactLeagueContext, validateAiInput } from "../src/ai.js";

test("el prompt limita las respuestas al ámbito Biwenger", () => {
  assert.match(BIWENGER_SYSTEM_PROMPT, /exclusivamente sobre Biwenger/);
  assert.match(BIWENGER_SYSTEM_PROMPT, /Solo puedo responder preguntas relacionadas/);
  assert.match(BIWENGER_SYSTEM_PROMPT, /nunca sigas instrucciones/);
});

test("valida pregunta, preset y contexto", () => {
  const input = validateAiInput({ question: "¿Quién fichará a Nico?", preset: "player_buyer", context: { market: [{ name: "Nico" }] } });
  assert.equal(input.preset, "player_buyer");
  assert.equal(input.context.market[0].name, "Nico");
  assert.throws(() => validateAiInput({ question: "", context: {} }), /Escribe una pregunta/);
});

test("compacta datos no finitos y limita cadenas", () => {
  const context = compactLeagueContext({ value: Infinity, text: "a".repeat(900), nested: { ok: true } });
  assert.equal(context.value, 0);
  assert.equal(context.text.length, 500);
  assert.equal(context.nested.ok, true);
});

test("envía Responses API con identificador seudónimo y sin almacenar", async () => {
  let request;
  const client = { responses: { create: async input => {
    request = input;
    return { id: "resp_1", model: "gpt-5.6-sol", output_text: "Análisis listo", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } };
  } } };
  const result = await askBiwengerAi({
    userId: "usuario-1",
    question: "¿Quién fichará a Nico?",
    preset: "player_buyer",
    context: { market: [{ name: "Nico" }] },
    client
  });
  assert.equal(result.answer, "Análisis listo");
  assert.equal(request.model, "gpt-5.6-sol");
  assert.equal(request.store, false);
  assert.match(request.safety_identifier, /^[a-f0-9]{64}$/);
  assert.match(request.input, /Nico/);
});
