"""
Deterministic psychotherapy-note organizer (master prompt §7, X-13: the build
calls no LLM, so a template-based organizer stands behind the same interface).

Pure functions over the clinician's own answers and the record. Nothing here
writes to the database and nothing here invents content (PSY-GEN-1/6):

- every sentence in a generated section is the clinician's own sentence, kept
  verbatim, only sorted under the PSY-OUT heading it belongs to;
- client-reported and clinician-observed content are separated by the served
  attribution cues (PSY-GEN-3) — a sentence is "client reported" only when the
  clinician wrote it that way;
- an unanswered question is stated as not recorded, never as a negative
  (PSY-GEN-7, AT-14) — "safety not assessed" never becomes a denial;
- risk-language detection (PSY-RD) only *prompts*; it never labels the client
  or diagnoses (PSY-GEN-8);
- therapy-model language is used only for a model the clinician named, and only
  for that model's concepts that appear in what the clinician wrote (PSY-TM-01,
  AT-16);
- the detection, stigma and attribution lexicons and the therapy-model registry
  are data passed in, never lists compiled into this module (PSY-RD, PSY-TM-03).
"""

import re

QUESTION_KEYS = ("q1", "q2", "q3", "q4", "q5")

# PSY-Q — the five questions (fixed, model-independent; master prompt §7).
QUESTIONS = [
    {"key": "q1", "title": "What did the client bring to the session today?",
     "hint": "Since last session; struggles, concerns, what they want to work on."},
    {"key": "q2", "title": "What did you notice or assess?",
     "hint": "Emotions, thoughts, behaviour, functioning, relationships, symptoms, substance use, strengths, changes."},
    {"key": "q3", "title": "What did you work on therapeutically?",
     "hint": "Focus, interventions, therapy approach/model where relevant."},
    {"key": "q4", "title": "How did the client respond?",
     "hint": "Response, insight, difficulties, strengths, changes, progress toward goals."},
    {"key": "q5", "title": "What happens next?",
     "hint": "Next steps, between-session practice, treatment-plan changes, referrals/consultations, follow-up."},
]

# PSY-S — the mandatory safety question, verbatim.
SAFETY_QUESTION = (
    "Was there any new or changed concern today regarding suicide, self-harm, harm to others, "
    "abuse or exploitation, severe deterioration, intoxication or withdrawal, inability to care "
    "for self, or another immediate safety concern?"
)
SAFETY_YES, SAFETY_NO, SAFETY_NOT_ASSESSED = "YES", "NO", "NOT_ASSESSED"
SAFETY_OPTIONS = [(SAFETY_YES, "Yes"), (SAFETY_NO, "No"), (SAFETY_NOT_ASSESSED, "Not assessed")]

# PSY-RD — the prompt, verbatim. It is the only thing detection ever says.
DETECTION_PROMPT = (
    "Potential safety concern detected. Please review and complete the appropriate risk assessment."
)
# PSY-SIGN
WATERMARK = "DRAFT — CLINICIAN REVIEW REQUIRED"
# PSY-S-02 — the NO statement is bounded to today's assessment.
SAFETY_NO_TEXT = "No new or changed safety concern identified based on today's assessment."
NOT_RECORDED = "Not recorded in this session."

# Answer metadata (input mode, language). Kiswahili and Sheng answers carry an
# English translation beside the original when AI assistance is on.
INPUT_MODES = ("TYPED", "DICTATED")
LEGACY_MODES = {"TYPE": "TYPED", "SPEAK": "DICTATED"}
LANGUAGES = [
    ("en-GB", "English (UK)"), ("en-KE", "English (Kenya)"), ("en-US", "English (US)"),
    ("sw-KE", "Kiswahili → English"), ("sheng", "Sheng → English"),
]
TRANSLATED_LANGUAGES = ("sw-KE", "sheng")

