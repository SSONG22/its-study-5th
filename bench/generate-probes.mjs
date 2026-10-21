// 바늘 테스트 생성.
//
// 대화 앞부분에 구체적인 사실을 하나 심고, 그 사실이 window 밖으로 밀려난 뒤
// 되묻는다. 기억하면 recalled, 되물어오면 contradicted.
//
// 사실은 우연히 맞힐 수 없는 값으로 고른다 (이름, 번호, 날짜).
// "milk" 같은 흔한 단어를 쓰면 "no milk" 같은 문장에 걸려 오판한다.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

const PROBES = [
  { id: 'cafe',       scenario: 'Ordering coffee at a busy cafe. You are the barista.',
    opener: 'Hi, what can I get for you today?',
    fact: "A large iced latte, please. And my name is Minji, M-I-N-J-I.",
    ask: "Could you write my name on the cup?",
    expected: ['minji'], forbidden: ["what's your name", 'what is your name', 'your name again', "didn't catch your name"] },

  { id: 'airport',    scenario: 'Checking in for an international flight. You are the airline agent.',
    opener: 'Good morning. May I see your passport?',
    fact: "Here you go. I'm on flight AB1423 to Helsinki.",
    ask: "Can you confirm my flight number before I go?",
    pattern: '\\b[A-Z]{2}\\s?\\d{3,4}\\b',
    expected: ['ab1423', '1423'], forbidden: ['which flight', 'what flight', 'flight number again', 'what was your flight'] },

  { id: 'hotel',      scenario: 'Checking into a hotel. You are the front desk clerk.',
    opener: 'Welcome. Do you have a reservation with us?',
    fact: "Yes, under Park. I'm checking out on the 23rd.",
    ask: "Remind me what checkout date I gave you?",
    pattern: '\\b\\d{1,2}(st|nd|rd|th)\\b',
    expected: ['23rd', '23'], forbidden: ['which date', 'what date', 'when did you', 'when were you', 'remind me when'] },

  { id: 'clinic',     scenario: "Booking a doctor's appointment by phone. You are the receptionist.",
    opener: 'Good afternoon, Grove Clinic. How can I help?',
    fact: "I need an appointment. Also, I'm allergic to penicillin.",
    ask: "Before we finish, what allergy did I mention earlier?",
    pattern: '\\b(penicillin|amoxicillin|ibuprofen|aspirin|sulfa|latex|codeine)\\b',
    expected: ['penicillin'], forbidden: ['what allergy', 'which allergy', "you didn't mention"] },

  { id: 'restaurant', scenario: 'Making a dinner reservation by phone. You are the restaurant host.',
    opener: "Thanks for calling Pierre's. How may I help you?",
    fact: "I'd like a table on Friday. We're a party of seven.",
    ask: "How many people did I say we had?",
    pattern: '\\b(one|two|three|four|five|six|seven|eight|nine|ten|\\d{1,2})\\s+(people|guests|person)\\b',
    expected: ['seven', ' 7'], forbidden: ['how many', 'party size', "you didn't say"] },

  { id: 'refund',     scenario: 'Returning a defective item at a store. You are the sales associate.',
    opener: 'Hi there. Is something wrong with your purchase?',
    fact: "The handle broke. My order number is 7781.",
    ask: "Can you pull up my order number again?",
    pattern: '\\b\\d{4}\\b',
    expected: ['7781'], forbidden: ['order number?', 'what is your order', 'which order'] },

  { id: 'taxi',       scenario: 'Taking a taxi from the airport to downtown. You are the driver.',
    opener: 'Evening. Where are we headed?',
    fact: "Bradbury Street, please. The one near the old library.",
    ask: "Which street did I say I was going to?",
    pattern: '\\b[A-Z][a-z]+\\s+(Street|St|Avenue|Ave|Road|Rd)\\b',
    expected: ['bradbury'], forbidden: ['which street', 'what street', 'where again'] },

  { id: 'bank',       scenario: 'Opening a bank account as a newcomer. You are the bank teller.',
    opener: 'Hello. What brings you in today?',
    fact: "I want to open an account. I'm a graduate student from Korea.",
    ask: "What did I say about my situation?",
    expected: ['student', 'korea'], forbidden: ['tell me about yourself', 'what do you do'] },

  { id: 'gym',        scenario: 'Signing up for a gym membership. You are the staff member.',
    opener: 'Hey. Looking to join?',
    fact: "Yes, but I can only come on weekends because of work.",
    ask: "Which days did I say I could come?",
    pattern: '\\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekday|weekend)s?\\b',
    expected: ['weekend', 'saturday', 'sunday'], forbidden: ['which days', 'what days', 'when can you'] },

  { id: 'interview',  scenario: 'A job interview for a backend engineer role. You are the interviewer.',
    opener: 'Thanks for coming in. Tell me a bit about yourself.',
    fact: "I worked at Hanbit for three years on payment systems.",
    ask: "How long did I say I worked there?",
    pattern: '\\b(\\d+|one|two|three|four|five|six|seven|eight|nine|ten)\\s+years?\\b',
    expected: ['three year', '3 year'], forbidden: ['how long', 'how many years'] },
];

// 사실을 심은 뒤 윈도우 밖으로 밀어내기 위한 중립 대화
const FILLER = [
  "Sure, that works.", "Okay, got it.", "Hmm, let me think.",
  "That sounds fine.", "Alright, no problem.", "I see, thanks.",
  "Yes, please.", "That's good to know.",
];

// depth = 심은 뒤 추가로 주고받는 횟수. window(6) 밖으로 밀어내려면 충분히 커야 한다.
const DEPTHS = [2, 6, 12];

const cases = [];
for (const p of PROBES) {
  for (const depth of DEPTHS) {
    const history = [
      { role: 'assistant', content: p.opener },
      { role: 'user',      content: p.fact },      // ← 심는 지점
      { role: 'assistant', content: 'Got it, thanks.' },
    ];
    for (let i = 0; i < depth; i++) {
      history.push({ role: 'user',      content: FILLER[i % FILLER.length] });
      history.push({ role: 'assistant', content: 'Sure, understood.' });
    }
    cases.push({
      caseId: `${p.id}-d${depth}`,
      probeId: p.id,
      scenarioId: p.id,
      scenario: p.scenario,
      depth,
      factPosition: 1,
      distanceFromEnd: history.length - 1,   // 사실이 끝에서 몇 번째인지
      history,
      message: p.ask,
      expected: p.expected,
      forbidden: p.forbidden,
      pattern: p.pattern ?? null,
    });
  }
}

const out = join(here, 'dataset/probes.json');
writeFileSync(out, JSON.stringify(cases, null, 2));
console.log(`${cases.length}건 생성 → ${out}`);
console.log(`시나리오 ${PROBES.length}개 × 깊이 ${DEPTHS.join('/')}`);
for (const d of DEPTHS) {
  const s = cases.find(c => c.depth === d);
  console.log(`  깊이 ${String(d).padStart(2)}: history ${String(s.history.length).padStart(2)}개, 사실이 끝에서 ${s.distanceFromEnd}번째 → window(6) ${s.distanceFromEnd > 6 ? '밖 (잊음)' : '안 (기억)'}`);
}
