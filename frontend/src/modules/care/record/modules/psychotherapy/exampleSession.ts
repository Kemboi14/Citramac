// "Try an example session": fixed sample answers shown in an unsaved preview
// labelled "Example — not saved". The preview is page state only — it is never
// sent to the server, never stored in the browser and can never be signed.

export const EXAMPLE_ANSWERS: Record<string, string> = {
  q1: "She came in saying the week was rough. Had a big argument with her partner on Saturday about money and she left the house for a few hours instead of shouting, which she said was different from usual. Still having panic attacks, she reported about 2 this week, down from 4. Wants to work on what to do when the arguments start.",
  q2: "She reported sleeping about 5 hours a night and said she had 3 drinks on Saturday after the argument. I noticed she was tearful when talking about her partner but was able to settle. Speech normal, engaged well throughout. She said at one point that sometimes she wishes she could just disappear for a while.",
  q3: "We used CBT, looked at the thought 'he's going to leave me' and did a thought record, looking at the evidence for and against. Also did some MI around the drinking, explored her ambivalence and she gave some change talk about not wanting to drink after fights. Practised paced breathing for about 5 minutes.",
  q4: "She was able to come up with a more balanced thought: we argue but we usually sort it out. Said the breathing helped and she felt calmer by the end. Some resistance to cutting down drinking but she agreed it doesn't help the next day. Leaving the house instead of shouting seems like better coping in conflict.",
  q5: "Thought record twice this week and paced breathing daily. She will track her drinks on her phone. Review the safety plan next session and explore the disappear comment further. Next session 14 Oct, same time. Discuss a couples referral if she wants it.",
};

/** Question key → the note section its answer feeds (preview only). */
export const EXAMPLE_SECTION: Record<string, string> = {
  q1: "presenting_focus",
  q2: "assessment",
  q3: "interventions",
  q4: "response",
  q5: "plan",
};
