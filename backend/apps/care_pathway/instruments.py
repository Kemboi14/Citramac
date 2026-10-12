"""
Assessment instruments — one registry, one scoring path (mockup v4 MEAS / TOOLS).

A score is the clinician's recorded result: the system sums item points or
accepts a total, labels it with a band and describes change over time in words.
It never decides care (CLAUDE.md §6 / mockup rule: priority is never set from a
single number).

`approval` states how far a definition is cleared for clinical use:
- "approved": band thresholds approved by the project owner (PHQ-9, GAD-7 —
  docs/15 §4, 2026-10-07).
- "illustrative": taken from the owner's mockup as a working reference only.
  VERIFY: a named clinician must approve the bands, reliable-change and
  caseness values before they are relied on; the UI labels them as such.

CIWA-Ar and COWS are scored here (item descriptions only). Thresholds that
trigger medicines, the re-score interval and any dosing are NOT defined: they
belong to the facility's withdrawal protocol and are read from settings
(`WITHDRAWAL_PROTOCOL`) — unset means "no trigger", never a default.
Licensed instruments whose items we may not reproduce (cognitive screen) are
total entry only.
"""

PHQ9_ITEMS = [
    "Little interest or pleasure in doing things",
    "Feeling down, depressed, or hopeless",
    "Trouble falling or staying asleep, or sleeping too much",
    "Feeling tired or having little energy",
    "Poor appetite or overeating",
    "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
    "Trouble concentrating on things, such as reading the newspaper or watching television",
    "Moving or speaking so slowly that other people could have noticed — or the opposite, being so "
    "fidgety or restless that you have been moving around a lot more than usual",
    "Thoughts that you would be better off dead, or of hurting yourself in some way",
]
GAD7_ITEMS = [
    "Feeling nervous, anxious, or on edge",
    "Not being able to stop or control worrying",
    "Worrying too much about different things",
    "Trouble relaxing",
    "Being so restless that it is hard to sit still",
    "Becoming easily annoyed or irritable",
    "Feeling afraid, as if something awful might happen",
]
FREQUENCY_OPTIONS = [
    (0, "Not at all"),
    (1, "Several days"),
    (2, "More than half the days"),
    (3, "Nearly every day"),
]
YES_NO_POINTS = [(0, "No"), (1, "Yes")]
PAWSS_ITEMS = [
    "Intoxicated / drunk within the last 30 days",
    "Ever had treatment for alcohol use (rehabilitation / alcoholism treatment)",
    "Any previous episode of alcohol withdrawal",
    "Ever had blackouts",
    "Ever had alcohol-withdrawal seizures",
    "Ever had delirium tremens (DTs)",
    "Combined alcohol with ‘downers’ (benzodiazepines, barbiturates) in the last 90 days",
    "Combined alcohol with any other substance in the last 90 days",
    "Blood alcohol level on presentation > 200 mg/dL (clinical evidence)",
    "Evidence of increased autonomic activity — HR > 120, tremor, sweating, agitation, nausea "
    "(clinical evidence)",
]
AUDITC_QUESTIONS = [
    (
        "How often do you have a drink containing alcohol?",
        ["Never", "Monthly or less", "2–4 times a month", "2–3 times a week", "4 or more times a week"],
    ),
    (
        "How many standard drinks on a typical day when drinking?",
        ["1 or 2", "3 or 4", "5 or 6", "7 to 9", "10 or more"],
    ),
    (
        "How often 6 or more drinks on one occasion?",
        ["Never", "Less than monthly", "Monthly", "Weekly", "Daily or almost daily"],
    ),
]

