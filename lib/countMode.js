// Blind Count inside a normal Count: the counter only scans what is in the bin (no Correct / Wrong against the
// Master). Offered in Count#1 only; the default is Blind for these Storage Locations, Checklist for the rest.
export const BLIND_COUNT_LOCATIONS = ["D001"];

// The switch is offered in Count#1 (the recounts Count#2+ are about chosen SKUs and stay a checklist).
export const canBlindCount = (round) => round.lane === "COUNT" && round.round_number === 1;

export const blindByDefault = (round, piDoc) => canBlindCount(round) && BLIND_COUNT_LOCATIONS.includes(piDoc.sap_storage_location);
