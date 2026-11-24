import type { Explanation } from '../types';

export const DEMO_PROBLEM = 'Solve for x: 3(x - 2) = 2x + 4';

const SIGN_SLIP: Explanation = {
  hinglish:
    'Jab -6 ko "=" ke doosri taraf le gaye, uska sign badalna tha. Left ka -6 right mein jaakar +6 banta hai, -6 nahi.',
  english: 'When you moved -6 across the "=" sign, its sign should flip. -6 on the left becomes +6 on the right.',
  hints: [
    'Dekho, -6 ne side badli. Uske sign ka kya hua?',
    'Term ko "=" ke paar le jao to sign ulta karo: 3x - 2x = 4 + 6.',
    '3x - 2x = 4 + 6, isliye x = 10.',
  ],
  mistakeType: 'sign_not_flipped_when_transposing',
  mistakeLabel: 'Sign not flipped when moving a term across =',
  mistakeLabelHinglish: 'Term ko side badalte waqt sign nahi badla',
  ms: 0,
};

/** Four sample lines: three correct steps around one sign slip on line 3. */
export const DEMO_LINES: { plain: string; fallback?: Explanation }[] = [
  { plain: '3*(x-2) = 2*x + 4' },
  { plain: '3*x - 6 = 2*x + 4' },
  { plain: '3*x - 2*x = 4 - 6', fallback: SIGN_SLIP },
  { plain: 'x = 10' },
];
