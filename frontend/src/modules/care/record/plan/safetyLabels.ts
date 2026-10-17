// Client-held safety plan headings (mockup SP_LABELS). The Kiswahili labels are
// the mockup's draft — shown with a "verify with a qualified translator" warning.
export const SAFETY_LABELS: Record<"en" | "sw", Record<string, string>> = {
  en: {
    title: "My safety plan",
    warning_signs: "Warning signs that a crisis may be starting",
    coping: "Things I can do on my own to cope",
    self_talk: "Things I can say to myself",
    places_people_distract: "People and places that help take my mind off things",
    people_to_ask: "People I can ask for help",
    professionals: "Professionals and crisis lines",
    safer_surroundings: "Making my surroundings safer",
    reasons_for_living: "My reasons for living",
    keepsake: "What I keep with this plan (a photo, a letter, an object)",
  },
  sw: {
    title: "Mpango wangu wa usalama",
    warning_signs: "Ishara za tahadhari kwamba shida inaanza",
    coping: "Mambo ninayoweza kufanya mwenyewe kujituliza",
    self_talk: "Maneno ninayoweza kujiambia",
    places_people_distract: "Watu na mahali panaponisaidia kusahau",
    people_to_ask: "Watu ninaoweza kuomba msaada",
    professionals: "Wataalamu na nambari za dharura",
    safer_surroundings: "Kufanya mazingira yangu kuwa salama zaidi",
    reasons_for_living: "Sababu zangu za kuishi",
    keepsake: "Ninachoweka pamoja na mpango huu (picha, barua, kitu)",
  },
};
export const SAFETY_KEYS = ["warning_signs", "coping", "self_talk", "places_people_distract", "people_to_ask", "professionals", "safer_surroundings", "reasons_for_living", "keepsake"] as const;