# Goal-link decisions (PSY-LINK). CONFIRMED / DISMISSED are the earlier values,
# still valid on notes written before these four existed.
GOAL_DECISIONS = {
    "PROGRESS": "progress noted",
    "NO_CHANGE": "no clear change noted",
    "BARRIER": "barrier or setback noted",
    "NOT_RELEVANT": "",
}
LEGACY_GOAL_DECISIONS = ("CONFIRMED", "DISMISSED")

# PSY-OUT — required sections, in order.
SECTIONS = [
    ("session_information", "Session Information"),
    ("presenting_focus", "Presenting Focus / Client Report"),
    ("assessment", "Clinical Assessment / Observations"),
    ("interventions", "Therapeutic Focus & Interventions"),
    ("response", "Client Response & Progress"),
    ("risk_safety", "Risk & Safety"),
    ("plan", "Plan"),
]
SECTION_KEYS = tuple(k for k, _ in SECTIONS)

# Language plumbing for goal matching only (not clinical vocabulary).
_STOPWORDS = {
    "about", "after", "again", "also", "been", "before", "being", "between", "could", "does",
    "doing", "during", "each", "from", "have", "having", "into", "just", "less", "like", "more",
    "most", "much", "only", "other", "over", "same", "should", "some", "such", "than", "that",
    "their", "them", "then", "there", "these", "they", "this", "those", "through", "very", "want",
    "wants", "were", "what", "when", "where", "which", "while", "will", "with", "would", "your",
    "client", "session", "today", "week", "better", "able", "feel", "feels", "felt", "work",
}


def sentences(text):
    """Split the clinician's text into sentences, keeping each one verbatim."""
    parts = re.split(r"(?<=[.!?])\s+|\n+", str(text or ""))
    return [p.strip(" -•\t") for p in parts if p and p.strip(" -•\t")]


def english_text(answer):
    """The text the note is organised from: the English translation when one
    is done, otherwise the clinician's original words."""
    answer = answer or {}
    translation = answer.get("translation") or {}
    if translation.get("status") == "done" and translation.get("text"):
        return translation["text"]
    return answer.get("text", "")


def _phrase_pattern(phrase):
    """Whole-word, case-insensitive, whitespace-tolerant match of a lexicon phrase."""
    words = [re.escape(w) for w in str(phrase).split()]
    return re.compile(r"(?<![\w])" + r"\s+".join(words) + r"(?![\w])", re.IGNORECASE)


def find_terms(text, terms):
    """[(term, start, end)] for every lexicon term found in `text`."""
    found = []
    for term in terms:
        if not term.get("phrase"):
            continue
        for m in _phrase_pattern(term["phrase"]).finditer(str(text or "")):
            found.append((term, m.start(), m.end()))
    return found


def _passage(text, start, end):
    """The sentence holding the match, with the match's offsets inside it."""
    text = str(text or "")
    left = max(text.rfind(".", 0, start), text.rfind("!", 0, start), text.rfind("?", 0, start),
               text.rfind("\n", 0, start))
    s = left + 1
    stops = [i for i in (text.find(".", end), text.find("!", end), text.find("?", end), text.find("\n", end)) if i != -1]
    e = (min(stops) + 1) if stops else len(text)
    raw = text[s:e]
    lead = len(raw) - len(raw.lstrip())
    return raw.strip(), start - s - lead, end - s - lead


# A risk word that is ordinary language when followed by these words — "cutting
# down drinking" is a reduction goal, not self-harm. Narrow on purpose: a missed
# disclosure is worse than a prompt the clinician marks reviewed.
_NOT_RISK_WHEN_FOLLOWED_BY = {
    "cutting": re.compile(r"\s+(?:down|back|out)(?![\w])", re.IGNORECASE),
}


def _is_idiom(text, matched, end):
    follow = _NOT_RISK_WHEN_FOLLOWED_BY.get(matched.lower())
    return bool(follow and follow.match(str(text), end))


