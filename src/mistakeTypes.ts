// Fixed taxonomy of algebra / calculus mistakes. Owned by T4.
// Slugs are stable: they are stored in Firestore and aggregated for "common mistakes".

export interface MistakeType {
  slug: string;
  /** Human label in English. */
  label: string;
  /** Human label in Roman-script Hinglish. */
  labelHinglish: string;
}

export const MISTAKE_TYPES = [
  { slug: 'sign_error_expanding_brackets', label: 'Sign error while expanding brackets', labelHinglish: 'Bracket kholte waqt sign galat' },
  { slug: 'wrong_sign_moving_term', label: 'Wrong sign when moving a term across =', labelHinglish: 'Term ko = ke paar le jaate waqt sign nahi badla' },
  { slug: 'distribution_error', label: 'Did not multiply every term in the bracket', labelHinglish: 'Bracket ke har term se multiply nahi kiya' },
  { slug: 'combining_unlike_terms', label: 'Combined unlike terms', labelHinglish: 'Alag terms ko jod diya (jaise x aur x²)' },
  { slug: 'exponent_rule_error', label: 'Exponent rule misapplied', labelHinglish: 'Power ka rule galat lagaya' },
  { slug: 'fraction_addition_error', label: 'Added fractions without a common denominator', labelHinglish: 'Fractions ko bina common denominator ke joda' },
  { slug: 'cancellation_error', label: 'Cancelled terms that cannot be cancelled', labelHinglish: 'Jo cancel nahi hota use cancel kar diya' },
  { slug: 'division_by_variable', label: 'Divided by a variable that could be zero', labelHinglish: 'Variable se divide kiya jo zero ho sakta hai' },
  { slug: 'only_one_side_operation', label: 'Did an operation on only one side of =', labelHinglish: '= ke sirf ek taraf operation kiya' },
  { slug: 'square_root_missing_negative', label: 'Missed the negative square root (±)', labelHinglish: 'Square root lete waqt ± bhool gaye' },
  { slug: 'square_of_sum_error', label: '(a+b)² expanded as a²+b²', labelHinglish: '(a+b)² ko a²+b² likh diya, 2ab bhool gaye' },
  { slug: 'derivative_power_rule', label: 'Power rule for derivatives misapplied', labelHinglish: 'Derivative ka power rule galat lagaya' },
  { slug: 'chain_rule_missing', label: 'Forgot the chain rule', labelHinglish: 'Chain rule lagana bhool gaye' },
  { slug: 'product_rule_error', label: 'Product rule misapplied', labelHinglish: 'Product rule galat lagaya' },
  { slug: 'integration_constant_or_rule', label: 'Integration rule misapplied', labelHinglish: 'Integration ka rule galat lagaya' },
  { slug: 'arithmetic_slip', label: 'Arithmetic slip', labelHinglish: 'Calculation mein chhoti galti' },
  { slug: 'copying_error', label: 'Copied the previous line wrongly', labelHinglish: 'Pichli line galat copy ki' },
  { slug: 'other', label: 'Other mistake', labelHinglish: 'Koi aur galti' },
] as const satisfies readonly MistakeType[];

export type MistakeSlug = (typeof MISTAKE_TYPES)[number]['slug'];

export const MISTAKE_SLUGS: readonly MistakeSlug[] = MISTAKE_TYPES.map((t) => t.slug);

const BY_SLUG: ReadonlyMap<string, MistakeType> = new Map(MISTAKE_TYPES.map((t) => [t.slug, t]));

/** Map any string (model output, stored data) to a known slug. Unknown values become `other`. */
export function toMistakeSlug(value: unknown): MistakeSlug {
  if (typeof value !== 'string') return 'other';
  const slug = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return BY_SLUG.has(slug) ? (slug as MistakeSlug) : 'other';
}

/** Full taxonomy entry for any string. Unknown values give the `other` entry. */
export function getMistakeType(value: unknown): MistakeType {
  return BY_SLUG.get(toMistakeSlug(value))!;
}
