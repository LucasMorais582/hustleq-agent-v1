// The 9 Business Profile fields (spec 5.2), in the order of screens 2.4 and 13.7.
export const PROFILE_FIELDS = [
  { key: "whatYouDo", label: "What you do", question: "In one line, what does your business do?" },
  { key: "niche", label: "Niche", question: "Which niche are you in?" },
  { key: "location", label: "Location", question: "Where are you based, and where do you serve customers?" },
  { key: "offers", label: "Offers", question: "What do you sell? Pick your main offers." },
  { key: "idealCustomer", label: "Ideal customer", question: "Who is your ideal customer?" },
  { key: "customerProblem", label: "Customer problem", question: "What problem do you solve for them?" },
  { key: "customerChannels", label: "Where customers come from", question: "Where do your customers come from today?" },
  { key: "doNotPost", label: "Don’t post", question: "Is there anything you don’t want to post? Pick any, or type your own." },
  { key: "goals", label: "Goals", question: "What do you want Instagram to do for your business?" },
] as const;

export type ProfileField = (typeof PROFILE_FIELDS)[number]["key"];
export const FIELD_KEYS = PROFILE_FIELDS.map((f) => f.key) as ProfileField[];
export const fieldLabel = (key: ProfileField) => PROFILE_FIELDS.find((f) => f.key === key)!.label;
export const isProfileField = (k: string): k is ProfileField => (FIELD_KEYS as string[]).includes(k);

export type ProfileValues = { [K in ProfileField]: string | null };

export function profileValues(bp: Record<string, unknown> | null): ProfileValues {
  const out = {} as ProfileValues;
  for (const k of FIELD_KEYS) out[k] = (bp?.[k] as string | null | undefined) ?? null;
  return out;
}
