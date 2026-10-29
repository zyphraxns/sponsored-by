/**
 * 随机 / 惊喜生成器（O2）：纯前端，零后端，无上传。
 */
import type { DefaultStateOptions } from './app-state';
import type { Locale } from './core/types';

const JOKE_OPTIONS = [
  { en: 'SPONSORED BY OPEN SOURCE', zh: '由开源项目赞助' },
  { en: 'MADE POSSIBLE BY YOUR TAXES', zh: '由你的税款创造' },
  { en: 'PRESENTED BY A CAT', zh: '由一只猫呈现' },
  { en: 'POWERED BY NOTHING', zh: '由虚无驱动' },
  { en: 'THANKS TO THE INTERNET', zh: '感谢互联网' },
];

const COLORS = [
  { bg: '#1c1917', fg: '#f5f3ee' },
  { bg: '#f5f3ee', fg: '#111111' },
  { bg: '#111827', fg: '#ffffff' },
];

const SIMPLE_ICONS = [
  'simple-icons:github','simple-icons:vercel','simple-icons:openai',
  'simple-icons:google','simple-icons:spotify','simple-icons:nvidia',
];

export function randomOption(locale: Locale): Partial<DefaultStateOptions> {
  const templates = ['sponsored-by', 'made-by-gang', 'no-sponsors'] as const;
  const templateId = templates[Math.floor(Math.random() * templates.length)];
  const localeChoice = locale === 'zh' ? (Math.random() > 0.5 ? 'zh' : 'en') : locale;
  const color = COLORS[Math.floor(Math.random() * COLORS.length)]!;
  const iconPool = SIMPLE_ICONS.sort(() => 0.5 - Math.random()).slice(0, 3 + Math.floor(Math.random() * 3));
  const idx = Math.floor(Math.random() * JOKE_OPTIONS.length);
  const joke = JOKE_OPTIONS[idx] ?? JOKE_OPTIONS[0];
  const textVal = (localeChoice === 'zh' ? joke!.zh : joke!.en) as string;
  return {
    templateId,
    locale: localeChoice as Locale,
    ratio: ['1:1', '4:5', '16:9'][Math.floor(Math.random() * 3)] as '1:1' | '4:5' | '16:9',
    palette: { bg: color.bg, fg: color.fg },
    text: { [localeChoice]: textVal } as Partial<Record<string, string>>,
    icons: iconPool.map((ic) => ({ icon: ic, label: ic.replace('simple-icons:', ''), phase: 0, speed: 1 })),
    rows: 3 + Math.floor(Math.random() * 2),
    speed: 0.5 + Math.random() * 1.5,
  } as Partial<DefaultStateOptions>;
}
