import { describe, expect, it } from "vitest";

import { dedupeKey } from "@/lib/dedupe";

const MAPS =
  "https://www.google.com/maps/place/Acme+Plumbing/@51.5,-0.1,17z/data=!3m1!4b1!4m6!3m5!1s0x48761b3:0xAbC123!8m2!3d51.5!4d-0.1?entry=ttu";

describe("dedupeKey", () => {
  it("uses the Google feature id, ignoring viewport and tracking changes", () => {
    const moved = MAPS.replace("@51.5,-0.1,17z", "@51.6,-0.2,12z").replace("entry=ttu", "hl=en&utm_source=x");
    expect(dedupeKey({ mapsUrl: MAPS })).toBe("gm:fid:0x48761b3:0xabc123");
    expect(dedupeKey({ mapsUrl: moved })).toBe(dedupeKey({ mapsUrl: MAPS }));
  });

  it("prefers the Trustpilot review slug, ignoring locale host and www", () => {
    const a = dedupeKey({ mapsUrl: MAPS, trustpilotUrl: "https://uk.trustpilot.com/review/www.Acme.example.com?page=2" });
    const b = dedupeKey({ mapsUrl: "https://maps.example.com/other", trustpilotUrl: "https://www.trustpilot.com/review/acme.example.com" });
    expect(a).toBe("tp:acme.example.com");
    expect(b).toBe(a);
  });

  it("falls back to cid, then the normalised URL", () => {
    expect(dedupeKey({ mapsUrl: "https://maps.google.com/?cid=1234567890&hl=en" })).toBe("gm:cid:1234567890");
    expect(dedupeKey({ mapsUrl: "https://WWW.Maps.Example.com/place/x/?b=2&a=1&utm_medium=y" })).toBe(
      "gm:url:maps.example.com/place/x?a=1&b=2"
    );
    expect(dedupeKey({ mapsUrl: "  Not A URL " })).toBe("gm:url:not a url");
  });

  it("ignores a Trustpilot URL that isn't a review page", () => {
    expect(dedupeKey({ mapsUrl: MAPS, trustpilotUrl: "https://uk.trustpilot.com/categories/plumbers" })).toMatch(/^gm:fid:/);
  });
});
