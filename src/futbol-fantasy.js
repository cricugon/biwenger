import * as cheerio from "cheerio";
import { config } from "./config.js";
import { dateAtOffset, safeValue } from "./utils.js";

const OFFSETS = [0, 1, 2, 3, 7, 14, 30];

async function fetchHtml(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "es-ES,es;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; BiwengerSaldoValues/1.0; personal analytics)"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`FútbolFantasy respondió HTTP ${response.status}`);
  const html = await response.text();
  if (html.length > 8_000_000) throw new Error("La respuesta de FútbolFantasy es demasiado grande");
  return html;
}

function sourceDate(html) {
  const match = html.match(/Última\s+actualización:\s*(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}:\d{2}))?/i);
  if (!match) return { date: new Date().toISOString().slice(0, 10), label: "" };
  return { date: `${match[3]}-${match[2]}-${match[1]}`, label: `${match[1]}/${match[2]}/${match[3]}${match[4] ? ` ${match[4]}` : ""}` };
}

export function parseFantasyMarket(html) {
  const $ = cheerio.load(html);
  const updated = sourceDate(html);
  const players = [];
  $("tr").each((_, row) => {
    const element = $(row);
    const classes = String(element.attr("class") || "");
    if (!classes.includes("elemento_jugador")) return;
    const id = String(element.attr("data-id") || "").trim();
    const name = element.find(".player-name span").first().text().trim() || String(element.attr("data-nombre") || "").trim();
    if (!id || !name) return;
    const values = {};
    for (const offset of OFFSETS) {
      const field = offset === 0 ? "data-valor" : `data-valor${offset}`;
      const value = safeValue(element.attr(field));
      if (value) values[dateAtOffset(updated.date, offset)] = value;
    }
    players.push({
      id, name,
      position: String(element.attr("data-posicion") || ""),
      teamId: String(element.attr("data-equipo") || ""),
      team: element.find(".player-equipo span").first().text().trim(),
      values
    });
  });
  if (players.length < 100) throw new Error("La tabla de FútbolFantasy no tiene el formato esperado");
  return { players, sourceUpdatedAt: updated.label, sourceDate: updated.date };
}

function detailDate(day, month, baseDate) {
  const base = new Date(`${baseDate}T12:00:00Z`);
  let candidate = new Date(Date.UTC(base.getUTCFullYear(), month - 1, day, 12));
  if (candidate.getTime() > base.getTime() + 2 * 86400000) {
    candidate = new Date(Date.UTC(base.getUTCFullYear() - 1, month - 1, day, 12));
  }
  return candidate.toISOString().slice(0, 10);
}

export function parseFantasyDetail(html, baseDate) {
  const values = {};
  const pattern = /player_chartjs\.push\s*\(\s*\{\s*date\s*:\s*["'](\d{2})\/(\d{2})["']\s*,\s*value\s*:\s*(\d+)/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const value = safeValue(match[3]);
    if (value) values[detailDate(Number(match[1]), Number(match[2]), baseDate)] = value;
  }
  return values;
}

export async function downloadFantasyMarket() {
  return parseFantasyMarket(await fetchHtml(config.fantasyUrl));
}

export async function downloadFantasyDetail(id, baseDate) {
  return parseFantasyDetail(await fetchHtml(`${config.fantasyUrl}/detalle/${encodeURIComponent(id)}/biwenger`), baseDate);
}
