// Demo bluffing uses only the public category, never the secret word.
const BLUFFS: Record<string, readonly (readonly [string, string])[]> = {
  PLACE: [
    ['busy entrance', "You end up waiting around a lot. That's the bit I was going for."],
    ['weekend crowds', "It depends when you go. Pick the wrong time and everyone has the same idea."],
    ['people watching', "I always notice the people first. You get all sorts in there."],
  ],
  FOOD: [
    ['comfort food', "It's one of those things you keep picking at. I never stop at one bit."],
    ['better warm', "Fresh is definitely better. Once it sits there a while, it's not the same."],
    ['a bit messy', "You think you'll eat it neatly, then somehow it's all over your hands."],
  ],
  OBJECT: [
    ['always misplaced', "You never think about it until you need it. Then, obviously, you can't find it."],
    ['just in case', "I'd rather bring one and not need it. Although I usually forget, to be fair."],
    ['outdoors', "I'd take it on a trip. Not every trip, obviously. Depends where we're going."],
  ],
  ANIMAL: [
    ['funny movement', "The way it moves is really distinctive. You'd recognise it straight away."],
    ['clever little thing', "People underestimate them. I've seen videos where they're weirdly smart."],
    ['not a pet', "Cute from a distance. Would I want one in my house? Absolutely not."],
  ],
};
export function demoBluff(category: string, identity: string): readonly [string, string] {
  const choices = BLUFFS[category] || BLUFFS.OBJECT;
  const hash = [...identity].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
  return choices[hash % choices.length];
}
const ANSWERS: Record<string, string> = {
  'departure board': "I keep checking it, even though I know it hasn't changed in the last thirty seconds.",
  'rolling luggage': "You can hear the wheels from miles away. Especially on those tiled floors.",
  'security line': "There's always someone who waits until the very front to get their stuff ready.",
  'movie night': "I get through half of it before the opening credits. Every single time.",
  'buttery fingers': "You reach for your drink and suddenly the whole cup's greasy.",
  'crunchy handful': "One piece at a time? No chance. I'm grabbing a whole handful.",
  'rainy sidewalk': "It's fine until someone walks past and nearly pokes your eye out with theirs.",
  'folding handle': "Mine never folds back as neatly as it did when I bought it.",
  'staying dry': "Your top half is fine, but your shoes still get absolutely soaked.",
  'quiet shelves': "I always feel like my footsteps are ten times louder in there.",
  'borrowed stories': "I take home three, read half of one, and then realise they're all due back.",
  'reading corner': "Give me that little chair by the window and I'm staying for hours.",
  'icy shoreline': "They look so clumsy on land, then they hit the water and just disappear.",
  'formal feathers': "They look like they're dressed for a very serious meeting.",
  'awkward waddle': "That little side-to-side walk. You know exactly what I mean.",
  'breakfast stack': "The bottom one's always gone cold by the time I've finished cooking.",
  'maple drizzle': "I say just a little, then absolutely drown the whole plate.",
  'flipped batter': "The first one always looks terrible. That's the one I eat while cooking.",
  'magnetic needle': "Even if you turn yourself around, that little pointer keeps doing its thing.",
  'finding north': "I'd trust it more than my own sense of direction. Mine's terrible.",
  'lost hiker': "No phone signal, every tree looks the same. That's when you'd really want one.",
  'suction cups': "Imagine trying to open a jar when the whole lid is basically stuck to your arm.",
  'inky water': "It makes a massive mess and then sneaks off. Honestly, fair enough.",
  'clever tentacles': "They're opening jars and escaping tanks. I'd be checking the lid twice.",
};
export function demoAnswer(clue: string) { return ANSWERS[clue] || "That was the first thing that came to mind. I didn't want to make it too obvious."; }
export function naturalDemoText(text: string, type: string, name: string, category: string) {
  if (text.startsWith('Welcome to Don’t Drop Me!')) return 'Welcome to Don’t Drop Me! Viewers are randomly chosen from the streamer’s Twitch chat. Each viewer controls a character. One is secretly the impostor. The streamer must work out who’s bluffing.';
  if (type === 'rules' && (text.startsWith('Pick up each player') || text.startsWith('Streamer, use your hand'))) return 'Streamer, pick up each player and hear their clue. Friends go to Safe; your suspect goes to Impostor.';

  if (type === 'word') text = text.replace(/Round (\d+) · ([^.]+)\./, 'Round $1. The category is $2.');
  if (type === 'game' && (text.startsWith('Time to decide.') || text.startsWith('Streamer, the choice'))) return 'Choose a cave: Safe for friends, Impostor for your suspect.';
  if (type === 'turn' && /, you['’]re up/.test(text)) return text.split(',')[0] + ' is up next.';
  if (type === 'clue' && text.includes('general impression')) return `My clue: “${demoBluff(category, name)[0]}”`;
  if (type === 'answer' && text === 'I know the general category, but the specifics are a blur.') return demoBluff(category, name)[1];
  const oldAnswer = /^I was thinking of (.*), especially the feeling around it\.$/.exec(text);
  return oldAnswer ? demoAnswer(oldAnswer[1]) : text;
}
