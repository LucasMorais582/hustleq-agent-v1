import type { IgProfileBundle } from "../../src/mvp/socialData/types.js";

// Test fixture modeled on the Bahia Taste case (landing, The Work). Captions follow the real posts'
// themes; the numbers are made up for the eval and are not the account's real numbers.
const d = (daysAgo: number) => new Date(Date.UTC(2026, 10, 16) - daysAgo * 864e5).toISOString();
const post = (n: number, format: "reel" | "carousel" | "image", daysAgo: number, caption: string, likes: number, comments: number, views: number | null) => ({
  id: `bt_fixture_${n}`, url: null, format, caption, publishedAt: d(daysAgo), likes, comments, views, thumbnailUrl: null,
});

export const BAHIA_TASTE: IgProfileBundle = {
  profile: {
    id: "bt_fixture",
    handle: "bahiataste",
    name: "Bahia Taste 🇧🇷",
    bio: "👩🏾‍🍳 Catering & Private Chef · Comida baiana in NY & NJ · Weekly meal prep · Orders by DM",
    followers: 1358,
    following: 102,
    totalPosts: 97,
    photoUrl: null,
  },
  posts: [
    post(1, "carousel", 2, "Weekly Meal Prep is open 🍱 Chicken, fish and pasta boxes for the week. Order by Thursday, delivery Sunday in NJ.", 41, 6, null),
    post(2, "reel", 4, "Uma Tarde na Bahia: frying acarajé, plating moqueca and a full room singing. Thank you to everyone who came!", 380, 44, 15000),
    post(3, "reel", 6, "The Uma Tarde na Bahia menu, one dish at a time: bolinho, quiabada, moqueca, abará, ceviche, cozido and cocada.", 122, 9, 4100),
    post(4, "carousel", 9, "What goes into catering your event? A lot more than the food. It starts with the details.", 58, 7, null),
    post(5, "image", 12, "Dessert, plated. Coconut square with passion fruit sorbet.", 33, 2, null),
    post(6, "reel", 15, "Behind the scenes: abará steaming in banana leaves for Saturday's party.", 96, 5, 2700),
    post(7, "carousel", 18, "This week's boxes: feijoada, frango com quiabo and vegetarian moqueca.", 37, 4, null),
    post(8, "image", 21, "Our event table: acarajé, abará and bobó de camarão.", 45, 3, null),
    post(9, "reel", 25, "Frying acarajé at the street festival in Newark. Who came by?", 140, 18, 5200),
    post(10, "carousel", 28, "Booking holiday catering now. Office parties, birthdays, family dinners.", 29, 3, null),
    post(11, "image", 32, "Plates lined up on the counter before service.", 38, 1, null),
    post(12, "reel", 35, "Saudade de casa? A taste of Bahia in New Jersey.", 88, 12, 2400),
  ],
  fetchedAt: "2026-11-16T12:00:00.000Z",
  source: "demo",
};
