export function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sameTokenSet(left, right) {
  const leftTokens = new Set(normalizeName(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalizeName(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return false;
  const leftInsideRight = [...leftTokens].every(token => rightTokens.has(token));
  const rightInsideLeft = [...rightTokens].every(token => leftTokens.has(token));
  return leftInsideRight || rightInsideLeft;
}

export function playerMatchScore(requested, candidate) {
  const requestedName = normalizeName(requested && requested.name);
  const candidateName = normalizeName(candidate && candidate.name);
  if (!requestedName || !candidateName) return -1;

  const requestedId = String(requested && requested.id || "").trim();
  const sourceIds = candidate && candidate.sourceIds || {};
  const biwengerIds = Array.isArray(sourceIds.biwenger) ? sourceIds.biwenger.map(String) : [];
  if (requestedId && biwengerIds.includes(requestedId)) return 2_000;

  const requestedTeam = normalizeName(requested && requested.team);
  const candidateTeam = normalizeName(candidate && candidate.team);
  const teamMatches = requestedTeam && candidateTeam && sameTokenSet(requestedTeam, candidateTeam);
  if (requestedTeam && candidateTeam && !teamMatches) return -1;

  if (requestedName === candidateName) return 1_500 + (teamMatches ? 100 : 0) + (sourceIds.futbolFantasy ? 200 : 0);
  if (!sameTokenSet(requestedName, candidateName)) return -1;

  const requestedTokens = requestedName.split(" ");
  if (requestedTokens.length < 2 && !teamMatches) return -1;
  const extraTokens = Math.abs(candidateName.split(" ").length - requestedTokens.length);
  return 1_400 - extraTokens * 10 + (teamMatches ? 100 : 0) + (sourceIds.futbolFantasy ? 200 : 0);
}

export function safeValue(value) {
  const parsed = Number.parseInt(String(value || "").replace(/[^0-9]/g, ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed < 1_000_000_000 ? parsed : 0;
}

export function madridParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function dateAtOffset(baseDate, days) {
  const date = new Date(`${baseDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function earliestDate(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Math.max(1, days));
  return date.toISOString().slice(0, 10);
}

export function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2);
}

export function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
