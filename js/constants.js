const TILE = 32;
const CITY = 50;
const WORLD = TILE * CITY;

const T = { ROAD: 0, SIDEWALK: 1, BUILDING: 2, SHOP: 3, HOME: 4, PARK: 5 };
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

const START_CASH = 80;
const MAX_HEAT = 5;
const DAY_LENGTH = 300;
const TRUST_PER_LEVEL = 100;
const MAX_LEVEL = 5;
const FED_GOAL = 10000;
