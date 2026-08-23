import { describe, expect, it } from "vitest";
import { COUNTRIES } from "./countries";

const SOVEREIGN_ISO_CODES = [
  "AF","AL","DE","AD","AO","AG","SA","DZ","AR","AM","AU","AT","AZ","BS","BH","BD","BB","BE","BZ","BJ","BY","BO","BA","BW","BR","BN","BG","BF","BI","BT","CV","KH","CM","CA","QA","TD","CL","CN","CY","CO","KM","CG","CD","KP","KR","CI","CR","HR","CU","DK","DM","EC","EG","SV","AE","ER","SI","ES","US","EE","ET","PH","FI","FJ","FR","GA","GM","GE","GH","GR","GD","GT","GN","GQ","GW","GY","HT","HN","HU","IN","ID","IQ","IR","IE","IS","IL","IT","JM","JP","JO","KZ","KE","KG","KI","KW","LA","LS","LV","LB","LR","LY","LI","LT","LU","MK","MG","MY","MW","MV","ML","MT","MA","MU","MR","MX","FM","MD","MC","MN","ME","MZ","MM","NA","NR","NP","NI","NE","NG","NO","NZ","OM","NL","PK","PW","PS","PA","PG","PY","PE","PL","PT","GB","CF","CZ","ZA","DO","SK","RW","RO","RU","WS","KN","SM","VC","LC","ST","SN","RS","SC","SL","SG","SY","SO","LK","SZ","SD","SS","SE","CH","SR","TH","TZ","TJ","TL","TG","TO","TT","TN","TM","TR","TV","UA","UG","UY","UZ","VU","VA","VE","VN","YE","DJ","ZM","ZW",
] as const;

describe("country catalog", () => {
  it("contains every sovereign ISO country used by RDSISMOS", () => {
    const codes = new Set(COUNTRIES.map((country) => country.code));
    const missing = SOVEREIGN_ISO_CODES.filter((code) => !codes.has(code));
    expect(missing).toEqual([]);
  });

  it("does not contain duplicate country codes", () => {
    const codes = COUNTRIES.map((country) => country.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("includes Myanmar with a usable analysis target", () => {
    const myanmar = COUNTRIES.find((country) => country.code === "MM");
    expect(myanmar?.name).toBe("Myanmar");
    expect(myanmar?.radiusKm).toBeGreaterThanOrEqual(800);
  });
});
