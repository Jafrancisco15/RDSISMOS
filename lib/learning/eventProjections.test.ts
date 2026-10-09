import assert from "node:assert/strict";
import test from "node:test";
import { annotateEventProjections, matchEventProjections, type ArchivedEventPrediction } from "./eventProjections";
import type { EarthquakeEvent } from "@/lib/earthquakes/types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventProjectionStatus } from "@/components/EventProjectionStatus";

const event: EarthquakeEvent = {
  id: "observed", externalId: "external-observed", sourceCatalog: "USGS", timeUtc: "2026-08-05T12:00:00Z",
  updatedUtc: "2026-08-05T12:00:00Z", latitude: 18.7, longitude: -70.1, depthKm: 20,
  magnitude: 4.8, magnitudeType: "mw", place: "Dominican Republic", countryOrRegion: "DO",
  eventType: "earthquake", status: "reviewed", network: "us",
};
const prediction: ArchivedEventPrediction = {
  id: "capsule:DO", countryName: "República Dominicana", generatedAt: "2026-08-03T12:00:00Z",
  createdAt: "2026-08-03T12:01:00Z", sourceEventExternalId: "source-event", latitude: 18.8, longitude: -70.2,
  radiusKm: 340, probabilityPct: 35, surveillanceStart: "2026-08-01T00:00:00Z",
  surveillanceEnd: "2026-08-10T23:59:59Z", magnitudeMin: 4.5, magnitudeMax: 5.2,
};

test("archived geographic, temporal and magnitude match links to the exact prediction", () => {
  const result = matchEventProjections(event, [prediction]);
  assert.equal(result.status, "projected");
  assert.equal(result.matches[0].href, "/predicciones/capsule%3ADO");
});

test("does not claim a prediction for historical reconstructions or backdated storage", () => {
  for (const patch of [
    { generatedAt: "2026-08-06T00:00:00Z" },
    { createdAt: "2026-08-06T00:00:00Z" },
    { generatedAt: event.timeUtc },
    { createdAt: event.timeUtc },
    { generatedAt: "invalid" },
  ]) assert.equal(matchEventProjections(event, [{ ...prediction, ...patch }]).status, "not_projected");
});

test("rejects source event by either catalogue ID and geographic/time misses", () => {
  for (const patch of [
    { sourceEventExternalId: event.id }, { sourceEventExternalId: event.externalId },
    { latitude: -33, longitude: -70 }, { surveillanceStart: "2026-08-06T00:00:00Z" },
    { surveillanceEnd: "2026-08-04T00:00:00Z" }, { probabilityPct: 0 },
  ]) assert.equal(matchEventProjections(event, [{ ...prediction, ...patch }]).matches.length, 0);
});

test("outside magnitude is linked but never counted as a complete hit", () => {
  const result = matchEventProjections({ ...event, magnitude: 7 }, [prediction]);
  assert.equal(result.status, "outside_range");
  assert.equal(result.matches[0].withinMagnitude, false);
});

test("complete matches lead, all matching predictions remain accessible", () => {
  const result = matchEventProjections(event, [
    { ...prediction, id: "outside", probabilityPct: 90, magnitudeMin: 6 },
    prediction,
    { ...prediction, id: "second", probabilityPct: 50 },
  ]);
  assert.equal(result.status, "projected");
  assert.deepEqual(result.matches.map((match) => match.id), ["second", "capsule:DO", "outside"]);
});

test("closed windows and magnitude boundaries are inclusive", () => {
  assert.equal(matchEventProjections({ ...event, timeUtc: prediction.surveillanceEnd, magnitude: prediction.magnitudeMax }, [prediction]).status, "projected");
});

test("matches use the same minimum displayed by the historical globe", () => {
  assert.equal(matchEventProjections({ ...event, magnitude: 4 }, [{ ...prediction, magnitudeMin: 3.8 }]).status, "outside_range");
});

test("rendered status exposes the archived link and never calls unknown data a miss", () => {
  const markup = renderToStaticMarkup(createElement(EventProjectionStatus, { projection: matchEventProjections(event, [prediction]) }));
  assert.match(markup, /Sí · proyectado/);
  assert.match(markup, /href="\/predicciones\/capsule%3ADO"/);
  assert.match(renderToStaticMarkup(createElement(EventProjectionStatus)), /Sin verificar/);
});

test("missing database leaves verification unknown, never a false negative", async () => {
  const original = process.env.DATABASE_URL;
  try {
    delete process.env.DATABASE_URL;
    const result = await annotateEventProjections([event]);
    assert.equal(result.events[0].projection?.status, "unavailable");
    assert.ok(result.warning);
    assert.deepEqual(await annotateEventProjections([]), { events: [] });
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  }
});
