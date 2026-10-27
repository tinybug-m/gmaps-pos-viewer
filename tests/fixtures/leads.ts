// Synthetic records only: invented names, example.com domains and Ofcom
// drama-range numbers (+44 20 7946 0xxx). Never copy real exports here.
export const crawledPoor = {
  name: "Acme Plumbing & Heating",
  mapsUrl: "https://maps.example.com/place/acme-plumbing",
  websiteUrl: "https://acme-plumbing.example.com",
  seoScore: 22,
  seoStatus: "POOR",
  city: "Testford",
  issues: [
    "Missing page title",
    "Missing meta description",
    "Missing H1 heading",
    "Slow response time (2400ms)",
    "No major issues detected",
  ],
};

export const crawledGood = {
  name: "Beta Bakery",
  mapsUrl: "https://maps.example.com/place/beta-bakery",
  websiteUrl: "https://beta-bakery.example.com",
  seoScore: 92,
  seoStatus: "GOOD",
  city: "Sampleton",
  issues: ["3 image(s) without alt text", "Title length is 72 characters"],
};

export const crawlFailed = {
  name: "Gamma Garage",
  mapsUrl: "https://maps.example.com/place/gamma-garage",
  websiteUrl: "https://gamma-garage.example.com",
  seoScore: 0,
  seoStatus: "POOR",
  city: "Testford",
  issues: ["Website unreachable: fetch failed"],
};

export const noWebsite = {
  name: "Delta Dental",
  mapsUrl: "https://maps.example.com/place/delta-dental",
  websiteUrl: null,
  city: "Exampleby",
};

export const enrichedTrustpilot = {
  name: "Epsilon Electrical Ltd",
  mapsUrl: "https://maps.example.com/place/epsilon-electrical",
  website: "https://epsilon.example.org",
  seoScore: 55,
  seoStatus: "NEEDS_IMPROVEMENT",
  town: "Sampleton",
  defectList: ["No canonical URL", "Very slow response time (5100ms)"],
  source: "trustpilot",
  trustpilotUrl: "https://uk.trustpilot.example.com/review/epsilon.example.org",
  reviewCount: 41,
  category: "Electrician",
  niche: "Trades",
  rating: 4.2,
  phone: " +44 20 7946 0123 ",
  phoneOwner: "Main line",
  emails: ["info@epsilon.example.org", "", 7],
  shouldCall: "yes",
  priority: "a",
  tier: "Tier 1",
  confidence: "high",
  pitchAngle: "Slow site losing quote requests",
  decisionMaker: { fullName: "Pat Example", title: "Director", email: "pat@epsilon.example.org" },
  otherPeople: ["Sam Sample", { name: "  " }, { name: "Alex Test", position: "Office manager" }],
  legalForm: "Ltd",
};