def detect_risk_language(answers, risk_terms):
    """PSY-RD: every possible safety-language match in the five answers, each
    with its key (question + term), the triggering passage and the match offsets
    in the answer (for highlighting). A prompt only — no label, no score."""
    out = []
    for key in QUESTION_KEYS:
        answer = answers.get(key) or {}
        translation = answer.get("translation") or {}
        sources = [("original", answer.get("text", ""), "")]
        # A Kiswahili / Sheng answer is screened in its English translation too.
        if translation.get("status") == "done" and translation.get("text"):
            sources.append(("translation", translation["text"], "~en"))
        for source, text, suffix in sources:
            seen = set()
            for term, start, end in sorted(find_terms(text, risk_terms), key=lambda t: t[1]):
                dkey = f"{key}{suffix}:{term['id']}"
                if dkey in seen or _is_idiom(text, text[start:end], end):
                    continue
                seen.add(dkey)
                passage, p_start, p_end = _passage(text, start, end)
                out.append({
                    "key": dkey, "question": key, "source": source, "category": term.get("category", ""),
                    "phrase": term["phrase"], "matched": text[start:end], "start": start, "end": end,
                    "passage": passage, "passage_start": p_start, "passage_end": p_end,
                })
    return out


def stigma_flags(texts, stigma_terms):
    """PSY-GEN-11: stigmatizing terms in clinician input, each with the served
    suggested rewrite. Flags only — nothing is replaced automatically.
    `texts` is {where: text}."""
    out = []
    for where, text in texts.items():
        for term, start, end in sorted(find_terms(text, stigma_terms), key=lambda t: t[1]):
            out.append({"where": where, "term": text[start:end], "start": start, "end": end,
                        "suggestion": term.get("suggestion", "")})
    return out


def _is_client_report(sentence, cue_terms):
    return bool(find_terms(sentence, cue_terms))


def split_attribution(text, cue_terms):
    """(client_reported, clinician_observed) sentences, by the served cues."""
    reported, observed = [], []
    for s in sentences(text):
        (reported if _is_client_report(s, cue_terms) else observed).append(s)
    return reported, observed


def named_models(q3_text, selected_codes, registry):
    """PSY-TM-01/02: the enabled models the clinician ticked or named (by name
    or a registered alias) in Q3 — any number, never forced to one. The code is
    an identifier, not a name a clinician writes, so it is not matched."""
    spans = []  # (start, end, model code) of every name found in Q3
    for model in registry:
        names = {model["name"], *model.get("aliases", [])}
        for _, start, end in find_terms(q3_text, [{"phrase": n} for n in names if n]):
            spans.append((start, end, model["code"]))
    # "TF-CBT" names Trauma-Focused CBT, not CBT as well: a match inside a
    # longer match of another model does not count.
    named = {
        code for start, end, code in spans
        if not any(s <= start and end <= e and (e - s) > (end - start) and c != code for s, e, c in spans)
    }
    return [m for m in registry if m["code"] in named or m["code"] in (selected_codes or [])]


def supported_concepts(model, texts):
    """The model's concepts that the clinician's own text actually describes."""
    joined = "\n".join(texts)
    return [c for c in model.get("concepts", []) if find_terms(joined, [{"phrase": c}])]


def detect_models(q3_text, q4_text, registry):
    """PSY-TM: every registry model the clinician named in Q3 ("named"), or —
    when not named — two or more of whose distinct concepts appear across Q3
    and Q4 ("suggested"). A suggestion is only a suggestion: the clinician
    includes or excludes each model."""
    named = {m["code"] for m in named_models(q3_text, (), registry)}
    out = []
    for model in registry:
        concepts = supported_concepts(model, [q3_text, q4_text])
        if model["code"] in named:
            how = "named"
        elif len({c.lower() for c in concepts}) >= 2:
            how = "suggested"
        else:
            continue
        out.append({"code": model["code"], "name": model["name"], "version": model.get("version", ""),
                    "how": how, "concepts": concepts})
    return out


