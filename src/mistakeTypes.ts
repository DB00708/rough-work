// Fixed taxonomy of algebra / calculus mistakes. Owned by T4.
// Slugs are stable: they are stored in Firestore and aggregated for "common mistakes".
// Never rename or remove a slug; add new ones instead.

export interface MistakeType {
  slug: string;
  /** Human label in English. */
  label: string;
  /** Human label in Roman-script Hinglish. */
  labelHinglish: string;
  /** One-line method/rule in Roman-script Hinglish. Used by the local fallback explanation. */
  tipHinglish: string;
}

export const MISTAKE_TYPES = [
  {
    slug: 'sign_error_expanding_brackets',
    label: 'Sign error while expanding brackets',
    labelHinglish: 'Bracket kholte waqt sign galat',
    tipHinglish: 'Bracket ke bahar minus ho toh andar ke har term ka sign badlo: -(a - b) = -a + b.',
  },
  {
    slug: 'wrong_sign_moving_term',
    label: 'Wrong sign when moving a term across =',
    labelHinglish: 'Term ko = ke paar le jaate waqt sign nahi badla',
    tipHinglish: 'Term ko = ke doosri taraf le jao toh uska sign ulta karo: + ka -, aur - ka +.',
  },
  {
    slug: 'distribution_error',
    label: 'Did not multiply every term in the bracket',
    labelHinglish: 'Bracket ke har term se multiply nahi kiya',
    tipHinglish: 'Bahar wale number se bracket ke har term ko multiply karo: a(b + c) = ab + ac.',
  },
  {
    slug: 'combining_unlike_terms',
    label: 'Combined unlike terms',
    labelHinglish: 'Alag terms ko jod diya (jaise x aur x^2)',
    tipHinglish: 'Sirf like terms hi jodte hain: x ke saath x, x^2 ke saath x^2.',
  },
  {
    slug: 'exponent_rule_error',
    label: 'Exponent rule misapplied',
    labelHinglish: 'Power ka rule galat lagaya',
    tipHinglish: 'Yaad rakho: a^m * a^n = a^(m+n), (a^m)^n = a^(mn), aur (a+b)^n alag hota hai.',
  },
  {
    slug: 'fraction_addition_error',
    label: 'Added fractions without a common denominator',
    labelHinglish: 'Fractions ko bina common denominator ke joda',
    tipHinglish: 'Pehle denominator same karo (LCM lo), phir numerators jodo.',
  },
  {
    slug: 'cancellation_error',
    label: 'Cancelled something that is not a common factor',
    labelHinglish: 'Jo common factor nahi hai use cancel kar diya',
    tipHinglish: 'Sirf poore numerator aur denominator ke common factor hi cancel hote hain.',
  },
  {
    slug: 'cancelling_across_addition',
    label: 'Cancelled a term across + or -',
    labelHinglish: '+ ya - ke beech wala term cancel kar diya',
    tipHinglish: '(x + 2)/x mein x cancel nahi hota; pehle factorise karo, phir common factor cancel karo.',
  },
  {
    slug: 'division_by_variable',
    label: 'Divided by a variable that could be zero',
    labelHinglish: 'Variable se divide kiya jo zero ho sakta hai',
    tipHinglish: 'Variable se divide mat karo; usko factor bana kar bahar nikalo, warna ek root chhoot jaata hai.',
  },
  {
    slug: 'only_one_side_operation',
    label: 'Did an operation on only one side of =',
    labelHinglish: '= ke sirf ek taraf operation kiya',
    tipHinglish: 'Jo bhi operation karo, = ke dono taraf barabar karo.',
  },
  {
    slug: 'inequality_sign_flip',
    label: 'Inequality sign not flipped after multiplying or dividing by a negative',
    labelHinglish: 'Negative se multiply/divide karne par inequality ka sign nahi palta',
    tipHinglish: 'Inequality ko negative number se multiply ya divide karo toh < ko > (aur > ko <) karo.',
  },
  {
    slug: 'factorisation_error',
    label: 'Factorised incorrectly',
    labelHinglish: 'Factorisation galat kiya',
    tipHinglish: 'Factors ko wapas multiply karke check karo ki original expression aata hai ya nahi.',
  },
  {
    slug: 'square_root_missing_negative',
    label: 'Missed the negative square root (±)',
    labelHinglish: 'Square root lete waqt ± bhool gaye',
    tipHinglish: 'x^2 = a ho toh x = +sqrt(a) ya x = -sqrt(a), dono likho.',
  },
  {
    slug: 'square_of_sum_error',
    label: '(a+b)^2 expanded as a^2+b^2',
    labelHinglish: '(a+b)^2 ko a^2+b^2 likh diya, 2ab bhool gaye',
    tipHinglish: '(a + b)^2 = a^2 + 2ab + b^2; beech wala 2ab mat bhoolo.',
  },
  {
    slug: 'log_rule_error',
    label: 'Logarithm rule misapplied',
    labelHinglish: 'Log ka rule galat lagaya',
    tipHinglish: 'log(ab) = log a + log b, log(a/b) = log a - log b; par log(a + b) ko tod nahi sakte.',
  },
  {
    slug: 'trig_identity_error',
    label: 'Trigonometric identity misapplied',
    labelHinglish: 'Trig identity galat lagayi',
    tipHinglish: 'Identity check karo, jaise sin^2 x + cos^2 x = 1 aur sin(2x) = 2 sin x cos x.',
  },
  {
    slug: 'derivative_power_rule',
    label: 'Power rule for derivatives misapplied',
    labelHinglish: 'Derivative ka power rule galat lagaya',
    tipHinglish: 'd/dx (x^n) = n * x^(n-1): power aage aata hai aur power ek kam hoti hai.',
  },
  {
    slug: 'chain_rule_missing',
    label: 'Forgot the chain rule',
    labelHinglish: 'Chain rule lagana bhool gaye',
    tipHinglish: 'f(g(x)) ka derivative = f\'(g(x)) * g\'(x); andar wale ka derivative bhi multiply karo.',
  },
  {
    slug: 'product_rule_error',
    label: 'Product rule misapplied',
    labelHinglish: 'Product rule galat lagaya',
    tipHinglish: '(uv)\' = u\'v + uv\'; dono terms chahiye.',
  },
  {
    slug: 'quotient_rule_error',
    label: 'Quotient rule misapplied',
    labelHinglish: 'Quotient rule galat lagaya',
    tipHinglish: '(u/v)\' = (u\'v - uv\') / v^2; order aur minus sign dhyan se.',
  },
  {
    slug: 'integration_constant_or_rule',
    label: 'Integration rule misapplied',
    labelHinglish: 'Integration ka rule galat lagaya',
    tipHinglish: 'Integral of x^n = x^(n+1)/(n+1): power ek badhao aur nayi power se divide karo.',
  },
  {
    slug: 'missing_constant_of_integration',
    label: 'Missing + C in an indefinite integral',
    labelHinglish: 'Indefinite integral mein + C bhool gaye',
    tipHinglish: 'Indefinite integral ke end mein hamesha + C lagao.',
  },
  {
    slug: 'integral_limits_error',
    label: 'Definite integral limits applied wrongly',
    labelHinglish: 'Definite integral ki limits galat lagayi',
    tipHinglish: 'F(upper) - F(lower) karo, is order mein; substitution kiya ho toh limits bhi badlo.',
  },
  {
    slug: 'arithmetic_slip',
    label: 'Arithmetic slip',
    labelHinglish: 'Calculation mein chhoti galti',
    tipHinglish: 'Is step ka calculation dobara dhyan se karo.',
  },
  {
    slug: 'copying_error',
    label: 'Copied the previous line wrongly',
    labelHinglish: 'Pichli line galat copy ki',
    tipHinglish: 'Pichli line ko dhyan se dekh kar term-by-term copy karo.',
  },
  {
    slug: 'other',
    label: 'Other mistake',
    labelHinglish: 'Koi aur galti',
    tipHinglish: 'Jo bhi operation kiya, woh dono taraf aur har term par barabar lagao.',
  },
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

const count = (s: string, ch: string) => s.split(ch).length - 1;

/**
 * Cheap local guess of the mistake type, for the timeout fallback.
 * Only fires on clear textual signals; returns `other` otherwise.
 */
export function guessMistakeType(prev: string, next: string): MistakeSlug {
  const a = prev.replace(/\s+/g, '');
  const b = next.replace(/\s+/g, '');
  // A bracket disappeared: the step expanded it.
  if (count(a, '(') > count(b, '(')) return /-\(/.test(a) ? 'sign_error_expanding_brackets' : 'distribution_error';
  // x^2 = k  ->  x = sqrt(k) with no ± / second root.
  if (/\^2=/.test(a) && /sqrt/.test(b) && !/±|\+-|-sqrt|or|,/.test(b)) return 'square_root_missing_negative';
  return 'other';
}
