// Pedestrians: who they are and what they say when you stop them.

const FIRST_NAMES = ["Marisol", "Dev", "Tasha", "Yusuf", "Priya", "Marcus", "Elena", "Jonah", "Keiko", "Andre", "Sofia", "Malik", "Hannah", "Diego", "Noor", "Tommy", "Ingrid", "Sam", "Lucía", "Omar", "Rivka", "Chen", "Grace", "Kwame", "Bea", "Luis", "Aliyah", "Petra", "Nate", "Yara", "Dante", "Mei", "Ruth", "Felix", "Imani", "Sergio", "Talia", "Boris", "Nadia", "Jules"];
const JOBS = ["nurse", "line cook", "rideshare driver", "realtor", "barber", "student", "retired teacher", "dog walker", "DJ", "paralegal", "valet", "sommelier", "electrician", "dental hygienist", "bartender", "film student", "pastry cook", "bus driver", "accountant", "yoga teacher", "delivery rider", "security guard", "florist", "nanny", "software engineer", "physical therapist", "tattoo artist", "fishmonger", "librarian", "personal trainer"];
const CITY_JOBS = { ny: ["doorman", "Broadway usher", "hot dog vendor", "bike messenger"], fl: ["boat captain", "lifeguard", "cruise ship cook", "poolside server"], chi: ["El conductor", "hot dog stand owner", "jazz drummer", "culinary student"], la: ["screenwriter", "surf instructor", "food truck owner", "set builder"] };

const CHATTER = [
  "You the two with the sign? My cousin sent me your video.",
  "I don't need dinner. I need a nap.",
  "Chef whites on the sidewalk. Bold.",
  "Is this a scam? It feels like a scam. A nice one.",
  "You cook, I eat, nobody pays? Where were you last Thanksgiving?",
  "My fridge is three sauces and a lime. Good luck.",
  "Careful with that car, man. This isn't a video game.",
  "There's a lady on the next block who hasn't eaten since morning.",
  "Ten thousand people? You're going to need a bigger pan.",
  "I'd let you in, but my landlord watches the door like a hawk.",
  "You look like you know what mise en place means.",
  "Hollandaise? At my place? I'll get the eggs.",
  "Take the bridge. Traffic on the other one is a nightmare.",
  "Don't park on the sidewalk. The inspector's around today.",
  "My grandmother made hummus with more tahini than seemed reasonable. She was right.",
  "Free dinner, huh. What's the catch?",
  "You feed strangers? I'm a stranger.",
  "Are you filming this? I haven't done my hair.",
  "The butcher on the corner closes at six. Run.",
  "Go feed the guys by the water. They're always hungry.",
];
const CITY_CHATTER = {
  ny:  ["Walk faster. This is Manhattan.", "There's a dog walker upstairs who'd say yes in a heartbeat.", "The Bronx end of the map is where the real cooks are.", "Whole Foods on the corner has everything, if you can afford it."],
  fl:  ["Seder for twenty? In a condo? Respect.", "The couple on the bridge? They walk it every night.", "Miami fridges are all champagne and hot sauce.", "Sanibel's a drive. Bring the good knives."],
  chi: ["Trotter's. You cooked at Trotter's? Get out.", "Deep dish is a casserole and I'll fight you.", "Green City Market, Saturday, early. Best tomatoes in the city.", "South Side kitchens feed more people before noon than downtown does all day."],
  la:  ["Onigiri on the boardwalk for six bucks? I'll take three.", "Skid Row's Taco Tuesday is the realest kitchen in this city.", "Rice first. Always. My mom said that too.", "Band practice is at seven. Bring hand rolls."],
};
const HUNGRY_LINES = ["Honestly? I haven't eaten since breakfast.", "You got anything in that bag? I'm starving.", "I'd take a plate if you're offering. No pride left today.", "Something warm. Anything warm."];
const THANKS_LINES = ["...oh. Thank you. Really.", "You didn't have to do that.", "Okay. Okay. That's good. Who ARE you?", "I'm going to cry into this. Don't look."];
const ANGRY_LINES = ["HEY! That's my car!", "Are you KIDDING me?!", "I'm calling the cops!", "Get back here!", "My groceries were in there!"];
const HIT_LINES = ["WATCH IT!", "Are you blind?!", "I'm walking here!", "Learn to drive!", "You spilled my coffee!"];
const HONK_LINES = ["HONK!", "HOOONK!", "Beep beep!"];
const HAIL_LINES = ["Taxi! TAXI!", "Over here!", "You free?"];
const FARE_DESTS = ["the airport shuttle", "her mother's place", "a job interview", "the market", "band practice", "the hospital", "a first date", "the courthouse", "physical therapy", "the boardwalk"];
const FARE_THANKS = ["Keep the change.", "You drive like my uncle. That's not a compliment.", "Fastest ride I've had all week.", "You smell like garlic. In a good way."];

const HAIR_COLORS = ["#1c1917", "#3f2a1d", "#7c4a2d", "#b45309", "#d6b370", "#e5e7eb", "#9ca3af", "#7f1d1d"];
const SHIRTS = ["#ef4444", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#14b8a6", "#ec4899", "#94a3b8", "#1e293b", "#f8fafc", "#78350f", "#0f766e", "#7c3aed"];
const PANTS = ["#1e293b", "#374151", "#1e3a8a", "#57534e", "#0f172a", "#78350f", "#e5e7eb"];
const SKINS = ["#f1c9a5", "#e0ac69", "#c68642", "#8d5524", "#5c3a21", "#ffdbac", "#a0714f"];
const DOG_COLORS = ["#8b5a2b", "#f5f5f4", "#1c1917", "#d6d3d1", "#b45309"];

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

function makePerson(rng, city) {
  const jobs = rng() < 0.25 && CITY_JOBS[city] ? CITY_JOBS[city] : JOBS;
  return {
    name: pick(FIRST_NAMES, rng), job: pick(jobs, rng),
    hair: pick(HAIR_COLORS, rng), hairStyle: Math.floor(rng() * 4),
    skin: pick(SKINS, rng), shirt: pick(SHIRTS, rng), pants: pick(PANTS, rng),
    hat: rng() < 0.18, bag: rng() < 0.3, hungry: rng() < 0.28, hailing: rng() < 0.3,
  };
}