# CIWA-Ar and COWS: each item is scored by choosing the description that fits.
# Anchors are the published instruments' wording as given in the owner's
# mockup; in-between CIWA points are labelled "between …" rather than invented.
CIWA_ITEMS = [
    ("Nausea / vomiting", 7, {0: "No nausea, no vomiting", 1: "Mild nausea, no vomiting", 4: "Intermittent nausea with dry heaves", 7: "Constant nausea, frequent dry heaves and vomiting"}),
    ("Tremor (arms extended, fingers spread)", 7, {0: "No tremor", 1: "Not visible, can be felt fingertip to fingertip", 4: "Moderate, with arms extended", 7: "Severe, even with arms not extended"}),
    ("Paroxysmal sweats", 7, {0: "No sweat visible", 1: "Barely perceptible sweating, palms moist", 4: "Beads of sweat obvious on forehead", 7: "Drenching sweats"}),
    ("Anxiety", 7, {0: "No anxiety, at ease", 1: "Mildly anxious", 4: "Moderately anxious, or guarded", 7: "Equivalent to acute panic"}),
    ("Agitation", 7, {0: "Normal activity", 1: "Somewhat more than normal activity", 4: "Moderately fidgety and restless", 7: "Paces back and forth, or constantly thrashes about"}),
    ("Tactile disturbances", 7, {0: "None", 1: "Very mild itching, pins and needles, burning or numbness", 2: "Mild itching, pins and needles, burning or numbness", 3: "Moderate itching, pins and needles, burning or numbness", 4: "Moderately severe hallucinations", 5: "Severe hallucinations", 6: "Extremely severe hallucinations", 7: "Continuous hallucinations"}),
    ("Auditory disturbances", 7, {0: "Not present", 1: "Very mild harshness or ability to frighten", 2: "Mild harshness or ability to frighten", 3: "Moderate harshness or ability to frighten", 4: "Moderately severe hallucinations", 5: "Severe hallucinations", 6: "Extremely severe hallucinations", 7: "Continuous hallucinations"}),
    ("Visual disturbances", 7, {0: "Not present", 1: "Very mild sensitivity to light", 2: "Mild sensitivity", 3: "Moderate sensitivity", 4: "Moderately severe hallucinations", 5: "Severe hallucinations", 6: "Extremely severe hallucinations", 7: "Continuous hallucinations"}),
    ("Headache / fullness in head", 7, {0: "Not present", 1: "Very mild", 2: "Mild", 3: "Moderate", 4: "Moderately severe", 5: "Severe", 6: "Very severe", 7: "Extremely severe"}),
    ("Orientation / clouding of sensorium", 4, {0: "Oriented and can do serial additions", 1: "Cannot do serial additions or uncertain about date", 2: "Disoriented for date by no more than 2 calendar days", 3: "Disoriented for date by more than 2 calendar days", 4: "Disoriented for place and/or person"}),
]
COWS_ITEMS = [
    ("Resting pulse (after 1 min sitting or lying)", {0: "≤ 80 bpm", 1: "81–100 bpm", 2: "101–120 bpm", 4: "> 120 bpm"}),
    ("Sweating (past ½ h, not from room temperature or activity)", {0: "No report of chills or flushing", 1: "Subjective report of chills or flushing", 2: "Flushed or observable moistness on face", 3: "Beads of sweat on brow or face", 4: "Sweat streaming off face"}),
    ("Restlessness (during assessment)", {0: "Able to sit still", 1: "Reports difficulty sitting still, but is able to do so", 3: "Frequent shifting or extraneous movements of legs / arms", 5: "Unable to sit still for more than a few seconds"}),
    ("Pupil size", {0: "Pinned or normal size for room light", 1: "Possibly larger than normal for room light", 2: "Moderately dilated", 5: "So dilated that only the rim of the iris is visible"}),
    ("Bone or joint aches", {0: "Not present", 1: "Mild diffuse discomfort", 2: "Severe diffuse aching of joints / muscles", 4: "Rubbing joints or muscles and unable to sit still because of discomfort"}),
    ("Runny nose or tearing", {0: "Not present", 1: "Nasal stuffiness or unusually moist eyes", 2: "Nose running or tearing", 4: "Nose constantly running or tears streaming"}),
    ("GI upset (past ½ h)", {0: "No GI symptoms", 1: "Stomach cramps", 2: "Nausea or loose stool", 3: "Vomiting or diarrhoea", 5: "Multiple episodes of diarrhoea or vomiting"}),
    ("Tremor (observation of outstretched hands)", {0: "No tremor", 1: "Tremor can be felt, but not observed", 2: "Slight tremor observable", 4: "Gross tremor or muscle twitching"}),
    ("Yawning", {0: "No yawning", 1: "Once or twice during assessment", 2: "Three or more times during assessment", 4: "Several times a minute"}),
    ("Anxiety or irritability", {0: "None", 1: "Reports increasing irritability or anxiousness", 2: "Obviously irritable or anxious", 4: "So irritable or anxious that participation in the assessment is difficult"}),
    ("Gooseflesh skin", {0: "Skin is smooth", 3: "Piloerection can be felt or hairs standing up on arms", 5: "Prominent piloerection"}),
]