def _bullets(lines):
    return "\n".join(f"- {line}" for line in lines)


def _block(title, lines):
    return f"{title}:\n{_bullets(lines)}" if lines else ""


def _join(*blocks):
    text = "\n\n".join(b for b in blocks if b)
    return text or NOT_RECORDED


def goal_suggestions(goals, answers):
    """PSY-LINK: a session sentence that shares a meaningful word with a named
    care-plan goal is offered as possible progress toward it. Suggestion only —
    the clinician confirms, edits or dismisses."""

    def stems(text):
        return {w[:5] for w in re.findall(r"[a-z]+", str(text).lower()) if len(w) >= 4 and w not in _STOPWORDS}

    out = []
    pool = [s for k in ("q4", "q1") for s in sentences(english_text(answers.get(k)))]
    for goal in goals:
        g = stems(goal["goal"])
        if not g:
            continue
        for s in pool:
            if g & stems(s):
                out.append({"goal_index": goal["index"], "goal": goal["goal"], "evidence": s})
                break
    return out


def _session_information(info):
    rows = [
        ("Date", info.get("date")), ("Time", info.get("time")),
        ("Duration", f"{info['duration']} minutes" if info.get("duration") else "Not recorded"),
        ("Clinician", info.get("clinician")), ("Session type", info.get("session_type")),
        ("Mode", info.get("mode") or "Not recorded"),
        ("Therapy episode", info.get("episode")), ("Linked care-plan action", info.get("activity")),
    ]
    return "\n".join(f"{label}: {value}" for label, value in rows if value)


def _risk_safety(safety, detections, resolutions, context):
    answer = safety.get("answer")
    lines = []
    if answer == SAFETY_YES:
        concerns = "; ".join(safety.get("concern_labels") or [])
        lines.append(f"New or changed safety concern identified in today's session: {concerns}.")
        if safety.get("description"):
            lines.append(f"Clinician's description: {safety['description']}")
        actions = safety.get("actions")
        if isinstance(actions, str):  # notes written before the actions checklist
            actions = [actions] if actions else []
        if actions:
            lines.append("Actions taken:")
            lines.extend(f"- {a}" for a in actions)
        link = safety.get("link")
        if link:
            lines.append(f"Linked risk assessment: {link['display_id']} (opened {link['opened']})")
        lines.append("Safety concern alert raised on the client record; the findings are queued for "
                     "the risk register for clinician review.")
        plan = context.get("safety_plan")
        lines.append(f"Active safety plan on record: version {plan['version']}, signed {plan['signed_at']}."
                     if plan else "No signed safety plan on record.")
    elif answer == SAFETY_NO:
        lines.append(SAFETY_NO_TEXT)
    elif answer == SAFETY_NOT_ASSESSED:
        # AT-14: state the omission as an omission — never a denial.
        lines.append("Safety was not assessed in this session.")
        if safety.get("ack_reason"):
            lines.append(f"Reason recorded by the clinician: {safety['ack_reason']}")
    else:
        lines.append("Safety question not yet answered.")
    reviewed = [d for d in detections if d["key"] in resolutions]
    if reviewed:
        lines.append("Language prompting a safety review was reviewed by the clinician:")
        for d in reviewed:
            r = resolutions[d["key"]]
            lines.append(f"- \"{d['passage']}\" — {r.get('reason') or 'reviewed by ' + str(r.get('by') or 'the clinician')}")
    return "\n".join(lines)


def goal_lines(links):
    """Treatment-plan goal lines for the decided links (PSY-LINK). Nothing is
    added for a goal until the clinician decides; "not relevant" adds nothing.
    Legacy CONFIRMED links keep their clinician-written statement."""
    lines = []
    for link in links:
        status = link.get("status")
        label = GOAL_DECISIONS.get(status)
        if label:
            line = f"G{link['goal_index'] + 1} {link['goal']}: {label}."
            if link.get("evidence"):
                line += f" Session detail: {link['evidence']}"
            lines.append(line)
    return lines


