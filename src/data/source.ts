import rawLeadData from "../../refrence/data.json";
import type { RawLead } from "@/types/lead";

/**
 * Sample-data repository. This is the only place that knows the leads come
 * from a static JSON file — swap this for a SQLite query, an API fetch, etc.
 * without touching anything above it.
 */
export function getRawLeads(): RawLead[] {
  return rawLeadData as RawLead[];
}
