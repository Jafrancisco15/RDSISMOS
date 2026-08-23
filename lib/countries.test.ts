import assert from "node:assert/strict";
import test from "node:test";
import { COUNTRIES } from "./countries";

const SOVEREIGN_ISO_CODES = [
  "AF","AL","DE","AD","AO","AG","SA","DZ","AR","AM","AU","AT","AZ","BS","BH","BD","BB","BE","BZ","BJ","BY","BO","BA","BW","BR","BN","BG","BF","BI","BT","CV","KH","CM","CA","QA","TD","CL","CN","CY","CO","KM","CG","CD","KP","KR","CI","CR","HR","CU","DK","DM","EC","EG","SV","AE","ER","SI","ES","US","EE","ET","PH","FI","FJ","FR","GA","GM","GE","GH","GR","GD","GT","GN","GQ","GW","GY","HT","HN","HU","IN","ID","IQ","IR","IE","IS","IL","IT","JM","JP","JO","KZ","KE","KG","KI","KW","LA","LS","LV","LB","LR","LY","LI","LT","LU","MK","MG","MY","MW","MV","ML","MT","MA","MU","MR","MX","FM","MD","MC","MN","ME","MZ","MM","NA","NR","NP","NI","NE","NG","NO","NZ","OM","NL","PK","PW","PS","PA","PG","PY","PE","PL","PT","GB","CF","CZ","ZA","DO","SK","RW","RO","RU","WS","KN","SM","VC","LC","ST","SN","RS","SC","SL","SG","SY","SO","LK","SZ","SD","SS","SE","CH","SR","TH","TZ","TJ","TL","TG","TO","TT","TN","TM","TR","TV","UA","UG","UY","UZ","VU","VA","VE","VN","YE","DJ","ZM","ZW",
] as const;

test("country catalog contains every sovereign ISO country used by RDSISMOS", () => {
  const codes = new Set(COUNTRIES.map((country) => country.code));
  const missing = SOVEREIGN_ISO_CODES.filter((code) => !codes.has(code));
  assert.deepEqual(missing, []);
});

test("country catalog does not contain duplicate country codes", () => {
  const codes = COUNTRIES.map((country) => country.code);
  assert.equal(new Set(codes).size, codes.length);
});

test("Myanmar has a usable analysis target", () => {
  const myanmar = COUNTRIES.find((country) => country.code === "MM");
  assert.equal(myanmar?.name, "Myanmar");
  assert.ok((myanmar?.radiusKm ?? 0) >= 800);
});