def model_block(models):
    """The approach lines of the interventions section, for the models the
    clinician included (named or suggested-and-included)."""
    if not models:
        return ""
    names = ", ".join(m["name"] for m in models)
    elements = [
        f"{m['name']}: {', '.join(m['concepts'])}" if m.get("concepts")
        else f"{m['name']}: no specific elements described" for m in models
    ]
    return _join(f"Approach(es) identified by clinician: {names}",
                 _block("Model-consistent elements documented", elements))


def organize(answers, safety, info, registry, cue_terms, detections=(), resolutions=None,
             confirmed_links=(), measure=None, context=None, selected_models=(), applied_models=None,
             goal_links=()):
    """Build the seven PSY-OUT sections from the clinician's answers (the
    English translation where one is done). Returns {"sections": {key: text},
    "models_applied": [...], "fixed": {...}} — `fixed` holds the deterministic
    parts (approach lines, confirmed goal lines, measurement) that stay as they
    are when a section's narrative is reworded."""
    resolutions = resolutions or {}
    context = context or {}
    text = {k: english_text(answers.get(k)) for k in QUESTION_KEYS}

    presenting = _block("Client report", sentences(text["q1"]))

    reported2, observed2 = split_attribution(text["q2"], cue_terms)
    assessment = _join(_block("Client report", reported2), _block("Clinician observation / assessment", observed2))

    if applied_models is None:
        applied_models = [{**m, "concepts": supported_concepts(m, [text["q3"], text["q4"]])}
                          for m in named_models(text["q3"], selected_models, registry)]
    approaches = model_block(applied_models)
    work = _block("Session work and interventions", sentences(text["q3"]))
    interventions = _join(approaches, work)

    reported4, observed4 = split_attribution(text["q4"], cue_terms)
    legacy = [f"Goal \"{link['goal']}\": {link['statement']}" for link in confirmed_links]
    measured = ([f"{measure['name']} total {measure['total']} (recorded through the outcome store)"]
                if measure else [])
    response_extra = "\n\n".join(b for b in (
        _block("Treatment-plan goals (clinician confirmed)", goal_lines(goal_links)),
        _block("Progress toward care-plan goals (confirmed by the clinician)", legacy),
        _block("Measurement", measured),
    ) if b)
    response = _join(_block("Client response as observed", observed4), _block("Client reported", reported4),
                     response_extra)

    plan = _block("Next steps", sentences(text["q5"]))

    sections = {
        "session_information": _session_information(info),
        "presenting_focus": presenting or NOT_RECORDED,
        "assessment": assessment,
        "interventions": interventions,
        "response": response,
        "risk_safety": _risk_safety(safety, list(detections), resolutions, context),
        "plan": plan or NOT_RECORDED,
    }
    applied = [{"code": m["code"], "name": m["name"], "version": m.get("version", "")} for m in applied_models]
    return {"sections": sections, "models_applied": applied,
            "fixed": {"interventions": approaches, "response": response_extra}}


# Which section each question's narrative feeds (for the reworded sections).
QUESTION_SECTION = {"q1": "presenting_focus", "q2": "assessment", "q3": "interventions",
                    "q4": "response", "q5": "plan"}


def compose_reworded(question_key, reworded, fixed):
    """A section from a reworded narrative plus the deterministic parts."""
    if question_key == "q3":
        return _join(fixed.get("interventions", ""), f"Session work and interventions:\n{reworded}")
    if question_key == "q4":
        return _join(reworded, fixed.get("response", ""))
    return reworded


def render(sections, watermark=True):
    """The note as one text, in PSY-OUT order (draft carries the watermark)."""
    body = "\n\n".join(f"{title}\n{sections.get(key) or NOT_RECORDED}" for key, title in SECTIONS)
    return f"{WATERMARK}\n\n{body}" if watermark else body
