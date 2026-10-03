// Random conversation engine: picks a scene for each session.
// minLevel is an index into LEVELS (0 = A1 ... 5 = C2).
const { MODES, LEVELS } = require('./learning');

const POOLS = {
  casual: [
    { title: 'How your day is going', brief: 'Friendly small talk about how their day has been so far.' },
    { title: 'Weekend plans', brief: 'Chat about what they usually do on weekends and what is coming up.' },
    { title: 'Food you love', brief: 'Talk about favourite meals, cooking, and places to eat.' },
    { title: 'Your neighbourhood', brief: 'Talk about where they live and what they like or dislike about it.' },
    { title: 'Music and podcasts', brief: 'What they listen to on the way to work or while relaxing.' },
    { title: 'Something new lately', brief: 'Ask what new thing (a habit, a show, a place) they have tried recently.' },
  ],
  random: [
    { title: 'A skill you wish you had', brief: 'Pick an unexpected angle: a skill you would instantly download into your brain.' },
    { title: 'The strangest job', brief: 'Wonder together what the strangest job in the world might be.' },
    { title: 'A day without phones', brief: 'What would change if everyone had no phones for a day?' },
    { title: 'Lucky and unlucky', brief: 'Talk about a time something lucky (or unlucky) happened to them.' },
    { title: 'Time machine', brief: 'If they could visit any decade for one day, which and why?', minLevel: 2 },
    { title: 'Tiny inventions', brief: 'Which small everyday invention do they think is underrated?', minLevel: 2 },
  ],
  story: [
    { title: 'A memorable trip', brief: 'Invite them to tell the story of a trip that did not go as planned.' },
    { title: 'A childhood memory', brief: 'Ask for a vivid memory from when they were a kid, then react and ask what happened next.' },
    { title: 'The lost wallet', brief: 'You start a story about finding a lost wallet; ask what they would do, then continue it together.' },
    { title: 'A funny misunderstanding', brief: 'Share a light story about a misunderstanding and ask if something similar happened to them.' },
    { title: 'A day that went wrong', brief: 'Ask about a day where everything went wrong and how it ended.', minLevel: 2 },
  ],
  travel: [
    { title: 'Airport check-in', brief: 'Airport check-in and security.', aiRole: 'an airline check-in agent', userRole: 'a traveller' },
    { title: 'Hotel front desk', brief: 'Checking in to a hotel, with a small problem with the room.', aiRole: 'a hotel receptionist', userRole: 'a guest' },
    { title: 'Restaurant abroad', brief: 'Ordering dinner in a busy restaurant and asking about dishes.', aiRole: 'a waiter', userRole: 'a customer' },
    { title: 'Asking for directions', brief: 'They are lost in a new city and ask you, a local, how to get somewhere.', aiRole: 'a friendly local', userRole: 'a tourist' },
    { title: 'Planning a trip', brief: 'Chat as friends about where to travel next and why.' },
  ],
  roleplay: [
    { title: 'Job interview', brief: 'A friendly interview for a job they might actually want.', aiRole: 'a hiring manager', userRole: 'the candidate', minLevel: 2 },
    { title: 'Ordering food', brief: 'Ordering at a café counter, including small changes to the order.', aiRole: 'a café barista', userRole: 'a customer', minLevel: 0 },
    { title: 'Meeting someone new', brief: 'Meeting at a friend\'s party for the first time.', aiRole: 'someone at the party', userRole: 'a guest', minLevel: 0 },
    { title: 'University conversation', brief: 'Talking with a classmate about a course and a group project.', aiRole: 'a classmate', userRole: 'a student', minLevel: 1 },
    { title: 'Renting an apartment', brief: 'Viewing an apartment and asking the landlord questions.', aiRole: 'a landlord', userRole: 'a prospective tenant', minLevel: 2 },
    { title: 'Doctor appointment', brief: 'A simple appointment about a cold; describing symptoms.', aiRole: 'a doctor', userRole: 'a patient', minLevel: 1 },
    { title: 'Customer service call', brief: 'Calling to fix a problem with an order.', aiRole: 'a customer service agent', userRole: 'a customer', minLevel: 2 },
    { title: 'Workplace chat', brief: 'A coworker chat about a deadline that moved.', aiRole: 'a coworker', userRole: 'a colleague', minLevel: 2 },
  ],
  debate: [
    { title: 'Cats or dogs?', brief: 'Take a side (dogs) in a light, friendly debate and ask them to defend theirs.', minLevel: 0 },
    { title: 'City or countryside', brief: 'You argue that the countryside is better to live in; ask them to disagree.', minLevel: 1 },
    { title: 'Social media', brief: 'Do you think social media has made people more connected or more isolated? Take one side.', minLevel: 3 },
    { title: 'Remote work', brief: 'Argue that working from home is better; push back politely on their points.', minLevel: 3 },
    { title: 'Should school start later?', brief: 'Argue that school should start later in the morning.', minLevel: 2 },
    { title: 'Is AI good for creativity?', brief: 'Take a mildly sceptical view and ask them to challenge you.', minLevel: 4 },
  ],
  scenario: [
    { title: 'The missed train', brief: 'They just missed the last train home. Work out together what to do.', minLevel: 1 },
    { title: 'Noisy neighbours', brief: 'You are a neighbour who plays loud music; they come to talk to you politely.', aiRole: 'a neighbour', userRole: 'the person next door', minLevel: 2 },
    { title: 'Lost luggage', brief: 'Their bag did not arrive at the airport.', aiRole: 'a baggage desk agent', userRole: 'a passenger', minLevel: 1 },
    { title: 'Returning a gift', brief: 'They want to return a present without receipt.', aiRole: 'a shop assistant', userRole: 'a customer', minLevel: 2 },
    { title: 'Double-booked', brief: 'Two friends want the same evening; they must decide what to do.', minLevel: 1 },
  ],
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function pickScenario({ mode, level, recentTopics = [], preferredModes = [] }) {
  let chosen = mode;
  if (mode === 'surprise') {
    const pool = preferredModes.filter((m) => MODES.includes(m));
    chosen = pick(pool.length ? pool : MODES);
  }
  const idx = Math.max(0, LEVELS.indexOf(level));
  const eligible = POOLS[chosen].filter((s) => (s.minLevel ?? 0) <= idx);
  const fresh = eligible.filter((s) => !recentTopics.includes(s.title));
  const scenario = pick(fresh.length ? fresh : eligible.length ? eligible : POOLS[chosen]);
  return { mode: chosen, ...scenario };
}

module.exports = { pickScenario };