def _ciwa_options(top, anchors):
    options = []
    points = sorted(anchors)
    for value in range(top + 1):
        if value in anchors:
            options.append((value, f"{value} — {anchors[value]}"))
        else:
            low = max(p for p in points if p < value)
            high = min(p for p in points if p > value)
            options.append((value, f"{value} — between “{anchors[low]}” and “{anchors[high]}”"))
    return options


INSTRUMENTS = {
    "PHQ9": {
        "name": "PHQ-9", "title": "PHQ-9 — depressive symptoms", "kind": "items", "max": 27,
        "items": [{"text": t, "options": FREQUENCY_OPTIONS} for t in PHQ9_ITEMS],
        "bands": [(4, "Minimal"), (9, "Mild"), (14, "Moderate"), (19, "Moderately severe"), (27, "Severe")],
        "higher_is_worse": True, "reliable_change": 5, "caseness": 10, "approval": "approved",
        "safety_item": 8,  # item 9 (index 8): any non-zero answer needs clinician review
    },
    "GAD7": {
        "name": "GAD-7", "title": "GAD-7 — anxiety symptoms", "kind": "items", "max": 21,
        "items": [{"text": t, "options": FREQUENCY_OPTIONS} for t in GAD7_ITEMS],
        "bands": [(4, "Minimal"), (9, "Mild"), (14, "Moderate"), (21, "Severe")],
        "higher_is_worse": True, "reliable_change": 4, "caseness": 8, "approval": "approved",
    },
    "PHQA": {
        "name": "PHQ-A (adolescent)", "title": "PHQ-A — adolescent depression", "kind": "total",
        "max": 27,
        "bands": [(4, "Minimal"), (9, "Mild"), (14, "Moderate"), (19, "Moderately severe"), (27, "Severe")],
        "higher_is_worse": True, "reliable_change": 5, "caseness": 10, "approval": "illustrative",
    },
    "EPDS": {
        "name": "EPDS (perinatal)", "title": "EPDS — perinatal depression", "kind": "total", "max": 30,
        "bands": [(9, "Below threshold"), (12, "Possible depression"),
                  (30, "Probable depression — clinical review")],
        "higher_is_worse": True, "threshold": 13, "approval": "illustrative",
    },
    "MDQ": {
        "name": "MDQ", "title": "MDQ — bipolar / manic symptoms", "kind": "total", "max": 13,
        "bands": [(13, "Interpret with the screen’s own positive criteria")],
        "higher_is_worse": True, "approval": "illustrative", "has_positive_flag": True,
    },
    "PAWSS": {
        "name": "PAWSS", "title": "PAWSS — alcohol withdrawal-risk predictor", "kind": "items",
        "max": 10, "items": [{"text": t, "options": YES_NO_POINTS} for t in PAWSS_ITEMS],
        "bands": [(3, "Lower risk"), (10, "High risk of complicated withdrawal")],
        "higher_is_worse": True, "threshold": 4, "approval": "illustrative",
    },
    "AUDITC": {
        "name": "AUDIT-C", "title": "AUDIT-C — alcohol use screen", "kind": "items", "max": 12,
        "items": [
            {"text": q, "options": list(enumerate(opts))} for q, opts in AUDITC_QUESTIONS
        ],
        "bands": [(2, "Below threshold"), (3, "Positive for women (≥ 3)"),
                  (12, "Positive screen (≥ 4)")],
        "higher_is_worse": True, "approval": "illustrative",
    },
    "PCL5": {
        "name": "PCL-5", "title": "Trauma assessment (PCL-5 — tenant-approved)", "kind": "total",
        "max": 80,
        "bands": [(32, "Below threshold"), (80, "Probable PTSD — clinical review")],
        "higher_is_worse": True, "threshold": 33, "approval": "illustrative",
    },
    "COG": {
        "name": "Cognitive screen", "title": "Cognitive screen (licensed instrument)", "kind": "total",
        "max": 30, "bands": [(30, "Interpret against the licensed instrument’s cut-off")],
        "higher_is_worse": False, "approval": "illustrative",
    },
    "CRI": {
        "name": "CRI (experimental)", "title": "CRI — CITRAMAC recovery index (experimental)",
        "kind": "total", "max": 100,
        "bands": [(29, "Very limited recovery"), (49, "Limited recovery"),
                  (69, "Moderate recovery"), (100, "Good recovery")],
        "higher_is_worse": False, "experimental": True, "approval": "illustrative",
    },
}

