/**
 * The requirements catalogue: every field the scorer reads, why it is read, and which appetite
 * factor it backs. This is the single source of truth for retrieval — the data contract, the
 * required-path gate, and the query plan are all derived from it.
 *
 * Structure borrowed from the schema-driven planner on origin/main: keeping the reason beside
 * the path makes the plan self-documenting and lets it be resolved against a live schema
 * deterministically, with no model in the retrieval path.
 *
 * `required: true`  — the scorer cannot run without it; a schema missing it stops the run.
 * `required: false` — risk context or enrichment keying; absence lowers confidence instead.
 * `candidates`      — alternative paths tried in order when the preferred one is absent.
 */
export const REQUIREMENTS = [
  // --- Submission: the queue itself ----------------------------------------
  { resource: 'Submission', path: 'id', required: true, reason: 'Stable identity for joins and de-duplication.' },
  { resource: 'Submission', path: 'submission_number', required: false, reason: 'Human-readable reference shown to the underwriter.' },
  { resource: 'Submission', path: 'status', required: false, reason: 'Queue state, and broker hit-rate statistics.' },
  { resource: 'Submission', path: 'insured', required: true, reason: 'Joins the submission to its account.' },
  { resource: 'Submission', path: 'line_of_business', required: true, factor: 'lineOfBusiness', reason: 'Appetite is scoped to commercial property.' },
  { resource: 'Submission', path: 'received_date', required: false, reason: 'Queue age and account tenure.' },
  { resource: 'Submission', path: 'target_effective_date', required: true, factor: 'loss', reason: 'Anchors the five-year loss window and validates building years.' },
  { resource: 'Submission', path: 'requested_limit', required: false, reason: 'Size of the risk being shopped. Never substituted for TIV.' },
  { resource: 'Submission', path: 'broker', required: false, reason: 'Producer identity for the broker track record.' },
  { resource: 'Submission', path: 'underwriter', required: false, reason: 'Assigned underwriter for routing.' },

  // --- Policy: premium, business type, period, and the exposure/claim links --
  { resource: 'Policy', path: 'id', required: true, reason: 'Stable identity for claim and exposure joins.' },
  { resource: 'Policy', path: 'policy_number', required: false, reason: 'Human-readable reference on the account relationship.' },
  { resource: 'Policy', path: 'submission', required: true, reason: 'Links a policy back to the submission being scored.' },
  { resource: 'Policy', path: 'insured', required: true, reason: 'Account-level grouping for loss history and relationship.' },
  { resource: 'Policy', path: 'business_type', required: true, factor: 'businessType', reason: 'Appetite accepts new business and declines renewals.' },
  { resource: 'Policy', path: 'line_of_business', required: true, reason: 'Separates property history from other lines.' },
  { resource: 'Policy', path: 'premium', required: true, factor: 'premium', reason: 'Actual premium drives the $50K-$175K band.' },
  { resource: 'Policy', path: 'target_premium', required: false, reason: 'Shown for context. Never substituted for actual premium.' },
  { resource: 'Policy', path: 'currency', required: true, factor: 'premium', reason: 'Monetary thresholds are USD; another currency requires review.' },
  { resource: 'Policy', path: 'dates.effective', required: true, factor: 'loss', reason: 'Bounds the period this policy can evidence loss for.' },
  { resource: 'Policy', path: 'dates.expiration', required: true, factor: 'loss', reason: 'Bounds the period this policy can evidence loss for.' },
  { resource: 'Policy', path: 'exposure_units', required: true, reason: 'Entry point to the insured locations and buildings.' },
  { resource: 'Policy', path: 'claims', required: true, factor: 'loss', reason: 'Claim references for the five-year loss calculation.' },
  { resource: 'Policy', path: 'status', required: false, reason: 'In-force versus cancelled or non-renewed on the account.' },

  // --- Insured: the account ------------------------------------------------
  { resource: 'Insured', path: 'id', required: true, reason: 'Account identity.' },
  { resource: 'Insured', path: 'name', required: true, reason: 'Account name shown to the underwriter.' },
  { resource: 'Insured', path: 'naics_code', required: false, reason: 'Industry group for peer rate comparison.' },
  { resource: 'Insured', path: 'sic_code', required: false, reason: 'Secondary industry classification.' },
  { resource: 'Insured', path: 'year_founded', required: false, reason: 'Account maturity context.' },
  { resource: 'Insured', path: 'annual_revenue', required: false, reason: 'Size context for the exposure.' },
  { resource: 'Insured', path: 'employee_count', required: false, reason: 'Size context for the exposure.' },

  // --- ExposureUnit: the join to physical risk -----------------------------
  { resource: 'ExposureUnit', path: 'id', required: true, reason: 'Exposure identity.' },
  { resource: 'ExposureUnit', path: 'kind', required: true, reason: 'Selects location exposures; other kinds are not property risk.' },
  { resource: 'ExposureUnit', path: 'location', required: true, reason: 'Reference to the insured location.' },

  // --- Location: where the risk actually is --------------------------------
  { resource: 'Location', path: 'id', required: true, reason: 'Location identity.' },
  { resource: 'Location', path: 'state', required: true, factor: 'state', reason: 'Primary risk state is a hard appetite gate.' },
  { resource: 'Location', path: 'buildings', required: true, reason: 'Reference to the insured buildings at this location.' },
  { resource: 'Location', path: 'address', required: false, reason: 'Join key for external enrichment.' },
  { resource: 'Location', path: 'city', required: false, reason: 'Join key for external enrichment.' },
  { resource: 'Location', path: 'zip', required: false, reason: 'Join key for external enrichment.' },
  { resource: 'Location', path: 'county', required: false, reason: 'Jurisdiction for county-level providers, and a cross-check on geocoding.' },
  { resource: 'Location', path: 'latitude', required: false, reason: 'Coordinate for geographic hazard lookups.' },
  { resource: 'Location', path: 'longitude', required: false, reason: 'Coordinate for geographic hazard lookups.' },
  { resource: 'Location', path: 'protection_class', required: false, reason: 'Fire protection context the appetite table does not cover.' },
  { resource: 'Location', path: 'hazard_tags', required: false, reason: 'Carrier-recorded hazard flags.' },

  // --- Building: the insured value ------------------------------------------
  { resource: 'Building', path: 'id', required: true, reason: 'Building identity, used to de-duplicate shared buildings.' },
  {
    resource: 'Building', path: 'tiv', required: true, factor: 'tiv',
    candidates: ['tiv', 'building_value'],
    reason: 'Total insured value drives the appetite band and weights the construction mix.',
    note: 'building_value is accepted as a fallback but scores at reduced confidence: it excludes contents and business interruption, so it understates TIV.',
  },
  { resource: 'Building', path: 'year_built', required: true, factor: 'year', reason: 'The oldest building governs the 1990/2010 gates.' },
  { resource: 'Building', path: 'construction_type', required: true, factor: 'construction', reason: 'Classified against the ISO table to weight the construction mix.' },
  { resource: 'Building', path: 'building_value', required: false, reason: 'Fallback for TIV, and context on the building/contents split.' },
  { resource: 'Building', path: 'roof_year', required: false, reason: 'Mitigating context on building age. Never substituted for year built.' },
  { resource: 'Building', path: 'sprinklered', required: false, reason: 'Fire protection context the appetite table does not cover.' },
  { resource: 'Building', path: 'stories', required: false, reason: 'Exposure context.' },
  { resource: 'Building', path: 'square_footage', required: false, reason: 'Exposure context and a cross-check on assessor records.' },
  { resource: 'Building', path: 'occupancy', required: false, reason: 'Occupancy context for the risk.' },

  // --- Claim: the loss record ----------------------------------------------
  { resource: 'Claim', path: 'id', required: true, reason: 'Claim identity.' },
  { resource: 'Claim', path: 'policy', required: true, factor: 'loss', reason: 'Attributes a claim to a policy period we can evidence.' },
  { resource: 'Claim', path: 'date_of_loss', required: true, factor: 'loss', reason: 'Places the claim inside or outside the five-year window.' },
  { resource: 'Claim', path: 'paid_indemnity', required: true, factor: 'loss', reason: 'Component of incurred loss.' },
  { resource: 'Claim', path: 'paid_expense', required: true, factor: 'loss', reason: 'Component of incurred loss.' },
  { resource: 'Claim', path: 'reserve_indemnity', required: true, factor: 'loss', reason: 'Component of incurred loss. Excluding reserves understates open claims.' },
  { resource: 'Claim', path: 'reserve_expense', required: true, factor: 'loss', reason: 'Component of incurred loss. Excluding reserves understates open claims.' },
  { resource: 'Claim', path: 'status', required: false, reason: 'Separates open and developing reserves from closed claims.' },
  { resource: 'Claim', path: 'cause_of_loss', required: false, reason: 'Loss pattern shown on the case file.' },

  // --- Broker and Underwriter: case context --------------------------------
  { resource: 'Broker', path: 'id', required: true, reason: 'Producer identity.' },
  { resource: 'Broker', path: 'name', required: false, reason: 'Producer name on the case file.' },
  { resource: 'Broker', path: 'tier', required: false, reason: 'Producer tier for submission-quality context.' },
  { resource: 'Broker', path: 'region', required: false, reason: 'Producer region.' },
  { resource: 'Underwriter', path: 'id', required: true, reason: 'Assigned underwriter identity.' },
  { resource: 'Underwriter', path: 'name', required: false, reason: 'Assigned underwriter name.' },
  { resource: 'Underwriter', path: 'team', required: false, reason: 'Assigned team.' },
  { resource: 'Underwriter', path: 'region', required: false, reason: 'Assigned region.' },
];

const groupPaths = predicate => REQUIREMENTS.reduce((/** @type {Record<string, string[]>} */ acc, requirement) => {
  if (!predicate(requirement)) return acc;
  (acc[requirement.resource] ??= []).push(requirement.path);
  return acc;
}, {});

/** Every path worth retrieving, by resource. */
export const DATA_CONTRACT = groupPaths(() => true);

/** Paths the scorer cannot run without. A schema missing one of these stops the run. */
export const REQUIRED_PATHS = groupPaths(r => r.required);

export const RESOURCES = Object.keys(DATA_CONTRACT);

export const requirementFor = (resource, path) =>
  REQUIREMENTS.find(r => r.resource === resource && r.path === path);
