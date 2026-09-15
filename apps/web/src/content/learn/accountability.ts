export const PUBLIC_CONTACT = 'info@ushso.org'
export const OPERATOR = 'The American Journal of Healthcare Strategy'
export const ISSUE_TRACKER = 'https://github.com/ajhcs/ushso/issues/new?title=USHSO%20metadata%20correction'
export const SHORTLIST_KEY = 'ushso.local-shortlist.v1'

export const UNSUPPLIED = {
  affiliations: 'Not disclosed. The Observatory name does not imply affiliation with or endorsement by the United States government, a university, or any source publisher.',
  funding: 'Funding sources, financial interests, and conflict-of-interest declarations have not been supplied for publication.',
  named_editorial_roles: 'Named editorial and correction-role assignments have not been supplied for publication.',
  staff: 'Staff names, headcount, and biographies have not been supplied for publication.',
  response_time: 'An acknowledgement or response-time promise has not been established.',
  outcomes: 'No current scientific-acceptance or production-approval outcome is claimed on this page.',
} as const

export const PROPOSED_CORRECTION_POLICY = {
  status: 'proposed_for_review',
  public_contact: PUBLIC_CONTACT,
  public_issue_tracker: ISSUE_TRACKER,
  acknowledgement_time: null,
  named_correction_authority: null,
  private_forwarding_addresses: null,
  automatically_attached_research_question: false,
  automatically_attached_phi: false,
  notes: [
    'Field-level corrections should name the record ID, catalog generation, affected field, and an authoritative supporting link.',
    'Do not include the originating research question, protected health information, credentials, or restricted datasets.',
    'Public GitHub issues are public. Use info@ushso.org for private corrections.',
    'This proposed policy is for owner review. It is not an adopted service-level promise.',
  ],
} as const

export const RESEARCH_EXAMPLES = [
  {
    label: 'Hospital cost-report metadata',
    body: 'A researcher looking for CMS Hospital Provider Cost Report documentation can inspect catalog metadata on generation live-2026-09-03-85b50522b420. Finding that source is not obtaining the cost-report payload.',
  },
  {
    label: 'Keyed Census metadata',
    body: 'A developer inspecting Census ABSCB variables.json can see that a named Census API key is required. USHSO names the credential and does not embed it.',
  },
  {
    label: 'Restricted HCUP files',
    body: 'A researcher looking for HCUP inpatient stays is pointed to the publisher application process. Public MEPS files are not that restricted HCUP route.',
  },
] as const