INSTRUMENTS["CIWA"] = {
    "name": "CIWA-Ar", "title": "CIWA-Ar — alcohol withdrawal severity", "kind": "items", "max": 67,
    "items": [
        {"text": name, "options": _ciwa_options(top, anchors)} for name, top, anchors in CIWA_ITEMS
    ],
    "bands": [(7, "Minimal"), (15, "Mild–moderate"), (67, "Severe")],
    "higher_is_worse": True, "approval": "illustrative", "withdrawal": True,
}
INSTRUMENTS["COWS"] = {
    "name": "COWS", "title": "COWS — opioid withdrawal severity", "kind": "items", "max": 48,
    "items": [
        {"text": name, "options": [(p, f"{p} — {label}") for p, label in sorted(anchors.items())]}
        for name, anchors in COWS_ITEMS
    ],
    "bands": [(4, "Minimal"), (12, "Mild"), (24, "Moderate"), (36, "Moderately severe"), (48, "Severe")],
    "higher_is_worse": True, "approval": "illustrative", "withdrawal": True,
}

CODES = list(INSTRUMENTS)


def band_for(code, total):
    for upto, label in INSTRUMENTS[code]["bands"]:
        if total <= upto:
            return label
    return ""


def score_items(code, answers):
    """answers: list of option *points*, one per item. Returns (total, items)."""
    spec = INSTRUMENTS[code]
    if spec["kind"] != "items":
        raise ValueError(f"{code} is entered as a total")
    if not isinstance(answers, list) or len(answers) != len(spec["items"]):
        raise ValueError(f"{spec['name']} needs an answer for each of its {len(spec['items'])} items.")
    total = 0
    cleaned = []
    for index, (answer, item) in enumerate(zip(answers, spec["items"], strict=True)):
        valid = {points for points, _label in item["options"]}
        if answer not in valid:
            raise ValueError(f"{spec['name']} item {index + 1}: choose one of the listed answers.")
        total += answer
        cleaned.append(answer)
    return total, cleaned


def validate_total(code, total):
    spec = INSTRUMENTS[code]
    if isinstance(total, bool) or not isinstance(total, int) or not 0 <= total <= spec["max"]:
        raise ValueError(f"{spec['name']} must be a whole number from 0 to {spec['max']}.")
    return total


def result_flags(code, items):
    """Findings the clinician must see (never auto-actioned)."""
    spec = INSTRUMENTS[code]
    flags = []
    index = spec.get("safety_item")
    if index is not None and items and items[index] > 0:
        flags.append(
            "Item 9 (thoughts of being better off dead or self-harm) is positive — "
            "review risk before the client leaves."
        )
    return flags


def change_text(code, series):
    """Plain-words change between first and latest score (mockup changeTxt)."""
    spec = INSTRUMENTS[code]
    if len(series) < 2:
        return {"text": "Baseline only", "direction": "flat", "reliable": False, "clinically_significant": False}
    first, latest = series[0], series[-1]
    delta = latest - first
    if delta == 0:
        return {"text": "No change", "direction": "flat", "reliable": False, "clinically_significant": False}
    better = delta < 0 if spec["higher_is_worse"] else delta > 0
    text = f"{'Improved' if better else 'Worsened'} {abs(delta)} point{'s' if abs(delta) > 1 else ''}"
    reliable = bool(spec.get("reliable_change")) and abs(delta) >= spec["reliable_change"]
    significant = False
    if reliable:
        text += " · reliable change"
        caseness = spec.get("caseness")
        if caseness is not None and better and first >= caseness and latest < caseness:
            significant = True
            text += f" · clinically significant (now below {caseness})"
    return {
        "text": text,
        "direction": "good" if better else "bad",
        "reliable": reliable,
        "clinically_significant": significant,
    }


def served():
    return [
        {
            "code": code,
            "name": spec["name"],
            "title": spec["title"],
            "kind": spec["kind"],
            "max": spec["max"],
            "items": [
                {"text": item["text"], "options": [{"points": p, "label": label} for p, label in item["options"]]}
                for item in spec.get("items", [])
            ],
            "bands": [{"upTo": upto, "label": label} for upto, label in spec["bands"]],
            "higherIsWorse": spec["higher_is_worse"],
            "approval": spec["approval"],
            "experimental": bool(spec.get("experimental")),
            "hasPositiveFlag": bool(spec.get("has_positive_flag")),
            "withdrawal": bool(spec.get("withdrawal")),
        }
        for code, spec in INSTRUMENTS.items()
    ]
