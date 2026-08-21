import assert from "node:assert/strict";
import test from "node:test";
import {
  angleDifference180,
  bestFaultCompatibility,
  faultStyle,
  mechanismStyle,
  nearestPointOnFault,
  type ActiveFaultFeature,
} from "./activeFaults";
import type { SeismicMechanism } from "./seismicMechanisms";

const fault: ActiveFaultFeature = {
  type: "Feature",
  id: "test-fault",
  properties: {
    id: "test-fault",
    name: "Falla prueba",
    faultZoneName: null,
    slipType: "Dextral",
    dip: null,
    dipDirection: null,
    averageRake: null,
    strikeSlipRate: null,
    dipSlipRate: null,
    shorteningRate: null,
    activityConfidence: 1,
    epistemicQuality: 1,
    lastMovement: null,
  },
  geometry: {
    type: "LineString",
    coordinates: [[-70, 18], [-70, 20]],
  },
};

const mechanism: SeismicMechanism = {
  id: "test-event",
  timeUtc: "2026-01-01T00:00:00.000Z",
  place: "Prueba",
  latitude: 19,
  longitude: -69.9,
  depthKm: 12,
  magnitude: 6.5,
  pAxis: { azimuthDeg: 135, plungeDeg: 5 },
  tAxis: { azimuthDeg: 45, plungeDeg: 4 },
  strikeDeg: 2,
  dipDeg: 85,
  rakeDeg: 178,
  strike2Deg: 92,
  dip2Deg: 88,
  rake2Deg: 5,
  percentDoubleCouple: 92,
  scalarMomentNm: null,
  source: "USGS",
  sourceUrl: null,
};

test("angleDifference180 handles equivalent strike directions", () => {
  assert.equal(angleDifference180(2, 182), 0);
  assert.equal(angleDifference180(175, 5), 10);
});

test("nearestPointOnFault returns short epicentral distance and local strike", () => {
  const nearest = nearestPointOnFault(19, -69.9, fault);
  assert.ok(nearest);
  assert.ok(nearest.distanceKm > 9 && nearest.distanceKm < 12);
  assert.ok(nearest.faultStrikeDeg < 2 || nearest.faultStrikeDeg > 178);
});

test("mechanism and fault styles classify broad kinematics", () => {
  assert.equal(mechanismStyle(178), "strike-slip");
  assert.equal(mechanismStyle(-90), "normal");
  assert.equal(mechanismStyle(90), "reverse");
  assert.equal(faultStyle("Dextral"), "strike-slip");
  assert.equal(faultStyle("Reverse"), "reverse");
});

test("bestFaultCompatibility favors nearby strike-compatible fault", () => {
  const result = bestFaultCompatibility(mechanism, [fault]);
  assert.ok(result);
  assert.equal(result.bestNodalPlane, 1);
  assert.ok((result.strikeDifferenceDeg ?? 99) < 5);
  assert.equal(result.styleCompatible, true);
  assert.ok(result.score > 70);
  assert.equal(result.level, "high");
});
